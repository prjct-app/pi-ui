import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { visibleWidth } from '@earendil-works/pi-tui';
import registerHeader, { adoptPiHeaderLogo } from '../src/header/index.ts';
import { loadLogo, normalizeLogo, MAX_LOGO_BYTES } from '../src/header/logo.ts';

async function harness(t, mode = 'tui') {
  const dir = await mkdtemp(join(tmpdir(), 'pi-ui-header-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const handlers = new Map(), commands = new Map(), notices = [], state = { set: 0 };
  const api = { on: (name, handler) => handlers.set(name, handler), registerCommand: (name, command) => commands.set(name, command) };
  const ctx = { mode, cwd: dir, ui: {
    setHeader: factory => { state.factory = factory; state.set += 1; },
    setWidget: (_key, content) => { state.widget = content; },
    notify: (text, kind) => notices.push({ text, kind }),
    custom: factory => new Promise(resolve => {
      const component = factory({ requestRender() {} }, { fg: (_name, text) => text }, {}, resolve);
      state.preview = component.render(80);
      component.handleInput(state.rejectPreview ? '\x1b' : '\r');
    }),
  } };
  const settingsPath = join(dir, 'pi-ui', 'header.json');
  const header = registerHeader(api, { settingsPath });
  await handlers.get('session_start')({}, ctx);
  await header.apply(ctx, true);
  const command = args => commands.get('header').handler(args, ctx);
  return { header, handlers, commands, notices, state, ctx, settingsPath, command, dir };
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#e9e9e9"/></svg>';
const draw = (state, width = 80) => state.factory({ requestRender() {} }, { fg: (_name, text) => text }).render(width);

test("with no saved logo the header is Pi's own", async t => {
  const h = await harness(t);
  assert.equal(h.state.set, 1);
  assert.equal(h.state.factory, undefined, "setHeader(undefined) keeps Pi's built-in header");
  assert.deepEqual(await loadLogo(h.settingsPath), { kind: 'pi' });
});

test('the prjct logo replaces the header, fits its width, and /header pi gives Pi its header back', async t => {
  const h = await harness(t);
  await h.command('prjct');
  const lines = draw(h.state);
  assert.ok(lines.every(line => visibleWidth(line) <= 80));
  assert.match(lines.map(stripVTControlCharacters).join('\n'), /prjct \/ pi agent · v/);
  assert.match(lines.join(''), /[▀▄█]/u);
  await h.command('pi');
  assert.equal(h.state.factory, undefined);
  assert.deepEqual(await loadLogo(h.settingsPath), { kind: 'pi' });
});

test('a header switched off draws nothing, whatever the logo, and comes back when switched on', async t => {
  const h = await harness(t);
  await h.command('prjct');
  await h.header.apply(h.ctx, false);
  assert.deepEqual(draw(h.state), []);
  await h.command('pi');
  assert.deepEqual(draw(h.state), [], 'choosing a logo while off keeps it hidden');
  assert.match(h.notices.at(-1).text, /turn it on in \/ui/);
  await h.command('prjct');
  await h.header.apply(h.ctx, true);
  assert.match(draw(h.state).map(stripVTControlCharacters).join('\n'), /prjct \/ pi agent/);
});

for (const mode of ['rpc', 'json', 'print']) test(`${mode} does not set or capture a header`, async t => {
  const h = await harness(t, mode);
  assert.equal(h.state.set, 0);
  assert.deepEqual(await h.handlers.get('input')({ text: svg, source: 'interactive' }, h.ctx), { action: 'continue' });
});

test('SVG paste, image paste and reset persist without a model request', async t => {
  const h = await harness(t);
  await h.command('logo');
  assert.deepEqual(await h.handlers.get('input')({ text: svg, source: 'interactive' }, h.ctx), { action: 'handled' });
  const stored = await loadLogo(h.settingsPath);
  assert.equal(stored.kind, 'custom');
  await h.handlers.get('session_start')({}, h.ctx);
  await h.header.apply(h.ctx, true);
  assert.deepEqual(await loadLogo(h.settingsPath), stored);
  await h.command('paste');
  assert.deepEqual(await h.handlers.get('input')({ text: '', source: 'interactive', images: [{ data: stored.data, mimeType: 'image/png' }] }, h.ctx), { action: 'handled' });
  assert.equal((await loadLogo(h.settingsPath)).kind, 'custom');
  await h.command('reset');
  assert.deepEqual(await loadLogo(h.settingsPath), { kind: 'pi' });
});

test('invalid input keeps the previous logo; cancellation resumes ordinary prompts', async t => {
  const h = await harness(t);
  await h.command('prjct');
  await h.command('logo');
  const input = { text: 'continue working on the code', source: 'interactive' };
  assert.deepEqual(await h.handlers.get('input')({ ...input, source: 'rpc' }, h.ctx), { action: 'continue' });
  assert.deepEqual(await h.handlers.get('input')(input, h.ctx), { action: 'handled' });
  assert.deepEqual(await loadLogo(h.settingsPath), { kind: 'prjct' });
  assert.equal(h.notices.at(-1).kind, 'error');
  await h.command('cancel');
  assert.deepEqual(await h.handlers.get('input')(input, h.ctx), { action: 'continue' });
});

test('reference capture previews before saving a replacement', async t => {
  const h = await harness(t);
  await h.command('prjct');
  await h.command('logo');
  assert.match(h.state.widget.join(''), /reference image.*\/header cancel/);
  h.state.rejectPreview = true;
  await h.handlers.get('input')({ text: svg, source: 'interactive' }, h.ctx);
  assert.deepEqual(await loadLogo(h.settingsPath), { kind: 'prjct' });
  assert.match(h.state.preview.join(''), /Header logo preview/);
  h.state.rejectPreview = false;
  await h.handlers.get('input')({ text: svg, source: 'interactive' }, h.ctx);
  assert.equal((await loadLogo(h.settingsPath)).kind, 'custom');
  assert.equal(h.state.widget, undefined);
});

test('bounded conversion supports the prjct SVG and rejects invalid image data', async () => {
  const logo = await normalizeLogo(await readFile(new URL('../assets/prjct-logo.svg', import.meta.url)));
  assert.equal(logo.kind, 'custom');
  await assert.rejects(normalizeLogo(Buffer.from('not an image')));
  await assert.rejects(normalizeLogo(Buffer.alloc(MAX_LOGO_BYTES + 1)), /4 MiB/);
});

test("pi-header's saved logo is copied once and the original is kept", async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-ui-adopt-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const legacy = join(dir, 'pi-header', 'settings.json');
  const target = join(dir, 'pi-ui', 'header.json');
  await mkdir(join(dir, 'pi-header'), { recursive: true });
  await writeFile(legacy, '{"kind":"prjct"}\n');
  await adoptPiHeaderLogo(target);
  assert.equal(await readFile(target, 'utf8'), '{"kind":"prjct"}\n');
  assert.equal(await readFile(legacy, 'utf8'), '{"kind":"prjct"}\n');
  await writeFile(legacy, '{"kind":"pi"}\n');
  await adoptPiHeaderLogo(target);
  assert.equal(await readFile(target, 'utf8'), '{"kind":"prjct"}\n', 'an existing pi-ui choice wins');
});
