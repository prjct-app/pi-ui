import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { visibleWidth } from '@earendil-works/pi-tui';
import startupLogo from '../src/header.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function load(mode = 'tui') {
  const handlers = new Map();
  let headerFactory;
  const base = mkdtempSync(join(tmpdir(), 'pi-ui-header-'));
  startupLogo({ events: {}, registerCommand() {}, on: (name, handler) => handlers.set(name, handler) }, { settingsPath: join(base, 'header.json') });
  const ctx = {
    mode,
    ui: {
      setHeader: (factory) => { headerFactory = factory; },
    },
  };
  await handlers.get('session_start')({}, ctx);
  rmSync(base, { recursive: true, force: true });
  return headerFactory;
}

test('TUI startup installs a documented custom header component', async () => {
  const factory = await load('tui');
  assert.equal(typeof factory, 'function');
  const component = factory(
    { requestRender() {} },
    { fg: (_color, text) => text },
  );
  const lines = component.render(80);
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  assert.match(lines.map(stripVTControlCharacters).join('\n'), /Pi coding agent v/);
});

test('non-TUI modes do not install a header', async () => {
  assert.equal(await load('rpc'), undefined);
  assert.equal(await load('json'), undefined);
  assert.equal(await load('print'), undefined);
});

test('the header follows a palette change', async () => {
  const factory = await load('tui');
  // A live theme, like Pi's: the same object answers with the palette in use.
  let muted = '\x1b[38;2;176;167;156m';
  const component = factory({ requestRender() {} }, { fg: (_color, text) => `${muted}${text}\x1b[39m` });
  const versionLine = () => component.render(80).find((line) => line.includes('Pi coding agent v'));
  assert.ok(versionLine().includes('\x1b[38;2;176;167;156m'));
  muted = '\x1b[38;2;184;193;209m';
  assert.ok(versionLine().includes('\x1b[38;2;184;193;209m'), 'repainted in the new palette');
});
