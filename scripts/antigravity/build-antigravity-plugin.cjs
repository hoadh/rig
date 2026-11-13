/**
 * Builds the Antigravity plugin (antigravity/rig/) from the Claude Code plugin (plugins/rig/) in memory.
 * `buildOutputs` returns a Map of plugin-relative POSIX path -> `{ content, mode, verbatim }`; it writes nothing.
 * `verbatim` marks code copied byte for byte (hooks and adapter scripts): the leftover check skips it.
 *
 * Output: .antigravity-plugin/plugin.json, README.md, rules/AGENTS.md, skills/, agents/, scripts/, hooks/, hooks.json.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const t = require('./claude-to-antigravity-text-rewrite.cjs');
const { filterClaudeCodeOnlyFrontmatter } = require('./claude-code-only-frontmatter-filter.cjs');
const { mapAgentFrontmatter } = require('./agent-frontmatter-mapper.cjs');
const { buildManifest } = require('./plugin-manifest-writer.cjs');
const { collectHookFiles } = require('./hook-files-collector.cjs');
const { buildRulesFile, buildReadme } = require('./plugin-docs-writer.cjs');

const PLUGIN_SRC = 'plugins/rig';
const ADAPTER_DIR = 'scripts/antigravity';
const HOOKS_JSON_MODULE = 'hooks/antigravity-hooks-json.cjs';
// Agents whose text calls a skill's scripts by a skill-relative path (`npx tsx scripts/cli.ts`).
const AGENT_SCRIPT_SKILL = new Map([['mcp-runner.md', 'mcp']]);
// Skill dirs the 1.x kit called rig-plan / rig-debug: text that still names the old dirs maps to the new ones.
const LEGACY_SKILL_DIR_RENAMES = [['rig-plan', 'plan'], ['rig-debug', 'debug']];

/** Git-tracked files under `prefix` (repo-relative POSIX paths), so .env files and venvs never leak. */
function gitTrackedFiles(root, prefix) {
  const res = spawnSync('git', ['ls-files', '-z', '--', prefix], { cwd: root, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ls-files ${prefix} failed: ${res.stderr}`);
  return res.stdout.split('\0').filter(Boolean);
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Non-test `.cjs` files (no `__tests__/` or `__fixtures__/` helpers) under a repo-relative dir, as repo-relative POSIX paths, sorted. */
function ownedCjsFiles(root, relDir) {
  return walkFiles(path.join(root, relDir))
    .filter((f) => f.endsWith('.cjs') && !f.endsWith('.test.cjs') && !/(^|[\\/])__(tests|fixtures)__[\\/]/.test(path.relative(path.join(root, relDir), f)))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
}

function collectSkills(root, skillFiles) {
  const skills = [];
  for (const rel of skillFiles) {
    const m = /^plugins\/rig\/skills\/([^/]+)\/SKILL\.md$/.exec(rel);
    if (!m || t.CLAUDE_ONLY_SKILL_DIRS.has(m[1])) continue;
    const fm = t.parseFrontmatter(fs.readFileSync(path.join(root, rel), 'utf8'));
    const name = t.agentSkillName(fm.name, m[1]);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`unsafe skill name "${name}" in ${rel}`);
    skills.push({ dir: m[1], name, fm });
  }
  return skills;
}

/**
 * @param {{ root: string, listFiles?: (root: string, prefix: string) => string[] }} opts
 * @returns {{ outputs: Map<string, {content: string|Buffer, mode?: number, verbatim?: boolean}>, stats: object }}
 */
function buildOutputs({ root, listFiles = gitTrackedFiles }) {
  const outputs = new Map();
  const put = (rel, content, { mode, verbatim = false } = {}) => {
    if (outputs.has(rel)) throw new Error(`two sources map to ${rel}`);
    outputs.set(rel, { content, mode, verbatim });
  };
  const read = (rel) => fs.readFileSync(path.join(root, rel));
  const modeOf = (rel) => fs.statSync(path.join(root, rel)).mode & 0o777;
  /** Copy a source file: text through `transform`, binaries and file modes untouched. */
  const copy = (srcRel, destRel, transform = (s) => s, opts = {}) => {
    const buf = read(srcRel);
    put(destRel, buf.includes(0) || opts.verbatim ? buf : transform(buf.toString('utf8')), { mode: modeOf(srcRel), ...opts });
  };

  const skillFiles = listFiles(root, `${PLUGIN_SRC}/skills`);
  const skills = collectSkills(root, skillFiles);
  const byDir = new Map(skills.map((s) => [s.dir, s]));
  const renames = new Map([...LEGACY_SKILL_DIR_RENAMES, ...skills.filter((s) => s.name !== s.dir).map((s) => [s.dir, s.name])]);
  const rewrite = t.createTextRewriter(renames, new Set(skills.map((s) => s.name)));
  // INSTALLATION.md explains where the plugin root `<kit>` is; here the root is `<Rig root>`.
  const rewriteSkillText = (text, ctx) => t.dropClaudeOnlyFileLines(rewrite(t.dropSection(text, 'Where is `<kit>`?'), ctx));

  for (const rel of skillFiles) {
    const parts = rel.split('/').slice(3); // drop "plugins/rig/skills"
    if (parts.length > 1 && t.CLAUDE_ONLY_SKILL_DIRS.has(parts[0])) continue;
    if (t.CLAUDE_ONLY_SKILL_FILES.has(parts.join('/'))) continue;
    const skill = parts.length > 1 ? byDir.get(parts[0]) : null;
    if (skill) parts[0] = skill.name;
    const isSkillMd = skill && parts.length === 2 && parts[1] === 'SKILL.md';
    const text = (s) => rewriteSkillText(s, { skillName: skill && skill.name });
    // Only Markdown is rewritten. Code, manifests and data (.py, .js, package.json, ...) are copied byte for byte: the
    // rewrite would turn `<Rig root>` into a shell redirect in package.json and delete lines from Python.
    if (!rel.endsWith('.md')) copy(rel, `skills/${parts.join('/')}`, (s) => s, { verbatim: true });
    else copy(rel, `skills/${parts.join('/')}`, isSkillMd ? (s) => filterClaudeCodeOnlyFrontmatter(t.setFrontmatterName(text(s), skill.name)) : text);
  }

  const agentFiles = listFiles(root, `${PLUGIN_SRC}/agents`).filter((rel) => rel.endsWith('.md'));
  for (const rel of agentFiles) {
    const skillName = AGENT_SCRIPT_SKILL.get(path.basename(rel));
    copy(rel, `agents/${path.basename(rel)}`, (s) => mapAgentFrontmatter(rewrite(s, { skillName })));
  }

  for (const file of t.AGENT_SCRIPT_FILES) copy(`${PLUGIN_SRC}/scripts/${file}`, `scripts/${file}`, (s) => s, { verbatim: true });
  const adapterScripts = ownedCjsFiles(root, `${ADAPTER_DIR}/scripts`);
  for (const rel of adapterScripts) copy(rel, `scripts/${rel.slice(`${ADAPTER_DIR}/scripts/`.length)}`, (s) => s, { verbatim: true });

  const adapterPath = path.join(root, ADAPTER_DIR, HOOKS_JSON_MODULE);
  delete require.cache[require.resolve(adapterPath)]; // a long-lived process must not see a stale hooks.json
  const adapter = require(adapterPath);
  if (!adapter || typeof adapter.hooksJson !== 'object' || !Array.isArray(adapter.portedHooks)) {
    throw new Error(`${ADAPTER_DIR}/${HOOKS_JSON_MODULE} must export { hooksJson, portedHooks }`);
  }
  put('hooks.json', `${JSON.stringify(adapter.hooksJson, null, 2)}\n`, { verbatim: true });
  const adapterHooks = ownedCjsFiles(root, `${ADAPTER_DIR}/hooks`)
    .filter((rel) => rel !== `${ADAPTER_DIR}/${HOOKS_JSON_MODULE}`); // generator input, not runtime code
  // The adapter's own requires count too: they must ship even if no Claude hook happens to pull them in.
  const extraSources = [
    ...adapterHooks.map((rel) => ({ rel: `hooks/${rel.slice(`${ADAPTER_DIR}/hooks/`.length)}`, text: read(rel).toString('utf8') })),
    ...adapterScripts.map((rel) => ({ rel: `scripts/${rel.slice(`${ADAPTER_DIR}/scripts/`.length)}`, text: read(rel).toString('utf8') })),
  ];
  for (const rel of collectHookFiles(path.join(root, PLUGIN_SRC), adapter.portedHooks, extraSources)) {
    copy(`${PLUGIN_SRC}/${rel}`, rel, (s) => s, { verbatim: true });
  }
  for (const rel of adapterHooks) copy(rel, `hooks/${rel.slice(`${ADAPTER_DIR}/hooks/`.length)}`, (s) => s, { verbatim: true });

  const claudeManifest = JSON.parse(read(`${PLUGIN_SRC}/.claude-plugin/plugin.json`).toString('utf8'));
  const { n } = JSON.parse(read(`${ADAPTER_DIR}/agy-version.json`).toString('utf8'));
  const manifest = buildManifest({ claudeManifest, n });
  put('.antigravity-plugin/plugin.json', `${JSON.stringify(manifest, null, 2)}\n`);
  put('rules/AGENTS.md', buildRulesFile({
    coreRules: t.convertRule(read(`${PLUGIN_SRC}/rules/core-rules.md`).toString('utf8'), rewrite),
    conceptNote: read(`${ADAPTER_DIR}/claude-code-concepts-in-antigravity.md`).toString('utf8'),
  }));
  put('README.md', buildReadme({ version: claudeManifest.version, agyVersion: manifest.version }));

  return { outputs, stats: { skills: skills.length, agents: agentFiles.length, files: outputs.size, version: manifest.version } };
}

module.exports = { buildOutputs, gitTrackedFiles, PLUGIN_SRC };
