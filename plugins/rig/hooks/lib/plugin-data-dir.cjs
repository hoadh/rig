/**
 * Where hooks keep mutable state (logs, caches, counters).
 *
 * As a Claude Code plugin the hooks run with CLAUDE_PLUGIN_DATA set to a directory that survives
 * plugin updates; the plugin install dir itself is a replaceable cache and must stay read-only.
 * When the variable is unset (tests, a 1.x file copy, manual runs) callers fall back to the OS
 * temp dir (counters, caches) or to the legacy `hooks/.logs` dir (hook log).
 *
 * Never throws: a state dir that cannot be created only disables that state, not the hook.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** @returns {string|null} absolute CLAUDE_PLUGIN_DATA, or null when unset or not an absolute path */
function pluginDataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA;
  return typeof dir === 'string' && dir !== '' && path.isAbsolute(dir) ? dir : null;
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // callers handle missing dirs when they read or write
  }
  return dir;
}

/**
 * Directory for HOOK-PRIVATE state (counters, caches, reminder state). Never put a file here that a
 * Bash-run script or the statusline reads or writes: those processes do not get CLAUDE_PLUGIN_DATA.
 * Shared files (rig-session-<id>.json) stay in os.tmpdir(), as in 1.x.
 */
function stateDir() {
  const data = pluginDataDir();
  return data ? ensureDir(path.join(data, 'state')) : os.tmpdir();
}

/** Directory for the JSON-lines hook log; `legacyDir` is used when CLAUDE_PLUGIN_DATA is unset. */
function logDir(legacyDir) {
  const data = pluginDataDir();
  return data ? path.join(data, 'logs') : legacyDir;
}

const PRUNE_PREFIX = /^rig-/;

/**
 * Best-effort cleanup of hook-private state in the plugin data dir (the OS never cleans it).
 * Deletes `rig-*` files not modified for `maxAgeMs`; looks at no more than `cap` matching files per call.
 * @returns {number} files deleted
 */
function pruneStaleState(maxAgeMs = 7 * 24 * 60 * 60 * 1000, cap = 500) {
  const data = pluginDataDir();
  if (!data) return 0;
  let deleted = 0;
  try {
    const dir = path.join(data, 'state');
    const now = Date.now();
    // Filter first, then cap: unrelated files must not starve the scan.
    const names = fs.readdirSync(dir).filter((n) => PRUNE_PREFIX.test(n)).slice(0, cap);
    for (const name of names) {
      try {
        const file = path.join(dir, name);
        if (now - fs.statSync(file).mtimeMs > maxAgeMs) {
          fs.unlinkSync(file);
          deleted++;
        }
      } catch {
        // raced with another hook or unreadable: skip
      }
    }
  } catch {
    // no state dir yet
  }
  return deleted;
}

module.exports = { pluginDataDir, stateDir, logDir, pruneStaleState };
