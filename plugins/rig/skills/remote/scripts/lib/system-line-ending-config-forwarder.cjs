'use strict';
/**
 * Forward ONLY the system-scope line-ending keys into envs that set GIT_CONFIG_NOSYSTEM=1 (defect D4).
 * Git for Windows ships core.autocrlf=true in the system gitconfig: runner git (system honoured) checks
 * files out CRLF, while the agent (NOSYSTEM) sees the index as LF and reports every refreshed file as
 * ` M` with a whole-file diff, and may commit CRLF. Forwarding these three non-executable keys keeps the
 * agent's view of the worktree identical to the runner's without re-enabling the rest of the system config.
 * Values are checked against a strict allowlist; anything else is dropped.
 */
const { execFileSync } = require('child_process');

const ALLOWED = {
  'core.autocrlf': /^(true|false|input)$/,
  'core.eol': /^(lf|crlf|native)$/,
  'core.safecrlf': /^(true|false|warn)$/,
};

/** @returns {Array<[string,string]>} validated [key,value] pairs from raw `git config --system` output */
function filterLineEndingPairs(raw) {
  const pairs = [];
  for (const key of Object.keys(ALLOWED)) {
    const value = raw && raw[key] !== undefined ? String(raw[key]).trim().toLowerCase() : '';
    if (ALLOWED[key].test(value)) pairs.push([key, value]);
  }
  return pairs;
}

let cached = null;

/**
 * Read the system-scope values with the runner's own git (system config honoured). Missing key / no git /
 * no system file -> skipped. Computed once per process.
 * @param {NodeJS.ProcessEnv} [parentEnv] env for the probe; GIT_CONFIG_NOSYSTEM is always removed
 */
function systemLineEndingPins(parentEnv = process.env) {
  if (cached) return cached;
  const env = { ...parentEnv };
  delete env.GIT_CONFIG_NOSYSTEM;
  const raw = {};
  for (const key of Object.keys(ALLOWED)) {
    try {
      raw[key] = execFileSync('git', ['config', '--system', '--get', key], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, windowsHide: true });
    } catch { /* exit 1 = key absent; ENOENT/timeout = no forwarding */ }
  }
  cached = filterLineEndingPairs(raw);
  return cached;
}

/** Test seam: forget the per-process cache. */
function resetSystemLineEndingPinsCache() { cached = null; }

module.exports = { systemLineEndingPins, filterLineEndingPairs, resetSystemLineEndingPinsCache };
