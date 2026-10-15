import assert from 'node:assert/strict';
import { test } from 'node:test';

import pUi from '../index.ts';

test('the single entry point composes transcript and statusline without tool overrides', () => {
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
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  };

  pUi(pi);

  assert.equal(handlers.get('session_start')?.length, 2);
  assert.deepEqual([...tools.keys()], []);
  assert.deepEqual([...commands.keys()], []);
  assert.deepEqual([...renderers.keys()], []);
});
