// Run: node --test scripts/antigravity/antigravity-output-leftover-check.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const { findLeftovers, ALLOWED } = require('./antigravity-output-leftover-check.cjs');

const BINS = ['rig-worktree', 'rig-set-active-plan', 'rig-init'];
const check = (text, filePath = '.agent/skills/x/SKILL.md') => findLeftovers([{ path: filePath, text }], { binNames: BINS }).map((f) => f.id);

test('flags each forbidden reference', () => {
  assert.deepStrictEqual(check('see .claude/rules/a.md'), ['.claude/ path']);
  assert.deepStrictEqual(check('dir .claude\\skills'), ['.claude/ path']);
  assert.deepStrictEqual(check('${CLAUDE_PLUGIN_ROOT}/x'), ['CLAUDE_PLUGIN_* variable']);
  assert.deepStrictEqual(check('${CLAUDE_SKILL_DIR}/x'), ['CLAUDE_SKILL_DIR variable']);
  assert.deepStrictEqual(check('run rig-init --plan'), ['rig-init', 'bare plugin bin name']);
  assert.deepStrictEqual(check('hooks/hooks.json'), ['hooks.json']);
  assert.deepStrictEqual(check('run `rig-worktree info`'), ['bare plugin bin name']);
  assert.deepStrictEqual(check('use /rig:setup now'), ['/rig:<x> command without a synced skill']);
});

test('reports path and line number', () => {
  const [f] = findLeftovers([{ path: 'GEMINI.md', text: 'ok\nok\nsee .claude/x' }]);
  assert.deepStrictEqual([f.path, f.line], ['GEMINI.md', 3]);
});

test('clean text, rewritten paths and unrelated look-alikes pass', () => {
  assert.deepStrictEqual(check('node .agent/skills/worktree/scripts/worktree.cjs and .claude-archived/a and my-rig-worktree and rig-worktree.cjs and bin/rig-worktree'), []);
  assert.deepStrictEqual(check('/rig:remote and /rig:team stay'), []);
});

test('allowlist: user-level ~/.claude files and API-key .env files', () => {
  assert.deepStrictEqual(check('`~/.claude/.env` and $HOME/.claude/skills/.env and ${HOME}/.claude/.rig.json'), []);
  assert.deepStrictEqual(check('echo KEY=x > {project_dir}/.claude/skills/media/.env'), []);
  assert.deepStrictEqual(check('PROJECT/.claude/.env'), []);
});

test('allowlist does not hide a forbidden mention on the same line', () => {
  assert.deepStrictEqual(check('~/.claude/.env or .claude/rules/a.md'), ['.claude/ path']);
  assert.deepStrictEqual(check('.claude/skills/.env then .claude/hooks/x'), ['.claude/ path']);
  assert.deepStrictEqual(check('~/.claude/tasks and .claude/browser/logs'), ['.claude/ path']);
});

test('allowlist: plugin variables only in the create-skill plugin references', () => {
  const ref = '.agent/skills/create-skill/references/plugin-marketplace-sources.md';
  assert.deepStrictEqual(check('"${CLAUDE_PLUGIN_ROOT}/a" in hooks.json', ref), []);
  assert.deepStrictEqual(check('"${CLAUDE_PLUGIN_ROOT}/a"', '.agent/skills/create-skill/SKILL.md'), ['CLAUDE_PLUGIN_* variable']);
  assert.deepStrictEqual(check('see .claude/x', ref), ['.claude/ path']);
});

test('the allowlist stays small and each entry says why', () => {
  assert.ok(ALLOWED.length <= 3);
  for (const a of ALLOWED) assert.ok(a.name && a.reason && a.span.global, a.name);
});
