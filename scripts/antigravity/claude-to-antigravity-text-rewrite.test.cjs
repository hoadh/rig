// Run: node --test scripts/antigravity/claude-to-antigravity-text-rewrite.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const t = require('./claude-to-antigravity-text-rewrite.cjs');

const rewrite = t.createTextRewriter(new Map([['rig-plan', 'plan']]), new Set(['plan', 'fix']));
const R = '<Rig root>';

test('plugin paths become <Rig root> paths, project .claude/ becomes .agents/, user ~/.claude/ files stay', () => {
  assert.strictEqual(rewrite('Rules: `plugins/rig/rules/core-rules.md`, skills in plugins/rig/skills/'), `Rules: \`${R}/rules/core-rules.md\`, skills in ${R}/skills/`);
  assert.strictEqual(rewrite('see .claude/rules/x.md and ./.claude/y'), 'see .agents/rules/x.md and .agents/y');
  assert.strictEqual(rewrite('`~/.claude/rig-machines.json`'), '`~/.claude/rig-machines.json`');
  assert.strictEqual(rewrite('$HOME/.claude/.env'), '$HOME/.claude/.env');
  assert.strictEqual(rewrite('.claude-archived/a'), '.claude-archived/a');
  assert.strictEqual(rewrite('${CLAUDE_PLUGIN_ROOT}/hooks/x.cjs'), `${R}/hooks/x.cjs`);
  assert.strictEqual(rewrite('ln -sf ../.claude/.mcp.json x'), 'ln -sf ../.agents/.mcp.json x');
});

test('kit skill paths point into the plugin, API-key files stay user data', () => {
  assert.strictEqual(rewrite('node ~/.claude/skills/fix/a.cjs'), `node ${R}/skills/fix/a.cjs`);
  assert.strictEqual(rewrite('$HOME/.claude/skills/x'), `${R}/skills/x`);
  assert.strictEqual(rewrite('cd .claude/skills and ./.claude/skills/media'), `cd ${R}/skills and ${R}/skills/media`);
  assert.strictEqual(rewrite('{dir}/.claude/skills/.env'), '{dir}/.claude/skills/.env');
  assert.strictEqual(rewrite('echo KEY=x > .claude/skills/media/.env'), 'echo KEY=x > .agents/skills/media/.env');
});

test('renamed skill dirs and rig: commands', () => {
  assert.strictEqual(rewrite('.claude/skills/rig-plan/references/a.md'), `${R}/skills/plan/references/a.md`);
  assert.strictEqual(rewrite('skills/rig-planner/x'), 'skills/rig-planner/x');
  assert.strictEqual(rewrite('run /rig:plan then `rig:fix`'), 'run /plan then `fix`');
  assert.strictEqual(rewrite('use /rig:remote'), 'use /rig:remote');
  assert.strictEqual(rewrite('xrig:plan'), 'xrig:plan');
});

test('plugin bin commands map to absolute-style <Rig root> script paths', () => {
  assert.strictEqual(rewrite('`rig-worktree info --json`'), `\`node ${R}/skills/worktree/scripts/worktree.cjs info --json\``);
  assert.strictEqual(rewrite('rig-ui-search "x" --domain ux'), `python3 ${R}/skills/ui-design/scripts/search.py "x" --domain ux`);
  assert.strictEqual(rewrite('SKILL_DIR="$(rig-browser --dir)"'), `SKILL_DIR="${R}/skills/browser/scripts"`);
  assert.strictEqual(rewrite('cd "$(rig-skill-dir mcp)/scripts"'), `cd "${R}/skills/mcp/scripts"`);
  assert.strictEqual(rewrite('rig-browser screenshot --url x'), `node ${R}/skills/browser/scripts/screenshot.js --url x`);
  assert.strictEqual(rewrite('run `rig-skill-dir markdown-viewer`; start'), `run \`${R}/skills/markdown-viewer\`; start`);
  assert.strictEqual(rewrite('bin/rig-worktree and rig-worktree.cjs and my-rig-worktree'), 'bin/rig-worktree and rig-worktree.cjs and my-rig-worktree');
  assert.strictEqual(rewrite('rig-validate-docs docs/'), `node ${R}/scripts/validate-docs.cjs docs/`);
  assert.strictEqual(rewrite('`rig-migrate-docs docs/ --apply`'), `\`node ${R}/scripts/migrate-docs-to-diataxis-layout.cjs docs/ --apply\``);
  assert.strictEqual(rewrite('rig-python scan.py'), 'python3 scan.py');
  assert.ok(t.AGENT_SCRIPT_FILES.includes('validate-docs.cjs') && t.AGENT_SCRIPT_FILES.includes('migrate-docs-to-diataxis-layout.cjs'));
});

