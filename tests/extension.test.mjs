import assert from 'node:assert/strict';
import { test } from 'node:test';

import pUi from '../index.ts';

test('the single entry point composes all three UI capabilities', () => {
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const renderers = new Map();
  const pi = {
    getSessionName: () => undefined,
    getThinkingLevel: () => 'off',
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    registerEntryRenderer: (name, renderer) => renderers.set(name, renderer),
    on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  };

  pUi(pi);

  assert.equal(handlers.get('session_start')?.length, 3);
  assert.deepEqual([...tools.keys()].sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  assert.deepEqual([...commands.keys()].sort(), ['activity', 'activity-settings']);
  assert.deepEqual([...renderers.keys()].sort(), ['activity-settings', 'activity-summary']);
});
