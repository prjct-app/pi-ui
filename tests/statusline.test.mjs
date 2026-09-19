import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters as plain } from 'node:util';
import { visibleWidth } from '@earendil-works/pi-tui';
import minimalFooter from '../src/statusline.ts';

function harness(initialSessionName, extensionStatuses = new Map()) {
  const handlers = new Map();
  let sessionName = initialSessionName;
  let footer;

  minimalFooter({
    getSessionName: () => sessionName,
    getThinkingLevel: () => 'high',
    on: (name, handler) => handlers.set(name, handler),
  });

  const ctx = {
    mode: 'tui',
    cwd: '/projects/sample-project',
    model: { name: 'Test model', provider: 'test-provider' },
    getContextUsage: () => ({ percent: 25 }),
    ui: {
      setFooter: (factory) => {
        footer = factory(
          { requestRender() {} },
          { fg: (_color, text) => text },
          {
            getExtensionStatuses: () => extensionStatuses,
            getGitBranch: () => 'main',
            onBranchChange: () => () => {},
          },
        );
      },
    },
  };

  handlers.get('session_start')({}, ctx);

  return {
    render(width = 160) {
      const line = footer.render(width).at(-1);
      assert.ok(visibleWidth(line) <= width);
      return plain(line);
    },
    lines(width = 160) {
      return footer.render(width).map(line => plain(line));
    },
    setSessionName(name) {
      sessionName = name;
    },
  };
}

test('minimal footer includes the current session name when one is set', () => {
  const footer = harness('Work on login');
  assert.match(footer.render(), /^sample-project · Work on login ·  main · Test model · high/);
  assert.doesNotMatch(footer.render(), /test-provider/);
});

test('minimal footer omits the session-name segment when the session is unnamed', () => {
  const footer = harness(undefined);
  assert.match(footer.render(), /^sample-project ·  main · Test model · high/);
  assert.doesNotMatch(footer.render(), /undefined| ·  · |test-provider/);
});

test('minimal footer reads the live name after it is set or cleared', () => {
  const footer = harness(undefined);
  footer.setSessionName('Renamed session');
  assert.match(footer.render(), /^sample-project · Renamed session ·  main/);

  footer.setSessionName(undefined);
  assert.match(footer.render(), /^sample-project ·  main/);
  assert.doesNotMatch(footer.render(), /Renamed session/);
});

test('minimal footer shows the Fast icon beside the model', () => {
  const statuses = new Map([
    ['pi-fast-mode', ''],
  ]);
  const footer = harness(undefined, statuses);

  assert.match(footer.render(), /^sample-project ·  main ·  Test model · high/);
});

test('active modes share one line right below the editor, and it disappears when none is on', () => {
  const statuses = new Map([
    ['mode:plan', '◆ plan 2/5'],
    ['mode:agents', '◆ agents ● 1'],
    ['plan-mode', 'old plan status'],
  ]);
  const footer = harness(undefined, statuses);
  assert.deepEqual(footer.lines(), [' ◆ agents ● 1  ·  ◆ plan 2/5', footer.render()]);
  assert.doesNotMatch(footer.render(), /plan/);

  statuses.clear();
  assert.equal(footer.lines().length, 1);
});

test('minimal footer hides unrelated extension statuses', () => {
  const statuses = new Map([
    ['pi-activity', '◇ ready · balanced'],
    ['pi-fast-mode', ''],
  ]);
  const footer = harness(undefined, statuses);

  assert.match(footer.render(), /^sample-project ·  main ·  Test model · high/);
  assert.doesNotMatch(footer.render(), /ready|balanced/);
});
