/**
 * Finds Claude Code-only references that survived the rewrite into the Antigravity plugin (antigravity/rig/).
 * Pure: takes `{ path, text }` entries, no file system access.
 *
 * Forbidden in the output:
 *   - `.claude/` (or `.claude\\`) paths and the old `.agent/` kit dir
 *   - `CLAUDE_PLUGIN_*` and `CLAUDE_SKILL_DIR` variables
 *   - `rig-init` and `hooks.json`
 *   - bare plugin bin names (`rig-worktree`, ...): Antigravity has no PATH entry for them
 *   - `rig:<x>` prefixes of skills that are not in the plugin; links or paths into Claude Code-only skill dirs, and
 *     mentions of those skills without the "(Claude Code only, not in this plugin)" note (the concept note in
 *     rules/AGENTS.md is exempt: it is the place that explains them)
 *   - `node ./x`, `node ../x`, `node|npx tsx|python|bash scripts/x` and `python dir/x.py`: nothing may resolve against the workspace
 *   - `TeamCreate` (Agent Teams)
 *
 * Exempt: `hooks/**` and `hooks.json` (copied Rig hook code legitimately names `CLAUDE_PLUGIN_DATA`, `.claude/.rig.json`)
 * and entries flagged `verbatim` (adapter scripts copied as they are). Elsewhere a mention is allowed only when it
 * matches an entry in ALLOWED. Keep that list small and justified.
 */

const { CLAUDE_ONLY_SKILL_DIRS, CLAUDE_ONLY_NOTE } = require('./claude-to-antigravity-text-rewrite.cjs');

const ONLY = [...CLAUDE_ONLY_SKILL_DIRS].join('|');
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EXEMPT_PATHS = [/^hooks\//, /^hooks\.json$/];

// Spans removed from a line before the forbidden patterns run. `files` (optional) limits an entry to matching paths.
const ALLOWED = [
  {
    name: 'concept note of Claude Code-only skills',
    reason: 'rules/AGENTS.md carries the concept note that tells the agent which Rig skills are Claude Code only.',
    files: /^rules\/AGENTS\.md$/,
    span: new RegExp(`\\/?rig:(?:${ONLY})(?![\\w-])`, 'g'),
  },
  {
    name: 'user-level Claude Code files',
    reason: 'Skills read API keys and settings from ~/.claude/ (.env, .rig.json); those user files exist outside the kit.',
    span: /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\]\.claude(?=[/\\])/g,
  },
  {
    name: 'API-key .env files',
    reason: 'Users create .claude/.env, .claude/skills/.env and .claude/skills/<skill>/.env; the skill scripts and their messages still name them.',
    span: /\.claude\/(?:skills\/(?:[\w${}<>-]+\/)?)?\.env\b/g,
  },
  {
    name: 'plugin authoring references',
    reason: 'The create-skill references teach how to write Claude Code plugins, so they quote CLAUDE_PLUGIN_ROOT and hooks.json.',
    files: /(^|\/)skills\/create-skill\/references\/plugin-marketplace-[\w-]+\.md$/,
    span: /CLAUDE_PLUGIN_[A-Z_]+|hooks\.json/g,
  },
  {
    name: 'skill authoring namespace examples',
    reason: 'create-skill teaches the optional `rig:<skill-name>` namespace in frontmatter names; its docs and scripts quote it as an example.',
    files: /(^|\/)skills\/create-skill\//,
    span: /rig:[a-z0-9-]+/g,
  },
];

/** @param {string[]} binNames plugin bin command names, e.g. `rig-worktree` */
function buildForbidden(binNames) {
  const forbidden = [
    { id: '.claude/ path', pattern: /(^|[^\w~.}-])\.claude[/\\]/ },
    { id: 'CLAUDE_PLUGIN_* variable', pattern: /CLAUDE_PLUGIN_[A-Z_]+/ },
    { id: 'CLAUDE_SKILL_DIR variable', pattern: /CLAUDE_SKILL_DIR/ },
    { id: 'rig-init', pattern: /(?<![\w./$-])rig-init(?![\w-])/ },
    { id: 'hooks.json', pattern: /hooks\.json/ },
    // rig:remote / rig:team are handled by the two rules below; rig:teammate (another name) is still caught here (L8)
    { id: 'rig:<x> prefix without a plugin skill', pattern: new RegExp(`(?<![\\w-])\\/?rig:(?!(?:${ONLY})(?![\\w-]))[a-z]`) },
    { id: 'link or path into a Claude Code-only skill', pattern: new RegExp(`(?:\\]\\(|\`)(?:\\.\\/)?(?:(?:<Rig root>\\/)?skills\\/|(?:\\.\\.\\/)+(?:skills\\/)?)(?:${ONLY})\\/`) },
    // A line that names one must also carry the note (the rewrite puts it right after the mention or its code span)
    { id: 'Claude Code-only skill without the not-in-this-plugin note', pattern: new RegExp(`^(?!.*${escapeRe(CLAUDE_ONLY_NOTE.slice(1, -1))}).*(?<![\\w-])\\/?rig:(?:${ONLY})(?![\\w-])`) },
    { id: '.agent/ kit dir', pattern: /\.agent[/\\]/ },
    { id: 'workspace-relative node call', pattern: /\bnode \.{1,2}[/\\]/ },
    { id: 'bare scripts/ call without the Rig root', pattern: /\b(?:npx tsx|npx ts-node|node|python3?|bash|sh) (?:\.\/)?scripts\// },
    { id: 'relative python script call', pattern: /\bpython3? (?!<)(?:\.{1,2}\/)?[\w.-]+\/[\w./-]*\.py\b/ },
    { id: 'TeamCreate', pattern: /\bTeamCreate\b/ },
  ];
  if (binNames.length) {
    forbidden.push({ id: 'bare plugin bin name', pattern: new RegExp(`(?<![\\w./$-])(?:${binNames.join('|')})(?![\\w.-])`) });
  }
  return forbidden;
}

/**
 * @param {{path: string, text: string, verbatim?: boolean}[]} files paths use `/` and are relative to the plugin root
 * @param {{binNames?: string[]}} [opts]
 * @returns {{path: string, line: number, id: string, text: string}[]}
 */
function findLeftovers(files, { binNames = [] } = {}) {
  const forbidden = buildForbidden(binNames);
  const found = [];
  for (const { path: filePath, text, verbatim } of files) {
    if (verbatim || EXEMPT_PATHS.some((re) => re.test(filePath))) continue;
    const allowed = ALLOWED.filter((a) => !a.files || a.files.test(filePath));
    text.split(/\r?\n/).forEach((line, i) => {
      const rest = allowed.reduce((l, a) => l.replace(a.span, ' '), line);
      for (const { id, pattern } of forbidden) {
        if (pattern.test(rest)) found.push({ path: filePath, line: i + 1, id, text: line.trim().slice(0, 120) });
      }
    });
  }
  return found;
}

module.exports = { ALLOWED, findLeftovers };
