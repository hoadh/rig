'use strict';
/**
 * Wired in safe-git-runner.cjs, agent-child-env.cjs and git-baseline-gate.cjs (review H1/M4). Two independent defences for every git
 * process that runs with the runner's privileges or inside the agent's reach:
 *
 *  1. hardenedGitConfigEnv(): env additions that pin dangerous config keys at the
 *     highest non-CLI precedence (GIT_CONFIG_COUNT/KEY_i/VALUE_i beat repo, global
 *     and system files) and ignore /etc/gitconfig. An agent-edited `.git/config`
 *     can then no longer set hooksPath, sshCommand, fsmonitor, ext:: transports...
 *  2. knownGoodGitControlBaseline: a control-file hash recorded once from a
 *     trusted state and stored OUTSIDE the clone (~/.rig/git-baseline-<cloneHash>.json),
 *     so tampering that happened in an earlier run (shared .git of the test
 *     worktree) is caught instead of being re-baselined as "h0".
 *
 * hooksPath is /dev/null on Unix (nothing agent-writable to plant in); win32 verifies the empty dir per call (H5).
 * Baseline hash also covers ~/.gitconfig and the XDG git config (M-B).
 *
 * Not pinnable via env (covered by the baseline hash instead): remote.*.url,
 * remote.*.pushurl, url.*.insteadOf, credential.<url>.helper, includeIf paths.
 * credential.helper is NOT pinned by default (the user's helper is what makes
 * pushes work); pass `credentialHelper` to pin it. GIT_SSH_COMMAND / GIT_ASKPASS in
 * the process env outrank core.sshCommand / core.askPass: the child env allowlist
 * must keep them out of agent envs (it does; do not add them).
 */
const fs = require('fs');
const path = require('path');
const { rigHome, cloneHash, emptyHooksDir, writeJsonAtomic, readJson, RunFailure } = require('./run-directory.cjs');
const { hashGitControlFiles } = require('./git-control-files-integrity.cjs');

/**
 * Fail closed unless the win32 fallback hooks dir is an empty REAL directory (review H5: it is agent-writable,
 * so a planted pre-push would run with the runner's credentials). Re-checked on every git call; the
 * residual check-then-use window is tiny and only exists on win32.
 */
function assertEmptyHooksDir(dir = emptyHooksDir()) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  let st = null;
  try { st = fs.lstatSync(dir); } catch { /* absent: created below */ }
  if (!st) { fs.mkdirSync(dir); return dir; }
  if (!st.isDirectory() || st.isSymbolicLink()) throw new RunFailure('hooks-tampered', `${dir} is not a plain directory`, { hint: `delete ${dir} after inspecting it` });
  const entries = fs.readdirSync(dir);
  if (entries.length) throw new RunFailure('hooks-tampered', `${dir} must be empty but holds: ${entries.slice(0, 5).join(', ')}`, { hint: `inspect and delete the contents of ${dir}; check the clones for tampering` });
  return dir;
}

/**
 * core.hooksPath value for every runner git call. Unix: /dev/null (git finds no hook below a non-directory,
 * and the agent cannot create or write there, so there is nothing to plant). win32 has no such path:
 * fall back to the verified-empty ~/.rig/empty-hooks (assertEmptyHooksDir throws RunFailure hooks-tampered).
 */
function pinnedHooksPath(platform = process.platform) {
  return platform === 'win32' ? assertEmptyHooksDir() : '/dev/null';
}

/** Index to continue from when the caller's env already carries GIT_CONFIG_COUNT entries. */
function existingConfigCount(baseEnv) {
  const raw = baseEnv.GIT_CONFIG_COUNT;
  if (raw === undefined || raw === '') return 0;
  if (!/^\d{1,3}$/.test(String(raw))) throw new RunFailure('prepare', `invalid inherited GIT_CONFIG_COUNT ${JSON.stringify(raw)}`, { hint: 'unset GIT_CONFIG_COUNT/GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_* in the runner environment' });
  return Number(raw);
}

