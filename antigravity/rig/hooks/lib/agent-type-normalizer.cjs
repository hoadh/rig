'use strict';
/**
 * agent-type-normalizer.cjs - plugin-safe handling of agent type names.
 *
 * Plugin agents may be reported as `<plugin>:<name>` (e.g. `rig:tester`). Hooks compare and
 * persist the bare, lower-cased name; the raw value is kept only for display.
 */

/** Strip ONE leading `<plugin>:` prefix (any name without whitespace or separators), lower-case, trim. 'unknown' for empty / non-string. */
function normalizeAgentType(t) {
  if (typeof t !== 'string') return 'unknown';
  const bare = t.trim().replace(/^[^:\s/\\]+:/, '').trim().toLowerCase();
  return bare || 'unknown';
}

/**
 * Make a string safe as a single filename segment: no separators, no NTFS stream colon,
 * no wildcard/control chars, no `..` traversal.
 */
function sanitizeForFilename(s) {
  const out = String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[:\\/*?"<>|\u0000-\u001f\u007f]/g, '-')
    .replace(/\.{2,}/g, '-');
  return out || 'unknown';
}

module.exports = { normalizeAgentType, sanitizeForFilename };
