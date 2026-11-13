// Run: node --test scripts/antigravity/antigravity-output-leftover-check.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const { findLeftovers, ALLOWED } = require('./antigravity-output-leftover-check.cjs');

const BINS = ['rig-worktree', 'rig-set-active-plan', 'rig-init'];
const check = (text, filePath = 'skills/x/SKILL.md') => findLeftovers([{ path: filePath, text }], { binNames: BINS }).map((f) => f.id);

test('flags each forbidden reference', () => {
  assert.deepStrictEqual(check('see .claude/rules/a.md'), ['.claude/ path']);
  assert.deepStrictEqual(check('dir .claude\\skills'), ['.claude/ path']);
  assert.deepStrictEqual(check('${CLAUDE_PLUGIN_ROOT}/x'), ['CLAUDE_PLUGIN_* variable']);
  assert.deepStrictEqual(check('${CLAUDE_SKILL_DIR}/x'), ['CLAUDE_SKILL_DIR variable']);
  assert.deepStrictEqual(check('run rig-init --plan'), ['rig-init', 'bare plugin bin name']);
  assert.deepStrictEqual(check('hooks/hooks.json'), ['hooks.json']);
  assert.deepStrictEqual(check('run `rig-worktree info`'), ['bare plugin bin name']);
  assert.deepStrictEqual(check('use /rig:setup now'), ['rig:<x> prefix without a plugin skill']);
  assert.deepStrictEqual(check('load rig:plan'), ['rig:<x> prefix without a plugin skill']);
  assert.deepStrictEqual(check('the .agent/skills dir'), ['.agent/ kit dir']);
  assert.deepStrictEqual(check('node ./a.cjs and node ../b.cjs'), ['workspace-relative node call']);
  assert.deepStrictEqual(check('python scripts/a.py'), ['bare scripts/ call without the Rig root', 'relative python script call']);
  assert.deepStrictEqual(check('npx tsx scripts/cli.ts list-tools'), ['bare scripts/ call without the Rig root']);
  assert.deepStrictEqual(check('python eval-viewer/generate_review.py'), ['relative python script call']);
  assert.deepStrictEqual(check('TeamCreate(x)'), ['TeamCreate']);
});

test('absolute-style and bare-file python calls are not flagged', () => {
  assert.deepStrictEqual(check('python <Rig root>/skills/x/scripts/a.py and python3 minimax_cli.py'), []);
});

test('reports path and line number', () => {
  const [f] = findLeftovers([{ path: 'rules/AGENTS.md', text: 'ok\nok\nsee .claude/x' }]);
  assert.deepStrictEqual([f.path, f.line], ['rules/AGENTS.md', 3]);
});

test('clean text, rewritten paths and unrelated look-alikes pass', () => {
  assert.deepStrictEqual(check('node <Rig root>/skills/worktree/scripts/worktree.cjs and node <Rig root>/scripts/a.cjs and .agents/x and .claude-archived/a and my-rig-worktree and rig-worktree.cjs and bin/rig-worktree'), []);
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
  const ref = 'skills/create-skill/references/plugin-marketplace-sources.md';
  assert.deepStrictEqual(check('"${CLAUDE_PLUGIN_ROOT}/a" in hooks.json', ref), []);
  assert.deepStrictEqual(check('"${CLAUDE_PLUGIN_ROOT}/a"', 'skills/create-skill/SKILL.md'), ['CLAUDE_PLUGIN_* variable']);
  assert.deepStrictEqual(check('see .claude/x', ref), ['.claude/ path']);
});

test('hooks/**, hooks.json and verbatim entries are exempt; everything else is checked', () => {
  const text = 'process.env.CLAUDE_PLUGIN_DATA and .claude/.rig.json and hooks.json';
  assert.deepStrictEqual(check(text, 'hooks/lib/x.cjs'), []);
  assert.deepStrictEqual(check(text, 'hooks.json'), []);
  assert.deepStrictEqual(findLeftovers([{ path: 'scripts/a.cjs', text, verbatim: true }]), []);
  assert.ok(check(text, 'scripts/a.cjs').length > 0);
});

test('create-skill may quote the rig: namespace as an example', () => {
  assert.deepStrictEqual(check('name: rig:my-skill', 'skills/create-skill/references/a.md'), []);
  assert.deepStrictEqual(check('name: rig:my-skill', 'skills/plan/SKILL.md'), ['rig:<x> prefix without a plugin skill']);
});

test('the allowlist stays small and each entry says why', () => {
  assert.ok(ALLOWED.length <= 4);
  for (const a of ALLOWED) assert.ok(a.name && a.reason && a.span.global, a.name);
});
