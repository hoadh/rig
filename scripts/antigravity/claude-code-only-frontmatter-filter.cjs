/**
 * Removes Claude Code-only keys from the YAML frontmatter of skill and agent files.
 * Antigravity ignores them (or rejects the file), and they point at features it does not have
 * (forked contexts, hooks, subagent models, tool permissions).
 *
 * Pure text in, text out. Only top-level keys of the leading `---` block are looked at, so nested keys
 * (for example inside `metadata:`) and the body are never touched. Keys that are not in the list are kept
 * as they are, so a new Claude Code key never breaks the sync; add it here to have it stripped.
 */

// Keys dropped from the output. Kept on purpose (not listed): name, description, argument-hint, user-invocable.
const CLAUDE_CODE_ONLY_KEYS = new Set([
  'context', 'agent', 'background', 'isolation', 'effort', 'skills', 'omitClaudeMd', 'hooks',
  'disable-model-invocation', 'paths', 'memory', 'disallowedTools', 'maxTurns', 'model', 'allowed-tools',
]);

// A top-level key line starts in column 0 with a plain key name. List items (`- a`), indented lines
// (block scalars, nested maps), blank lines and comments never match, so they stay attached to the key above.
const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(?:\s|$)/;

/** Return `text` without the Claude Code-only keys in its frontmatter; text without frontmatter is returned as is. */
function filterClaudeCodeOnlyFrontmatter(text) {
  const match = /^---(\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!match) return text;
  const eol = match[1];
  const kept = [];
  let dropping = false;
  for (const line of match[2].split(/\r?\n/)) {
    const key = KEY_LINE.exec(line);
    if (key) dropping = CLAUDE_CODE_ONLY_KEYS.has(key[1]);
    if (!dropping) kept.push(line);
  }
  const head = `---${eol}${kept.join(eol)}`;
  return head + (kept.length ? match[3] : match[3].replace(/^\r?\n/, '')) + text.slice(match[0].length);
}

module.exports = { CLAUDE_CODE_ONLY_KEYS, filterClaudeCodeOnlyFrontmatter };