test('set-active-plan maps to the Antigravity script, resolve-env lines are dropped', () => {
  assert.strictEqual(rewrite('After creating plan: `rig-set-active-plan {plan-dir}`'), `After creating plan: \`node ${R}/scripts/set-active-plan-antigravity.cjs {plan-dir}\``);
  assert.doesNotMatch(rewrite('a\n  $ rig-set-active-plan x\nb'), /rig-set-active-plan/);
  assert.strictEqual(rewrite('a\nprint("rig-resolve-env --show-hierarchy")\nb'), 'a\nb');
  assert.strictEqual(rewrite('a\r\nrig-resolve-env x\r\nb'), 'a\r\nb');
  assert.strictEqual(rewrite('my-rig-resolve-env.py stays'), 'my-rig-resolve-env.py stays');
});

test('skill-relative forms: ${CLAUDE_SKILL_DIR}, scripts/ calls, <kit>, backslash paths, browser output dirs', () => {
  assert.strictEqual(rewrite('${CLAUDE_SKILL_DIR}/scripts/a.py', { skillName: 'media' }), `${R}/skills/media/scripts/a.py`);
  assert.strictEqual(rewrite('${CLAUDE_SKILL_DIR}/a'), '${CLAUDE_SKILL_DIR}/a');
  assert.strictEqual(rewrite('python scripts/a.py, node ./scripts/b.js and npx ts-node scripts/c.ts', { skillName: 'mcp' }),
    `python ${R}/skills/mcp/scripts/a.py, node ${R}/skills/mcp/scripts/b.js and npx ts-node ${R}/skills/mcp/scripts/c.ts`);
  assert.strictEqual(rewrite('python scripts/a.py'), 'python scripts/a.py');
  assert.strictEqual(rewrite('npx tsx scripts/cli.ts list-tools and python eval-viewer/generate_review.py', { skillName: 'mcp' }),
    `npx tsx ${R}/skills/mcp/scripts/cli.ts list-tools and python ${R}/skills/mcp/eval-viewer/generate_review.py`);
  assert.strictEqual(rewrite('(`rig-browser --dir`) or rig-browser <script> --args'), `(\`${R}/skills/browser/scripts\`) or node ${R}/skills/browser/scripts/<script>.js --args`);
  assert.strictEqual(rewrite('cd <kit>/skills and <kit>\\skills'), `cd ${R}/skills and ${R}\\skills`);
  assert.strictEqual(rewrite('(`.claude\\skills\\.venv`) ..\\.claude\\.mcp.json'), '(`.agents\\skills\\.venv`) ..\\.agents\\.mcp.json');
  assert.strictEqual(rewrite('`<project>/.claude/browser/logs/` and $SKILL_DIR/.claude/browser/tmp'), '`<project>/.agents/browser/logs/` and $SKILL_DIR/.agents/browser/tmp');
  assert.strictEqual(rewrite('{project_dir}/.claude/.env and ~/.claude/.env'), '{project_dir}/.claude/.env and ~/.claude/.env');
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

test('convertRule rewrites paths and CLAUDE.md to AGENTS.md', () => {
  assert.strictEqual(t.convertRule('- Use /rig:plan\n- see CLAUDE.md', rewrite), '- Use /plan\n- see AGENTS.md');
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
