/**
 * Pure text rewrites that turn Claude Code kit files (plugins/rig/) into the Antigravity plugin (antigravity/rig/).
 * No file system access, so every rule can be unit-tested.
 *
 * Antigravity does not expand a plugin-root variable inside SKILL.md, so skill text points at `<Rig root>/...`;
 * the SessionStart hook prints `Rig root: <absolute path>` into the session and the always-on rules explain the token.
 */

const RIG_ROOT = '<Rig root>';

// Skills that only work inside Claude Code (headless `claude -p` workers, Agent Teams, plugin setup via rig-init,
// the Claude Code statusline).
const CLAUDE_ONLY_SKILL_DIRS = new Set(['remote', 'setup', 'statusline', 'team']);
// Files inside synced skills that only drive Claude Code-only skills (paths under plugins/rig/skills/).
// They are not copied, and lines naming them are dropped from the synced text.
const CLAUDE_ONLY_SKILL_FILES = new Set(['plan/references/multi-machine-planning.md']);

// plugins/rig/scripts/ files copied to antigravity/rig/scripts/ (the docs validator and migrator, with the helpers they require).
// Everything else in that dir needs Claude Code hooks, the plugin runtime or the Claude Code env layout.
const AGENT_SCRIPT_FILES = [
  'validate-docs.cjs',
  'docs-diataxis-layout.cjs',
  'migrate-docs-to-diataxis-layout.cjs',
  'migrate-docs-custom-move-map-parser.cjs',
  'migrate-docs-link-rewrite-helpers.cjs',
];


// Claude Code kit text calls plugin bin/ commands by name (`rig-worktree`); Antigravity has no PATH entry for them,
// so each goes back to the script path under the Rig root.
const BIN_COMMANDS_IN_SKILLS = new Map([
  ['rig-worktree', `node ${RIG_ROOT}/skills/worktree/scripts/worktree.cjs`],
  ['rig-markdown-viewer', `node ${RIG_ROOT}/skills/markdown-viewer/scripts/server.cjs`],
  ['rig-classify-doc', `bash ${RIG_ROOT}/skills/diataxis-writer/scripts/classify-doc.sh`],
  ['rig-ui-search', `python3 ${RIG_ROOT}/skills/ui-design/scripts/search.py`],
  ['rig-mcp', `node ${RIG_ROOT}/skills/mcp/scripts/dist/cli.js`],
  // Scripts the generator copies into antigravity/rig/scripts/ (AGENT_SCRIPT_FILES), since they live in plugins/rig/scripts/.
  ['rig-validate-docs', `node ${RIG_ROOT}/scripts/validate-docs.cjs`],
  ['rig-migrate-docs', `node ${RIG_ROOT}/scripts/migrate-docs-to-diataxis-layout.cjs`],
  // The Antigravity variant keys the marker on ANTIGRAVITY_CONVERSATION_ID (scripts/antigravity/scripts/).
  ['rig-set-active-plan', `node ${RIG_ROOT}/scripts/set-active-plan-antigravity.cjs`],
  // No Rig venv: Python skills run with the system interpreter and need their packages installed.
  ['rig-python', 'python3'],
]);
const BIN_COMMAND_PATTERN = new RegExp(`(?<![\\w./$-])(${[...BIN_COMMANDS_IN_SKILLS.keys()].join('|')})(?![\\w.-])`, 'g');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Read `name` and `description` from YAML frontmatter (single-line or `>-`/`|` block scalars). */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description|user-invocable):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.filter(Boolean).join(' ');
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/** `rig:plan` → `plan`, `diataxis-writer` → `diataxis-writer`. Used for skill dirs. */
const agentSkillName = (frontmatterName, dirName) => (frontmatterName || dirName).replace(/^rig:/, '').replace(/:/g, '-');

// resolve_env.py hard-codes the Claude Code .env lookup paths, so it is not copied and its line is dropped.
const bareBin = (name) => `(?<![\\w./$-])${name}(?![\\w.-])`;
const RESOLVE_ENV_LINE = new RegExp(`^.*${bareBin('rig-resolve-env')}.*(?:\\r?\\n|$)`, 'gm');

/**
 * Build the rewrite function for one sync run.
 * @param {Map<string,string>} dirRenames - Claude skill dir → plugin skill dir (e.g. rig-plan → plan)
 * @param {Set<string>} knownSkillNames - names that `rig:<name>` references may point to
 */
