'use strict';
/**
 * Auth env handoff launcher -> runner. A tmux server that is already running
 * does not pass the worker's env (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY...)
 * to the runner, and values must never travel in argv (visible in `ps`). So the
 * launcher writes the allowlisted env subset to `<runDir>/env.json` (mode 0600,
 * inside the 0700 run dir); the runner loads it first thing, applies it OVER its
 * own env (handoff wins: a long-lived tmux server may carry stale tokens) and
 * deletes the file. Only allowlisted auth keys are ever in the file; all other
 * inherited env is left alone. Used on every OS (Windows tasks included).
 */
const fs = require('fs');
const path = require('path');
const { pickAllowedEnv } = require('./child-process-env-allowlist.cjs');

const fileOf = (runDir) => path.join(runDir, 'env.json');

/** @returns {number} number of variables written */
function writeEnvHandoff(runDir, parentEnv = process.env, opts) {
  const subset = pickAllowedEnv(parentEnv, opts);
  // Always hand XDG_CONFIG_HOME over, "" when unset here: an already-running tmux server may carry a stale one
  // and the runner must hash the same global git config as the launcher (git treats "" as unset; review R4-L1).
  if (!Object.keys(subset).some((k) => k.toUpperCase() === 'XDG_CONFIG_HOME')) subset.XDG_CONFIG_HOME = '';
  const fd = fs.openSync(fileOf(runDir), 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(subset)); } finally { fs.closeSync(fd); }
  fs.chmodSync(fileOf(runDir), 0o600); // umask-proof
  return Object.keys(subset).length;
}

/** Best-effort removal (launch failed / runner never started). */
function discardEnvHandoff(runDir) {
  try { fs.unlinkSync(fileOf(runDir)); } catch { /* already gone */ }
}

/**
 * Read + delete env.json, then set every key it holds on `targetEnv` (override).
 * Corrupt/absent file is not an error (the runner then relies on its own env).
 * @returns {number} number of variables applied
 */
function loadEnvHandoff(runDir, targetEnv = process.env) {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(fileOf(runDir), 'utf8')); } catch { /* absent or corrupt */ }
  discardEnvHandoff(runDir);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  let added = 0;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') { targetEnv[k] = v; added++; }
  }
  return added;
}

module.exports = { writeEnvHandoff, loadEnvHandoff, discardEnvHandoff };
