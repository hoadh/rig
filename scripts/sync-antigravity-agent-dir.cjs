#!/usr/bin/env node
/**
 * Regenerates the Antigravity copy of the kit from the Claude Code kit.
 *
 *   node scripts/sync-antigravity-agent-dir.cjs
 *
 * Source (git-tracked files only, so .env files and venvs never leak):
 *   plugins/rig/skills/  → .agent/skills/     (minus Claude Code-only skills)
 *   plugins/rig/agents/  → .agent/agents/     (role files the rules point to; Antigravity has no subagents)
 *   plugins/rig/rules/core-rules.md → .agent/rules/ (+ the concept mapping rule; nothing else lives there)
 *   plugins/rig/scripts/ (docs validator and migrator) → .agent/scripts/
 *   .claude/.mcp.json.example → .agent/.mcp.json.example  (project-level sample, not part of the plugin)
 *   user-invocable skills → .agent/workflows/<name>.md  (`/<name>` loads the skill)
 *   core-rules.md + CLAUDE.md + concept pointer → GEMINI.md
 * Claude Code-only frontmatter keys are stripped from skills and agents.
 * .agent/README.md is hand-written and kept. Everything else under .agent/ is replaced.
 *
 * The output is checked for Claude Code-only leftovers (`.claude/`, plugin variables, bin names, ...) before
 * anything is written; a leftover fails the sync. `--check-leftovers` runs only that check on the committed files.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const t = require('./antigravity/claude-to-antigravity-text-rewrite.cjs');
const { filterClaudeCodeOnlyFrontmatter } = require('./antigravity/claude-code-only-frontmatter-filter.cjs');
const { findLeftovers } = require('./antigravity/antigravity-output-leftover-check.cjs');

const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.join(ROOT, '.agent');
const CONCEPT_RULE = path.join(__dirname, 'antigravity', 'claude-code-concepts-in-antigravity.md');
const PLUGIN_ROOT = 'plugins/rig';
// Skill dirs the 1.x kit called rig-plan / rig-debug: text that still names the old dirs maps to the new ones.
const LEGACY_SKILL_DIR_RENAMES = [['rig-plan', 'plan'], ['rig-debug', 'debug']];
const GENERATED = ['skills', 'workflows', 'agents', 'rules', 'scripts', 'schemas', '.agent.json', '.mcp.json.example'];
const README = path.join(AGENT_DIR, 'README.md');

function trackedFiles(prefix) {
  const res = spawnSync('git', ['ls-files', '-z', '--', prefix], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ls-files ${prefix} failed: ${res.stderr}`);
  return res.stdout.split('\0').filter(Boolean);
}

const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Every output is built in memory first; .agent/ is wiped only after all sources were read.
const outputs = new Map();

function writeFile(dest, content, mode) {
  if (outputs.has(dest)) throw new Error(`two sources map to ${path.relative(ROOT, dest)}`);
  outputs.set(dest, { content, mode });
}

/** Copy one tracked file, rewriting text and keeping binaries and file modes as they are. */
function copyRewritten(srcRel, dest, rewrite, transform = (s) => s) {
  const src = path.join(ROOT, srcRel);
  const buf = fs.readFileSync(src);
  const mode = fs.statSync(src).mode & 0o777;
  writeFile(dest, buf.includes(0) ? buf : transform(rewrite(buf.toString('utf8'))), mode);
}

/** Text files of the output (or of the committed tree) as `{ path, text }`, for the leftover check. */
const textEntries = (entries) => entries
  .filter(({ content }) => typeof content === 'string' || !content.includes(0))
  .map(({ file, content }) => ({ path: path.relative(ROOT, file).split(path.sep).join('/'), text: content.toString('utf8') }));

function binNames() {
  return trackedFiles(`${PLUGIN_ROOT}/bin`).map((rel) => path.basename(rel));
}

/** Fail with the list of leftovers; the message says how to fix them. */
function assertNoLeftovers(entries) {
  const leftovers = findLeftovers(textEntries(entries), { binNames: binNames() });
  if (!leftovers.length) return;
  const lines = leftovers.slice(0, 30).map((l) => `  ${l.path}:${l.line}  [${l.id}]  ${l.text}`);
  const more = leftovers.length > 30 ? `\n  ... and ${leftovers.length - 30} more` : '';
  throw new Error(`${leftovers.length} Claude Code-only reference(s) left in the Antigravity output. Add a rewrite rule in scripts/antigravity/claude-to-antigravity-text-rewrite.cjs, or an allowlist entry in antigravity-output-leftover-check.cjs:\n${lines.join('\n')}${more}`);
}

/** Every file under .agent/ plus GEMINI.md as currently committed. */
function readCommittedOutput(dir = AGENT_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readCommittedOutput(full, out);
    else out.push({ file: full, content: fs.readFileSync(full) });
  }
  if (dir === AGENT_DIR) out.push({ file: path.join(ROOT, 'GEMINI.md'), content: fs.readFileSync(path.join(ROOT, 'GEMINI.md')) });
  return out;
}

function flushOutputs() {
  for (const [dest, { content, mode }] of outputs) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    if (mode) fs.chmodSync(dest, mode);
  }
}

