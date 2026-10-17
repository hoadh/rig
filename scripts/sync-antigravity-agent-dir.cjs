#!/usr/bin/env node
/**
 * Regenerates the Antigravity copy of the kit from the Claude Code kit.
 *
 *   node scripts/sync-antigravity-agent-dir.cjs
 *
 * Source (git-tracked files only, so .env files and venvs never leak):
 *   .claude/skills/  → .agent/skills/     (minus Claude Code-only skills; rig-plan → plan, ...)
 *   .claude/agents/  → .agent/agents/     (role files the rules point to; Antigravity has no subagents)
 *   .claude/rules/   → .agent/rules/      (+ project-instructions.md from CLAUDE.md, + concept mapping rule)
 *   user-invocable skills → .agent/workflows/<name>.md  (`/<name>` loads the skill)
 *   CLAUDE.md        → GEMINI.md
 * .agent/README.md is hand-written and kept. Everything else under .agent/ is replaced.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const t = require('./antigravity/claude-to-antigravity-text-rewrite.cjs');

const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.join(ROOT, '.agent');
const CONCEPT_RULE = path.join(__dirname, 'antigravity', 'claude-code-concepts-in-antigravity.md');
const GENERATED = ['skills', 'workflows', 'agents', 'rules', 'schemas', '.agent.json', '.mcp.json.example'];
// Files that explain the mapping and may name .claude/ on purpose; skipped by the leftover check.
const HAND_WRITTEN = new Set([path.join(AGENT_DIR, 'README.md'), path.join(AGENT_DIR, 'rules', path.basename(CONCEPT_RULE))]);

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
    const m = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (!m || t.CLAUDE_ONLY_SKILL_DIRS.has(m[1])) continue;
    const fm = t.parseFrontmatter(readText(rel));
    const name = t.agentSkillName(fm.name, m[1]);
    // The name becomes a directory and a workflow file name, so keep it a plain slug.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`unsafe skill name "${name}" in ${rel}`);
    skills.push({ dir: m[1], name, fm });
  }
  return skills;
}

/** Files under .agent/ that still reference project `.claude/` paths or `/rig:` commands. */
function findLeftovers(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findLeftovers(full, found);
    else if (HAND_WRITTEN.has(full)) continue;
    else {
      const buf = fs.readFileSync(full);
      if (!buf.includes(0) && /(^|[^\w/~.}-])\.claude\/|\/rig:(?!remote|team)[a-z]/m.test(buf.toString('utf8'))) found.push(path.relative(ROOT, full));
    }
  }
  return found;
}

function main() {
  const skillFiles = trackedFiles('.claude/skills');
  const skills = collectSkills(skillFiles);
  const byDir = new Map(skills.map((s) => [s.dir, s]));
  const renames = new Map(skills.filter((s) => s.name !== s.dir).map((s) => [s.dir, s.name]));
  const rewrite = t.createTextRewriter(renames, new Set(skills.map((s) => s.name)));
  const rewriteSkillText = (text) => t.dropClaudeOnlyFileLines(rewrite(text));

  let skillFileCount = 0;
  for (const rel of skillFiles) {
    const parts = rel.split('/').slice(2); // drop ".claude/skills"
    if (parts.length > 1 && t.CLAUDE_ONLY_SKILL_DIRS.has(parts[0])) continue;
    if (t.CLAUDE_ONLY_SKILL_FILES.has(parts.join('/'))) continue;
    const skill = parts.length > 1 ? byDir.get(parts[0]) : null;
    if (skill) parts[0] = skill.name;
    const isSkillMd = skill && parts.length === 2 && parts[1] === 'SKILL.md';
    copyRewritten(rel, path.join(AGENT_DIR, 'skills', ...parts), rewriteSkillText,
      isSkillMd ? (s) => t.setFrontmatterName(s, skill.name) : undefined);
    skillFileCount++;
  }

  const agentFiles = trackedFiles('.claude/agents').filter((rel) => rel.endsWith('.md'));
  for (const rel of agentFiles) copyRewritten(rel, path.join(AGENT_DIR, 'agents', path.basename(rel)), rewrite);

  const rulesDir = path.join(AGENT_DIR, 'rules');
  for (const file of t.SYNCED_RULE_FILES) writeFile(path.join(rulesDir, file), t.convertRule(readText(`.claude/rules/${file}`), rewrite));
  const claudeMd = readText('CLAUDE.md');
  writeFile(path.join(rulesDir, 'project-instructions.md'), t.convertProjectInstructions(claudeMd, rewrite, 'Project Instructions'));
  writeFile(path.join(rulesDir, path.basename(CONCEPT_RULE)), fs.readFileSync(CONCEPT_RULE, 'utf8'));
  writeFile(path.join(ROOT, 'GEMINI.md'), t.convertProjectInstructions(claudeMd, rewrite, 'GEMINI.md'));

  const invocable = skills.filter((s) => s.fm['user-invocable'] !== 'false');
  for (const s of invocable) writeFile(path.join(AGENT_DIR, 'workflows', `${s.name}.md`), t.buildWorkflow(s.name, rewrite(s.fm.description || '')));

  if (fs.existsSync(path.join(ROOT, '.claude/.mcp.json.example'))) {
    copyRewritten('.claude/.mcp.json.example', path.join(AGENT_DIR, '.mcp.json.example'), rewrite);
  }

  for (const entry of GENERATED) fs.rmSync(path.join(AGENT_DIR, entry), { recursive: true, force: true });
  flushOutputs();

  console.log(`✓ .agent/skills: ${skills.length} skills (${skillFileCount} files), skipped: ${[...t.CLAUDE_ONLY_SKILL_DIRS].join(', ')}`);
  console.log(`✓ .agent/workflows: ${invocable.length}  .agent/agents: ${agentFiles.length}  .agent/rules: ${t.SYNCED_RULE_FILES.length + 2}  GEMINI.md`);
  const leftovers = findLeftovers(AGENT_DIR);
  if (leftovers.length) {
    console.log(`! ${leftovers.length} file(s) still mention .claude/ or /rig: (review them):`);
    leftovers.slice(0, 20).forEach((f) => console.log(`  ${f}`));
  }
}

try {
  main();
} catch (err) {
  console.error(`✗ Sync failed: ${err.message}`);
  process.exit(1);
}
