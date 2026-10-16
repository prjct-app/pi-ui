import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import pUi from '../index.ts';
import { DEFAULTS, readSettings, settingsPath, writeSettings } from '../src/settings.ts';

function fakePi() {
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const renderers = new Map();
  const pi = {
    events: {},
    getSessionName: () => undefined,
    getThinkingLevel: () => 'off',
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    registerEntryRenderer: (name, renderer) => renderers.set(name, renderer),
    appendEntry: () => {},
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  };
  return { pi, handlers, tools, commands, renderers };
}

function fakeCtx(view, chosen) {
  return {
    mode: 'tui',
    hasUI: true,
    cwd: '/projects/sample',
    model: { name: 'Test model' },
    getContextUsage: () => ({ percent: 10 }),
    sessionManager: { getBranch: () => [] },
    ui: {
      theme: { fg: (_c, t) => t, bold: (t) => t },
      setHeader: (factory) => { view.header = factory; },
      setFooter: (factory) => { view.footer = factory; },
      setStatus: () => {},
      setWidget: () => {},
      setToolsExpanded: () => {},
      notify: (message, level) => view.notices.push({ message, level }),
      custom: async () => ({ ids: chosen }),
    },
  };
}

async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'pi-ui-home-'));
  const before = process.env.PRJCT_HOME;
  process.env.PRJCT_HOME = home;
  try {
    await run(home);
  } finally {
    if (before === undefined) delete process.env.PRJCT_HOME; else process.env.PRJCT_HOME = before;
    await rm(home, { recursive: true, force: true });
  }
}

async function start(handlers, ctx) {
  for (const handler of handlers.get('session_start') ?? []) await handler({}, ctx);
}

test('with no settings every part is on and Pi keeps its own header', () => withHome(async () => {
  assert.deepEqual(readSettings(), DEFAULTS);
  const { pi, handlers, tools, commands } = fakePi();
  pUi(pi);

  assert.deepEqual([...tools.keys()].sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  assert.deepEqual([...commands.keys()].sort(), ['activity', 'activity-settings', 'header', 'palette', 'ui']);

  const view = { notices: [] };
  await start(handlers, fakeCtx(view));
  assert.equal(view.header, undefined, "Pi's built-in header stays");
  assert.equal(typeof view.footer, 'function', 'the pi-ui footer is set');
}));

test('switched-off parts leave Pi in charge', () => withHome(async () => {
  writeSettings({ header: false, transcript: false, activity: false, footer: false, palette: false });
  const { pi, handlers, tools, commands } = fakePi();
  pUi(pi);

  assert.deepEqual([...tools.keys()], [], 'activity off keeps Pi\'s tools');
  assert.deepEqual([...commands.keys()].sort(), ['activity', 'activity-settings', 'header', 'palette', 'ui'].filter((name) => !name.startsWith('activity')));

  const view = { notices: [] };
  await start(handlers, fakeCtx(view));
  assert.deepEqual(view.header().render(80), [], 'header off draws nothing');
  assert.equal(view.footer, undefined, "footer off gives Pi's footer back");
}));

test('/ui saves the checked parts, applies them live, and asks for a restart only for activity', () => withHome(async () => {
  const { pi, commands } = fakePi();
  pUi(pi);

  const view = { notices: [] };
  await commands.get('ui').handler('', fakeCtx(view, ['footer', 'transcript']));

  assert.deepEqual(JSON.parse(await readFile(settingsPath(), 'utf8')), { header: false, transcript: true, activity: false, footer: true, palette: false });
  assert.deepEqual(view.header().render(80), []);
  assert.equal(typeof view.footer, 'function');
  assert.equal(view.notices.length, 1);
  assert.match(view.notices[0].message, /Activity turns off when Pi starts again/);

  view.notices.length = 0;
  await commands.get('ui').handler('', fakeCtx(view, ['header', 'transcript', 'activity', 'footer', 'palette']));
  assert.equal(view.header, undefined, "turning the header back on restores Pi's");
  assert.deepEqual(view.notices, [], 'activity matches what loaded, so no restart is needed');
}));

test('a damaged settings file means every part is on', () => withHome(async (home) => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(join(home, 'pi-ui'), { recursive: true });
  await writeFile(settingsPath(), '{not json');
  assert.deepEqual(readSettings(), DEFAULTS);
  await writeFile(settingsPath(), JSON.stringify({ footer: false, header: 'no' }));
  assert.deepEqual(readSettings(), { ...DEFAULTS, footer: false });
}));