function collectSkills(skillFiles) {
  const skills = [];
  for (const rel of skillFiles) {
    const m = /^plugins\/rig\/skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (!m || t.CLAUDE_ONLY_SKILL_DIRS.has(m[1])) continue;
    const fm = t.parseFrontmatter(readText(rel));
    const name = t.agentSkillName(fm.name, m[1]);
    // The name becomes a directory and a workflow file name, so keep it a plain slug.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`unsafe skill name "${name}" in ${rel}`);
    skills.push({ dir: m[1], name, fm });
  }
  return skills;
}

function main() {
  const skillFiles = trackedFiles(`${PLUGIN_ROOT}/skills`);
  const skills = collectSkills(skillFiles);
  const byDir = new Map(skills.map((s) => [s.dir, s]));
  const renames = new Map([...LEGACY_SKILL_DIR_RENAMES, ...skills.filter((s) => s.name !== s.dir).map((s) => [s.dir, s.name])]);
  const rewrite = t.createTextRewriter(renames, new Set(skills.map((s) => s.name)));
  // INSTALLATION.md explains where the plugin root `<kit>` is; in .agent/ the kit dir is always `.agent`.
  const rewriteSkillText = (text, ctx) => t.dropClaudeOnlyFileLines(rewrite(t.dropSection(text, 'Where is `<kit>`?'), ctx));

  let skillFileCount = 0;
  for (const rel of skillFiles) {
    const parts = rel.split('/').slice(3); // drop "plugins/rig/skills"
    if (parts.length > 1 && t.CLAUDE_ONLY_SKILL_DIRS.has(parts[0])) continue;
    if (t.CLAUDE_ONLY_SKILL_FILES.has(parts.join('/'))) continue;
    const skill = parts.length > 1 ? byDir.get(parts[0]) : null;
    if (skill) parts[0] = skill.name;
    const isSkillMd = skill && parts.length === 2 && parts[1] === 'SKILL.md';
    const rewriteForSkill = (text) => rewriteSkillText(text, { skillName: skill && skill.name });
    copyRewritten(rel, path.join(AGENT_DIR, 'skills', ...parts), rewriteForSkill,
      isSkillMd ? (s) => filterClaudeCodeOnlyFrontmatter(t.setFrontmatterName(s, skill.name)) : undefined);
    skillFileCount++;
  }

  const agentFiles = trackedFiles(`${PLUGIN_ROOT}/agents`).filter((rel) => rel.endsWith('.md'));
  for (const rel of agentFiles) copyRewritten(rel, path.join(AGENT_DIR, 'agents', path.basename(rel)), rewrite, filterClaudeCodeOnlyFrontmatter);

  for (const file of t.AGENT_SCRIPT_FILES) copyRewritten(`${PLUGIN_ROOT}/scripts/${file}`, path.join(AGENT_DIR, 'scripts', file), rewrite);

  const rulesDir = path.join(AGENT_DIR, 'rules');
  for (const file of t.SYNCED_RULE_FILES) writeFile(path.join(rulesDir, file), t.convertRule(readText(`${PLUGIN_ROOT}/rules/${file}`), rewrite));
  writeFile(path.join(rulesDir, path.basename(CONCEPT_RULE)), fs.readFileSync(CONCEPT_RULE, 'utf8'));
  writeFile(path.join(ROOT, 'GEMINI.md'), t.buildGeminiMd(readText(`${PLUGIN_ROOT}/rules/core-rules.md`), readText('CLAUDE.md'), rewrite));

  const invocable = skills.filter((s) => s.fm['user-invocable'] !== 'false');
  for (const s of invocable) writeFile(path.join(AGENT_DIR, 'workflows', `${s.name}.md`), t.buildWorkflow(s.name, rewrite(s.fm.description || '')));

  if (fs.existsSync(path.join(ROOT, '.claude/.mcp.json.example'))) {
    copyRewritten('.claude/.mcp.json.example', path.join(AGENT_DIR, '.mcp.json.example'), rewrite);
  }

  // The hand-written README is part of the output too; it is read from disk because the sync keeps it.
  assertNoLeftovers([...[...outputs].map(([file, { content }]) => ({ file, content })), { file: README, content: fs.readFileSync(README) }]);

  for (const entry of GENERATED) fs.rmSync(path.join(AGENT_DIR, entry), { recursive: true, force: true });
  flushOutputs();

  console.log(`✓ .agent/skills: ${skills.length} skills (${skillFileCount} files), skipped: ${[...t.CLAUDE_ONLY_SKILL_DIRS].join(', ')}`);
  console.log(`✓ .agent/workflows: ${invocable.length}  .agent/agents: ${agentFiles.length}  .agent/scripts: ${t.AGENT_SCRIPT_FILES.length}  .agent/rules: ${t.SYNCED_RULE_FILES.length + 1}  GEMINI.md`);
  console.log('✓ no Claude Code-only leftovers');
}

try {
  if (process.argv.includes('--check-leftovers')) {
    assertNoLeftovers(readCommittedOutput());
    console.log('✓ no Claude Code-only leftovers in .agent/ and GEMINI.md');
  } else {
    main();
  }
} catch (err) {
  console.error(`✗ Sync failed: ${err.message}`);
  process.exit(1);
}