/**
 * @param {{credentialHelper?: string, baseEnv?: NodeJS.ProcessEnv, noSystem?: boolean, extraPins?: Array<[string,string]>}} [opts]
 *   credentialHelper: pin credential.helper (resets inherited helpers first); omitted = leave unpinned.
 *   baseEnv: env the result will be merged into; existing GIT_CONFIG_COUNT entries are preserved.
 *   noSystem: set GIT_CONFIG_NOSYSTEM=1 (default true). Runner git passes false: the root-owned system
 *     config carries the credential helper (Git for Windows `manager`, Apple osxkeychain) and is not agent-writable.
 *   extraPins: additional [key,value] config pairs appended after the fixed pins (agent env forwards the
 *     system line-ending keys here, see system-line-ending-config-forwarder.cjs).
 * @returns {Record<string,string>} env additions (spread AFTER baseEnv, e.g. {...baseEnv, ...additions})
 */
function hardenedGitConfigEnv({ credentialHelper, baseEnv = {}, noSystem = true, extraPins = [] } = {}) {
  if (credentialHelper !== undefined && (typeof credentialHelper !== 'string' || /[\0\r\n]/.test(credentialHelper))) {
    throw new Error('credentialHelper must be a single-line string');
  }
  const pins = [
    ['core.hooksPath', pinnedHooksPath()],
    ['core.sshCommand', 'ssh'], // explicit default: ignores an agent-written sshCommand
    ['core.fsmonitor', 'false'],
    ['core.askPass', ''],
    ['protocol.ext.allow', 'never'],
  ];
  if (credentialHelper !== undefined) pins.push(['credential.helper', ''], ['credential.helper', credentialHelper]);
  for (const [k, v] of extraPins) {
    if (typeof k !== 'string' || typeof v !== 'string' || /[\0\r\n]/.test(k + v)) throw new Error('extraPins must be single-line [key,value] strings');
    pins.push([k, v]);
  }
  const start = existingConfigCount(baseEnv);
  const env = { GIT_CONFIG_COUNT: String(start + pins.length) };
  if (noSystem) env.GIT_CONFIG_NOSYSTEM = '1';
  pins.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${start + i}`] = key;
    env[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return env;
}

const baselinePath = (repo) => path.join(rigHome(), `git-baseline-${cloneHash(repo)}.json`);

/** Record the CURRENT control-file hash as known-good. Call only from a trusted state (fresh clone / after reviewed re-clone). */
function writeKnownGoodBaseline(repo, hash = hashGitControlFiles(repo)) {
  fs.mkdirSync(rigHome(), { recursive: true });
  writeJsonAtomic(baselinePath(repo), { v: 1, hash, recordedAt: new Date().toISOString() });
  return hash;
}

/** @returns {string|null} stored hash, or null when absent/corrupt */
function readKnownGoodBaseline(repo) {
  try {
    const j = readJson(baselinePath(repo));
    return j && j.v === 1 && /^[0-9a-f]{64}$/.test(j.hash) ? j.hash : null;
  } catch { return null; }
}

/**
 * Compare the clone's current control files with the known-good baseline.
 * `missing` is NOT ok: the caller decides whether to bootstrap (first prepare of a
 * freshly cloned repo) or fail closed.
 * @returns {{ok:boolean, status:'match'|'mismatch'|'missing', expected:string|null, actual:string}}
 */
function verifyKnownGoodBaseline(repo) {
  const expected = readKnownGoodBaseline(repo);
  const actual = hashGitControlFiles(repo);
  const status = expected === null ? 'missing' : expected === actual ? 'match' : 'mismatch';
  return { ok: status === 'match', status, expected, actual };
}

const knownGoodGitControlBaseline = { write: writeKnownGoodBaseline, read: readKnownGoodBaseline, verify: verifyKnownGoodBaseline };

module.exports = {
  hardenedGitConfigEnv, pinnedHooksPath, assertEmptyHooksDir, cloneHash, baselinePath,
  writeKnownGoodBaseline, readKnownGoodBaseline, verifyKnownGoodBaseline, knownGoodGitControlBaseline,
};
