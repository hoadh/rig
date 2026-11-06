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

/** Directory for small per-session or per-project state files (counters, caches). */
function stateDir() {
  const data = pluginDataDir();
  return data ? ensureDir(path.join(data, 'state')) : os.tmpdir();
}

/** Directory for the JSON-lines hook log; `legacyDir` is used when CLAUDE_PLUGIN_DATA is unset. */
function logDir(legacyDir) {
  const data = pluginDataDir();
  return data ? path.join(data, 'logs') : legacyDir;
}

module.exports = { pluginDataDir, stateDir, logDir };
