// Run: node --test scripts/antigravity/claude-to-antigravity-text-rewrite.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const t = require('./claude-to-antigravity-text-rewrite.cjs');

const rewrite = t.createTextRewriter(new Map([['rig-plan', 'plan']]), new Set(['plan', 'fix']));

test('project .claude/ paths become .agent/, user ~/.claude/ files stay', () => {
  assert.strictEqual(rewrite('see .claude/rules/x.md and ./.claude/y'), 'see .agent/rules/x.md and ./.agent/y');
  assert.strictEqual(rewrite('`~/.claude/rig-machines.json`'), '`~/.claude/rig-machines.json`');
  assert.strictEqual(rewrite('$HOME/.claude/.env'), '$HOME/.claude/.env');
  assert.strictEqual(rewrite('.claude-archived/a'), '.claude-archived/a');
});

test('user-level skill paths point to the project copy', () => {
  assert.strictEqual(rewrite('node ~/.claude/skills/fix/a.cjs'), 'node .agent/skills/fix/a.cjs');
  assert.strictEqual(rewrite('$HOME/.claude/skills/x'), '.agent/skills/x');
});

test('renamed skill dirs and rig: commands', () => {
  assert.strictEqual(rewrite('.claude/skills/rig-plan/references/a.md'), '.agent/skills/plan/references/a.md');
  assert.strictEqual(rewrite('skills/rig-planner/x'), 'skills/rig-planner/x');
  assert.strictEqual(rewrite('run /rig:plan then `rig:fix`'), 'run /plan then `fix`');
  assert.strictEqual(rewrite('use /rig:remote'), 'use /rig:remote');
  assert.strictEqual(rewrite('xrig:plan'), 'xrig:plan');
});

test('parseFrontmatter reads quoted, plain and folded values', () => {
  const fm = t.parseFrontmatter('---\nname: rig:plan\ndescription: >-\n  Line one\n  line two\nuser-invocable: false\n---\nbody');
  assert.deepStrictEqual(fm, { name: 'rig:plan', description: 'Line one line two', 'user-invocable': 'false' });
  assert.strictEqual(t.parseFrontmatter('---\ndescription: "a: b"\n---').description, 'a: b');
  assert.deepStrictEqual(t.parseFrontmatter('no frontmatter'), {});
});

test('agentSkillName strips the rig: prefix', () => {
  assert.strictEqual(t.agentSkillName('rig:debug', 'rig-debug'), 'debug');
  assert.strictEqual(t.agentSkillName(undefined, 'diataxis-writer'), 'diataxis-writer');
});

test('buildWorkflow quotes and shortens the description', () => {
  const wf = t.buildWorkflow('fix', `say "hi": ${'x '.repeat(200)}`);
  const desc = JSON.parse(/^description: (.*)$/m.exec(wf)[1]);
  assert.ok(desc.startsWith('say "hi":') && desc.length <= 250 && desc.endsWith('...'));
  assert.match(wf, /\.agent\/skills\/fix\/SKILL\.md/);
});

test('convertProjectInstructions drops hook section and keeps header accurate', () => {
  const md = '# CLAUDE.md\n\nThis file provides guidance to Claude Code here.\n\n**IMPORTANT:** DO NOT modify skills in `~/.claude/skills`.\nRead ./CLAUDE.md\n\n## Hook Response Protocol\n\nask\n\n## Git\n\nok\n';
  const out = t.convertProjectInstructions(md, rewrite, 'GEMINI.md');
  assert.match(out, /^# GEMINI\.md/);
  assert.match(out, /generated from `CLAUDE\.md`/);
  assert.match(out, /Read \.\/GEMINI\.md/);
  assert.doesNotMatch(out, /Hook Response|DO NOT modify skills/);
  assert.match(out, /## Git\n\nok/);
});

test('setFrontmatterName replaces only the name line', () => {
  assert.strictEqual(t.setFrontmatterName('---\nname: rig:plan\nx: 1\n---\nname: body', 'plan'), '---\nname: plan\nx: 1\n---\nname: body');
  assert.strictEqual(t.setFrontmatterName('---\nx: 1\n---\nname: body', 'plan'), '---\nx: 1\n---\nname: body');
});

test('dropClaudeOnlyFileLines removes only lines naming a Claude Code-only file', () => {
  const text = 'keep\nLoad: `references/multi-machine-planning.md`.\nalso keep';
  assert.strictEqual(t.dropClaudeOnlyFileLines(text), 'keep\nalso keep');
  assert.ok(t.CLAUDE_ONLY_SKILL_FILES.has('rig-plan/references/multi-machine-planning.md'));
});
