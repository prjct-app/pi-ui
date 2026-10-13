import assert from 'node:assert/strict';
import { test } from 'node:test';
import transcript, { callTime } from '../src/transcript.ts';

function sessionPi() {
  const handlers = new Map();
  return {
    pi: { on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) },
    handlers,
  };
}

test('session_start with no branch leaves callTime undefined for every id', () => {
  const { pi, handlers } = sessionPi();
  transcript(pi);
  const ctx = { mode: 'tui', sessionManager: { getBranch: () => [] }, ui: { theme: { fg: (_c, t) => t } } };
  handlers.get('session_start')[0]({}, ctx);
  assert.equal(callTime('anything'), undefined);
});

test('callTime returns the assistant message timestamp for a tool call in the branch', () => {
  const { pi, handlers } = sessionPi();
  transcript(pi);
  const ctx = {
    mode: 'tui',
    sessionManager: {
      getBranch: () => [
        {
          type: 'message',
          message: {
            role: 'assistant',
            timestamp: 1700000000000,
            content: [{ type: 'toolCall', id: 'call-1' }],
          },
        },
      ],
    },
    ui: { theme: { fg: (_c, t) => t } },
  };
  handlers.get('session_start')[0]({}, ctx);
  assert.equal(callTime('call-1'), 1700000000000);
  assert.equal(callTime('unknown'), undefined);
});

test('message_end adds new tool calls to the callTime index without mutating the previous one', () => {
  const { pi, handlers } = sessionPi();
  transcript(pi);
  const ctx = {
    mode: 'tui',
    sessionManager: { getBranch: () => [] },
    ui: { theme: { fg: (_c, t) => t } },
  };
  handlers.get('session_start')[0]({}, ctx);
  assert.equal(callTime('call-a'), undefined);
  handlers.get('message_end')[0]({
    message: {
      role: 'assistant',
      timestamp: 1700000010000,
      content: [{ type: 'toolCall', id: 'call-a' }],
    },
  });
  assert.equal(callTime('call-a'), 1700000010000);
});

test('session_tree replaces the index with the new branch instead of editing the old one', () => {
  const { pi, handlers } = sessionPi();
  transcript(pi);
  const ctx = (branch) => ({
    mode: 'tui',
    sessionManager: { getBranch: () => branch },
    ui: { theme: { fg: (_c, t) => t } },
  });
  handlers.get('session_start')[0]({}, ctx([
    { type: 'message', message: { role: 'assistant', timestamp: 1700000000000, content: [{ type: 'toolCall', id: 'old' }] } },
  ]));
  assert.equal(callTime('old'), 1700000000000);
  handlers.get('session_tree')[0]({}, ctx([
    { type: 'message', message: { role: 'assistant', timestamp: 1700000050000, content: [{ type: 'toolCall', id: 'new' }] } },
  ]));
  assert.equal(callTime('new'), 1700000050000);
  assert.equal(callTime('old'), undefined, 'old branch ids are gone after the tree jump');
});