function createTextRewriter(dirRenames, knownSkillNames) {
  const renamePattern = dirRenames.size
    ? new RegExp(`skills/(${[...dirRenames.keys()].map(escapeRegExp).join('|')})(?=[/\`'"\\s)]|$)`, 'g')
    : null;
  const R = RIG_ROOT;
  /** @param {{skillName?: string}} [ctx] skillName: the skill dir a file belongs to, for `${CLAUDE_SKILL_DIR}`. */
  return function rewrite(text, ctx = {}) {
    let out = text
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, R)
      .replace(/(~|\$HOME|\$\{HOME\})\/\.claude\/skills\//g, `${R}/skills/`)
      // API-key files are user data: they must not live inside the plugin dir, which is replaced on reinstall.
      .replace(/(^|[^\w/~.}-])\.claude\/skills\/(?=\.env|[\w-]+\/\.env)/gm, '$1.agents/skills/')
      .replace(/(^|[^\w/~.}-])\.\/\.claude\/skills(?=[/\s`'")]|$)/gm, `$1${R}/skills`)
      .replace(/(^|[^\w/~.}-])\.claude\/skills(?=[/\s`'")]|$)/gm, `$1${R}/skills`)
      .replace(/(^|[^\w/~.}-])(?:\.\/)?\.claude\//gm, '$1.agents/')
      .replace(/(^|[^\w/~.}-])\.\.\/\.claude\//gm, '$1../.agents/')
      .replace(/(^|[^\w/~.}-])\.claude\\/gm, '$1.agents\\')
      .replace(/(^|[^\w/~.}-])plugins\/rig\//gm, `$1${R}/`)
      .replace(/(<project>|\$SKILL_DIR)\/\.claude\/browser\//g, '$1/.agents/browser/')
      .replace(/<kit>(?=[/\\])/g, R);
    if (ctx.skillName) {
      const skillDir = `${R}/skills/${ctx.skillName}`;
      out = out.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
        // `python scripts/x.py` in a skill's own text is relative to that skill dir; nothing may resolve against the workspace.
        .replace(/(?<![\w./-])(python3?) eval-viewer\//g, `$1 ${skillDir}/eval-viewer/`)
        .replace(/(?<![\w./-])(npx tsx|npx ts-node|node|python3?|bash|sh) (?:\.\/)?scripts\//g, `$1 ${skillDir}/scripts/`);
    }
    if (renamePattern) out = out.replace(renamePattern, (_, dir) => `skills/${dirRenames.get(dir)}`);
    out = out.replace(/\$\(rig-browser --dir\)/g, `${R}/skills/browser/scripts`)
      .replace(/(?<![\w./$-])rig-browser (?!--dir)([a-z][a-z-]*)(?![\w.-])/g, `node ${R}/skills/browser/scripts/$1.js`)
      .replace(/\$\(rig-skill-dir ([a-z][a-z0-9-]*)\)|(?<![\w./$-])rig-skill-dir ([a-z][a-z0-9-]*)(?![\w.-])/g, (_, a, b) => `${R}/skills/${a || b}`)
      .replace(new RegExp(`${bareBin('rig-browser')} --dir`, 'g'), `${R}/skills/browser/scripts`)
      .replace(new RegExp(`${bareBin('rig-browser')} <script>`, 'g'), `node ${R}/skills/browser/scripts/<script>.js`)
      .replace(BIN_COMMAND_PATTERN, (_, name) => BIN_COMMANDS_IN_SKILLS.get(name))
      .replace(RESOLVE_ENV_LINE, '');
    return out.replace(/(?<![\w-])(\/?)rig:([a-z0-9-]+)/g, (whole, slash, name) => (knownSkillNames.has(name) ? `${slash}${name}` : whole));
  };
}

/** Set the `name:` line inside the leading frontmatter block only, leaving every other key and the body untouched. */
const setFrontmatterName = (text, name) => text.replace(/^---\r?\n[\s\S]*?\r?\n---/, (fm) => fm.replace(/^name:.*$/m, `name: ${name}`));

/** Drop a `## Heading` section (up to the next `## ` heading) from markdown. */
function dropSection(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) return text;
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(0, start + 1) + (next === -1 ? '' : text.slice(next + 1));
}

/** Rule text: path rewrites plus CLAUDE.md -> AGENTS.md (the always-on rule file of an Antigravity plugin). */
const convertRule = (text, rewrite) => rewrite(text).replace(/CLAUDE\.md/g, 'AGENTS.md');

/** Drop every line that names a CLAUDE_ONLY_SKILL_FILES file, so no synced text points at a missing file. */
function dropClaudeOnlyFileLines(text) {
  const names = [...CLAUDE_ONLY_SKILL_FILES].map((f) => f.split('/').pop());
  return text.split('\n').filter((line) => !names.some((n) => line.includes(n))).join('\n');
}

module.exports = {
  RIG_ROOT,
  CLAUDE_ONLY_SKILL_DIRS,
  CLAUDE_ONLY_SKILL_FILES,
  dropClaudeOnlyFileLines,
  parseFrontmatter,
  agentSkillName,
  createTextRewriter,
  setFrontmatterName,
  dropSection,
  AGENT_SCRIPT_FILES,
  convertRule,
};
