/**
 * Finds Claude Code-only references that survived the rewrite into `.agent/` and `GEMINI.md`.
 * Pure: takes `{ path, text }` entries, no file system access.
 *
 * Forbidden in the output:
 *   - `.claude/` (or `.claude\\`) paths
 *   - `CLAUDE_PLUGIN_*` and `CLAUDE_SKILL_DIR` variables
 *   - `rig-init` and `hooks.json`
 *   - bare plugin bin names (`rig-worktree`, ...): Antigravity has no PATH entry for them
 *   - `/rig:<x>` commands of skills that are not synced
 *
 * A mention is allowed only when it matches an entry in ALLOWED. Keep that list small and justified.
 */

// Spans removed from a line before the forbidden patterns run. `files` (optional) limits an entry to matching paths.
const ALLOWED = [
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
];

/** @param {string[]} binNames plugin bin command names, e.g. `rig-worktree` */
function buildForbidden(binNames) {
  const forbidden = [
    { id: '.claude/ path', pattern: /(^|[^\w~.}-])\.claude[/\\]/ },
    { id: 'CLAUDE_PLUGIN_* variable', pattern: /CLAUDE_PLUGIN_[A-Z_]+/ },
    { id: 'CLAUDE_SKILL_DIR variable', pattern: /CLAUDE_SKILL_DIR/ },
    { id: 'rig-init', pattern: /(?<![\w./$-])rig-init(?![\w-])/ },
    { id: 'hooks.json', pattern: /hooks\.json/ },
    { id: '/rig:<x> command without a synced skill', pattern: /(?<![\w-])\/rig:(?!remote|team)[a-z]/ },
  ];
  if (binNames.length) {
    forbidden.push({ id: 'bare plugin bin name', pattern: new RegExp(`(?<![\\w./$-])(?:${binNames.join('|')})(?![\\w.-])`) });
  }
  return forbidden;
}

/**
 * @param {{path: string, text: string}[]} files paths use `/` and are relative to the repo root
 * @param {{binNames?: string[]}} [opts]
 * @returns {{path: string, line: number, id: string, text: string}[]}
 */
function findLeftovers(files, { binNames = [] } = {}) {
  const forbidden = buildForbidden(binNames);
  const found = [];
  for (const { path: filePath, text } of files) {
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
