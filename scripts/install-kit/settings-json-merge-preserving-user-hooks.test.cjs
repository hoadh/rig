// Run: node --test scripts/install-kit/settings-json-merge-preserving-user-hooks.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { mergeKitSettings } = require('./settings-json-merge-preserving-user-hooks.cjs');

const hook = (extra) => ({ type: 'command', command: 'node "$HOME/.claude/hooks/usage.cjs"', ...extra });
const settings = (h, other = []) => ({ hooks: { UserPromptSubmit: [{ hooks: [h, ...other] }] } });

test('re-install moves an installed kit hook to the kit run options', () => {
  const { merged, stats } = mergeKitSettings(settings(hook({ async: true })), settings(hook({ timeout: 30 })), true);
  assert.deepStrictEqual(merged.hooks.UserPromptSubmit[0].hooks, [hook({ async: true })]);
  assert.strictEqual(stats.optionsUpdated, 1);
  assert.strictEqual(stats.added, 0);
});

test('hook already matching the kit is left alone', () => {
  const { stats } = mergeKitSettings(settings(hook({ async: true })), settings(hook({ async: true })), true);
  assert.strictEqual(stats.optionsUpdated, 0);
});

test('user hooks keep their own options', () => {
  const user = { type: 'command', command: 'node /opt/mine.cjs', timeout: 99 };
  const { merged } = mergeKitSettings(settings(hook({ async: true })), settings(hook(), [user]), true);
  assert.deepStrictEqual(merged.hooks.UserPromptSubmit[0].hooks[1], user);
});

const KIT_PERMISSIONS = { ask: ['Read(**/.env)', 'Read(**/*.pem)'], deny: ['Read(**/node_modules/**)'] };

test('permissions: kit ask/deny rules appended after user rules, allow/defaultMode untouched', () => {
  const dest = { permissions: { allow: ['Bash(ls)'], defaultMode: 'acceptEdits', ask: ['Bash(rm *)', 'Read(**/.env)'] } };
  const { merged, stats } = mergeKitSettings({ permissions: KIT_PERMISSIONS }, dest, true);
  assert.deepStrictEqual(merged.permissions, {
    allow: ['Bash(ls)'],
    defaultMode: 'acceptEdits',
    ask: ['Bash(rm *)', 'Read(**/.env)', 'Read(**/*.pem)'],
    deny: ['Read(**/node_modules/**)'],
  });
  assert.strictEqual(stats.permissionRulesAdded, 2);
});

test('permissions: added when the user has none', () => {
  const { merged, stats } = mergeKitSettings({ permissions: KIT_PERMISSIONS }, { hooks: {} }, false);
  assert.deepStrictEqual(merged.permissions, KIT_PERMISSIONS);
  assert.strictEqual(stats.permissionRulesAdded, 3);
});

test('second merge is a no-op', () => {
  const dest = { hooks: { UserPromptSubmit: [{ hooks: [hook({ command: 'node "$HOME/.claude/hooks/session-state.cjs"' })] }] } };
  const source = { permissions: KIT_PERMISSIONS, ...settings(hook()) };
  const first = mergeKitSettings(source, dest, true).merged;
  const { merged, stats } = mergeKitSettings(source, first, true);
  assert.deepStrictEqual(merged, first);
  assert.deepStrictEqual([stats.added, stats.optionsUpdated, stats.permissionRulesAdded, stats.retiredRemoved.length], [0, 0, 0, 0]);
});
