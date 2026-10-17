/**
 * Path rewriting used when installing the kit:
 * - Global install: in instruction files (md/yaml/toml) and settings.json, every project-relative
 *   `.claude/` reference (bare, `./`, `@`, quoted, `$CLAUDE_PROJECT_DIR`, `%CLAUDE_PROJECT_DIR%`,
 *   `%USERPROFILE%`) becomes `$HOME/.claude/`.
 * - Hook commands are canonicalized to a quoted form that survives cwd changes and spaces:
 *     global → node "$HOME/.claude/hooks/x.cjs"
 *     local  → node "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.cjs
 */
const path = require('path');

const GLOBAL_CLAUDE_PATH = '$HOME/.claude/';

// Narrower than the CLI on purpose: in code files (.cjs/.py/...) `$HOME` would be a literal
// string, e.g. rig-config-utils' '.claude/.rig.json' would turn into an unresolvable '$HOME/.claude/.rig.json'.
// Code resolves its own paths; only instructions read by the model/shell are rewritten.
// settings.json is rewritten separately by the installer.
const TRANSFORMABLE_EXTENSIONS = new Set(['.md', '.yaml', '.yml', '.toml']);

function isTransformableFile(filePath) {
  const base = path.basename(filePath);
  return TRANSFORMABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || base.toLowerCase() === 'claude.md';
}

/** Ordered rewrite rules for the default ~/.claude target. */
const GLOBAL_RULES = [
  [/%USERPROFILE%[\\/]\.claude[\\/]/g, GLOBAL_CLAUDE_PATH],
  [/%USERPROFILE%(?=[\\/])/g, '$HOME'],
  [/\$CLAUDE_PROJECT_DIR\/\.claude\//g, GLOBAL_CLAUDE_PATH],
  [/"\$CLAUDE_PROJECT_DIR"\/\.claude\//g, '"$HOME"/.claude/'],
  [/\$\{CLAUDE_PROJECT_DIR\}\/\.claude\//g, GLOBAL_CLAUDE_PATH],
  [/%CLAUDE_PROJECT_DIR%[\\/]\.claude[\\/]/g, GLOBAL_CLAUDE_PATH],
  [/\.\/\.claude\//g, GLOBAL_CLAUDE_PATH],
  [/@\.\/\.claude\//g, `@${GLOBAL_CLAUDE_PATH}`],
  [/@\.claude\//g, `@${GLOBAL_CLAUDE_PATH}`],
  [/(["'`])\.claude\//g, `$1${GLOBAL_CLAUDE_PATH}`],
  [/\(\.claude\//g, `(${GLOBAL_CLAUDE_PATH}`],
  [/ \.claude\//g, ` ${GLOBAL_CLAUDE_PATH}`],
  [/^\.claude\//gm, GLOBAL_CLAUDE_PATH],
  [/: \.claude\//g, `: ${GLOBAL_CLAUDE_PATH}`],
  [/:\.claude\//g, `:${GLOBAL_CLAUDE_PATH}`],
];

/** Rewrites project-relative `.claude/` references for a global install. Returns { content, changes }. */
function rewriteContentForGlobalInstall(content) {
  let changes = 0;
  let out = content;
  for (const [pattern, replacement] of GLOBAL_RULES) {
    out = out.replace(pattern, (...args) => {
      changes++;
      // Only the quote rule has a capture group; expand `$1` manually to keep `$HOME` literal
      return replacement.includes('$1') ? replacement.replace('$1', args[1]) : replacement;
    });
  }
  return { content: out, changes };
}

// node <optional quote><optional root var or ~ or .>/<.claude/...><optional quote><suffix>
// The path stops at whitespace; a quoted path ending in `"` may contain spaces.
const HOOK_COMMAND_PATTERN =
  /^(\s*node\s+)"?(?:(\$\{?HOME\}?|\$\{?CLAUDE_PROJECT_DIR\}?|%USERPROFILE%|%CLAUDE_PROJECT_DIR%|~|\.)"?[/\\])?(\.claude[/\\](?:[^"]+(?=")|[^\s"]+))"?(.*)$/;

const HOME_ROOTS = new Set(['$HOME', '${HOME}', '%USERPROFILE%', '~']);

/**
 * Canonicalizes a `node .claude/...` hook/statusline command for the install mode.
 * Local mode keeps hooks that deliberately point at the user's home (~ / $HOME) on $HOME.
 * Commands that are not `node <.claude path>` are returned unchanged.
 */
function canonicalizeHookCommand(command, isGlobal) {
  if (typeof command !== 'string') return command;
  const match = command.match(HOOK_COMMAND_PATTERN);
  if (!match) return command;
  const [, nodePrefix, root, relPath, suffix] = match;
  const rel = relPath.replace(/\\/g, '/');
  if (/\s/.test(rel) && !isGlobal && !HOME_ROOTS.has(root)) return command; // unquoted output would split
  const useHome = isGlobal || HOME_ROOTS.has(root);
  return useHome ? `${nodePrefix}"$HOME/${rel}"${suffix}` : `${nodePrefix}"$CLAUDE_PROJECT_DIR"/${rel}${suffix}`;
}

module.exports = { isTransformableFile, rewriteContentForGlobalInstall, canonicalizeHookCommand };
