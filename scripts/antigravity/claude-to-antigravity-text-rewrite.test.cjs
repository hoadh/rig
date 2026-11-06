// Run: node --test scripts/antigravity/claude-to-antigravity-text-rewrite.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const t = require('./claude-to-antigravity-text-rewrite.cjs');

const rewrite = t.createTextRewriter(new Map([['rig-plan', 'plan']]), new Set(['plan', 'fix']));

test('project .claude/ paths become .agent/, user ~/.claude/ files stay', () => {
  assert.strictEqual(rewrite('Rules: `plugins/rig/rules/core-rules.md`, skills in plugins/rig/skills/'), 'Rules: `.agent/rules/core-rules.md`, skills in .agent/skills/');
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

test('plugin bin commands whose script ships in a synced skill map back to the skill script', () => {
  assert.strictEqual(rewrite('`rig-worktree info --json`'), '`node .agent/skills/worktree/scripts/worktree.cjs info --json`');
  assert.strictEqual(rewrite('rig-ui-search "x" --domain ux'), 'python .agent/skills/ui-design/scripts/search.py "x" --domain ux');
  assert.strictEqual(rewrite('SKILL_DIR="$(rig-browser --dir)"'), 'SKILL_DIR=".agent/skills/browser/scripts"');
  assert.strictEqual(rewrite('cd "$(rig-skill-dir mcp)/scripts"'), 'cd ".agent/skills/mcp/scripts"');
  assert.strictEqual(rewrite('rig-browser screenshot --url x'), 'node .agent/skills/browser/scripts/screenshot.js --url x');
  assert.strictEqual(rewrite('run `rig-skill-dir markdown-viewer`; start'), 'run `.agent/skills/markdown-viewer`; start');
  assert.strictEqual(rewrite('bin/rig-worktree and rig-worktree.cjs and my-rig-worktree'), 'bin/rig-worktree and rig-worktree.cjs and my-rig-worktree');
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

test('buildGeminiMd = core rules + project instructions + concept pointer, headings nested', () => {
  const core = '# Core Rules\n\n- Use /rig:plan for big work\n- see CLAUDE.md\n';
  const md = '# CLAUDE.md\n\nGuidance for Claude Code (claude.ai/code) in this repository.\n\n**IMPORTANT:** DO NOT modify skills in `~/.claude/skills`.\nRead ./CLAUDE.md\n\n## Hook Response Protocol\n\nask\n\n## Git\n\nok\n```bash\n## not a heading\n```\n';
  const out = t.buildGeminiMd(core, md, rewrite);
  assert.match(out, /^# GEMINI\.md\n/);
  assert.strictEqual(out.match(/^# /gm).length, 1);
  assert.ok(out.indexOf('## Core rules') < out.indexOf('## Project instructions') && out.indexOf('## Project instructions') < out.indexOf('## Claude Code concepts'));
  assert.match(out, /- Use \/plan for big work\n- see GEMINI\.md/);
  assert.match(out, /Read \.\/GEMINI\.md/);
  assert.match(out, /### Git\n\nok/);
  assert.match(out, /```bash\n## not a heading\n```/);
  assert.match(out, /claude-code-concepts-in-antigravity\.md/);
  assert.doesNotMatch(out, /Hook Response|DO NOT modify skills|Guidance for Claude Code|# Core Rules/);
});

test('plugin-only bins: docs tools map to copied scripts, python to the venv', () => {
  assert.strictEqual(rewrite('rig-validate-docs docs/'), 'node .agent/scripts/validate-docs.cjs docs/');
  assert.strictEqual(rewrite('`rig-migrate-docs docs/ --apply`'), '`node .agent/scripts/migrate-docs-to-diataxis-layout.cjs docs/ --apply`');
  assert.strictEqual(rewrite('rig-python scan.py'), '.agent/skills/.venv/bin/python3 scan.py');
  assert.ok(t.AGENT_SCRIPT_FILES.includes('validate-docs.cjs') && t.AGENT_SCRIPT_FILES.includes('migrate-docs-to-diataxis-layout.cjs'));
});

test('set-active-plan becomes a note, resolve-env lines are dropped', () => {
  assert.match(rewrite('After creating plan: `rig-set-active-plan {plan-dir}`'), /^After creating plan: no command needed: Antigravity has no active-plan marker/);
  assert.match(rewrite('```bash\n  rig-set-active-plan {plan-dir}\n```'), /```bash\n {2}# no command needed: Antigravity has no active-plan marker.*\n```/);
  assert.doesNotMatch(rewrite('a\n  $ rig-set-active-plan x\nb'), /rig-set-active-plan/);
  assert.strictEqual(rewrite('a\nprint("rig-resolve-env --show-hierarchy")\nb'), 'a\nb');
  assert.strictEqual(rewrite('a\r\nrig-resolve-env x\r\nb'), 'a\r\nb');
  assert.strictEqual(rewrite('my-rig-resolve-env.py stays'), 'my-rig-resolve-env.py stays');
});

test('more skill-script forms: ${CLAUDE_SKILL_DIR}, rig-browser --dir, <kit>, backslash paths, browser output dirs', () => {
  assert.strictEqual(rewrite('${CLAUDE_SKILL_DIR}/scripts/a.py', { skillName: 'media' }), '.agent/skills/media/scripts/a.py');
  assert.strictEqual(rewrite('${CLAUDE_SKILL_DIR}/a'), '${CLAUDE_SKILL_DIR}/a');
  assert.strictEqual(rewrite('(`rig-browser --dir`) or rig-browser <script> --args'), '(`.agent/skills/browser/scripts`) or node .agent/skills/browser/scripts/<script>.js --args');
  assert.strictEqual(rewrite('cd <kit>/skills and <kit>\\skills'), 'cd .agent/skills and .agent\\skills');
  assert.strictEqual(rewrite('(`.claude\\skills\\.venv`) ..\\.claude\\.mcp.json'), '(`.agent\\skills\\.venv`) ..\\.agent\\.mcp.json');
  assert.strictEqual(rewrite('`<project>/.claude/browser/logs/` and $SKILL_DIR/.claude/browser/tmp'), '`<project>/.agent/browser/logs/` and $SKILL_DIR/.agent/browser/tmp');
  assert.strictEqual(rewrite('{project_dir}/.claude/.env and ~/.claude/.env'), '{project_dir}/.claude/.env and ~/.claude/.env');
});

test('setFrontmatterName replaces only the name line', () => {
  assert.strictEqual(t.setFrontmatterName('---\nname: rig:plan\nx: 1\n---\nname: body', 'plan'), '---\nname: plan\nx: 1\n---\nname: body');
  assert.strictEqual(t.setFrontmatterName('---\nx: 1\n---\nname: body', 'plan'), '---\nx: 1\n---\nname: body');
});

test('dropClaudeOnlyFileLines removes only lines naming a Claude Code-only file', () => {
  const text = 'keep\nLoad: `references/multi-machine-planning.md`.\nalso keep';
  assert.strictEqual(t.dropClaudeOnlyFileLines(text), 'keep\nalso keep');
  assert.ok(t.CLAUDE_ONLY_SKILL_FILES.has('plan/references/multi-machine-planning.md'));
});
