import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { visibleWidth } from '@earendil-works/pi-tui';
import startupLogo from '../src/header.ts';

function load(mode = 'tui') {
  const handlers = new Map();
  let headerFactory;
  startupLogo({ on: (name, handler) => handlers.set(name, handler) });
  const ctx = {
    mode,
    ui: {
      setHeader: (factory) => { headerFactory = factory; },
    },
  };
  handlers.get('session_start')({}, ctx);
  return headerFactory;
}

test('TUI startup installs a documented custom header component', () => {
  const factory = load('tui');
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

test('non-TUI modes do not install a header', () => {
  assert.equal(load('rpc'), undefined);
  assert.equal(load('json'), undefined);
  assert.equal(load('print'), undefined);
});

test('the header follows a palette change', () => {
  const factory = load('tui');
  // A live theme, like Pi's: the same object answers with the palette in use.
  let muted = '\x1b[38;2;176;167;156m';
  const component = factory({ requestRender() {} }, { fg: (_color, text) => `${muted}${text}\x1b[39m` });
  const versionLine = () => component.render(80).find((line) => line.includes('Pi coding agent v'));
  assert.ok(versionLine().includes('\x1b[38;2;176;167;156m'));
  muted = '\x1b[38;2;184;193;209m';
  assert.ok(versionLine().includes('\x1b[38;2;184;193;209m'), 'repainted in the new palette');
});
