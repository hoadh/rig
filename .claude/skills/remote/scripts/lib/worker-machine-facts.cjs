'use strict';
/**
 * Read-only facts a worker reports to `doctor` (worker `facts` command).
 * Every probe is individually guarded: a failing probe yields null/error text,
 * never an exception, so doctor can still show the rest.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const { stripUrlCredentials } = require('./secret-redaction.cjs');
const R = require('./run-directory.cjs');
const { scriptsIntegrityHash } = require('./skill-scripts-integrity-hash.cjs');
const { verifyKnownGoodBaseline } = require('./hardened-git-config-env.cjs');
const { isQuarantined } = require('./git-control-files-integrity.cjs');

const OLD_RUN_MS = 14 * 24 * 3600 * 1000;
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, windowsHide: true, ...opts }).trim();
const tryOr = (fn, dflt = null) => { try { return fn(); } catch { return dflt; } };

function claudeFacts(target) {
  const exe = target.claude || 'claude';
  const version = tryOr(() => sh(exe, ['--version']));
  let auth = null;
  try { sh(exe, ['auth', 'status']); auth = { loggedIn: true }; } catch (e) { auth = { loggedIn: false, detail: String(e.stdout || e.stderr || e.message).slice(0, 200) }; }
  const token = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
  return { version, auth, tokenInEnv: token };
}

function repoFacts(repo) {
  const exists = Boolean(repo) && fs.existsSync(repo);
  const isGit = exists && tryOr(() => sh('git', ['-C', repo, 'rev-parse', '--is-inside-work-tree']) === 'true', false);
  if (!isGit) return { exists, isGit: false };
  return {
    exists, isGit,
    clean: tryOr(() => sh('git', ['-C', repo, 'status', '--porcelain']) === '', null),
    originUrl: tryOr(() => stripUrlCredentials(sh('git', ['-C', repo, 'remote', 'get-url', 'origin']))),
    identity: { name: tryOr(() => sh('git', ['-C', repo, 'config', 'user.name'])), email: tryOr(() => sh('git', ['-C', repo, 'config', 'user.email'])) },
    baseline: tryOr(() => verifyKnownGoodBaseline(repo).status, 'error'), // match | missing | mismatch
    quarantined: tryOr(() => isQuarantined(repo), false),
  };
}

/** rig-* tmux sessions / scheduled tasks whose run is not active. */
function staleRunners(activeIds) {
  const ids = [];
  if (process.platform === 'win32') {
    const csv = tryOr(() => sh('schtasks', ['/Query', '/FO', 'CSV', '/NH']), '');
    for (const m of csv.matchAll(/"\\?rig-([^"]+)"/g)) ids.push(m[1]);
  } else {
    for (const s of tryOr(() => sh('tmux', ['ls', '-F', '#S']), '').split('\n')) if (s.startsWith('rig-')) ids.push(s.slice(4));
  }
  return ids.filter((id) => !activeIds.has(id)).map((id) => `rig-${id}`);
}

function runFacts() {
  const runs = R.listRunDirs().map((d) => R.summarizeRun(d));
  const active = new Set(runs.filter((r) => ['starting', 'running', 'cancelling'].includes(r.state)).map((r) => r.runId));
  const now = Date.now();
  return {
    lost: runs.filter((r) => r.state === 'lost').map((r) => r.runId),
    old: runs.filter((r) => !active.has(r.runId) && r.startedAt && now - r.startedAt > OLD_RUN_MS).length,
    staleRunners: staleRunners(active),
  };
}

/** macOS: is the agent's user also the logged-in console user? null = unknown. */
function sharesConsoleUser() {
  if (process.platform !== 'darwin') return null;
  const console_ = tryOr(() => sh('stat', ['-f', '%Su', '/dev/console']));
  return console_ ? console_ === os.userInfo().username : null;
}

function diskFreeGiB(dir) {
  const s = tryOr(() => fs.statfsSync(dir));
  return s ? Math.round((s.bavail * s.bsize) / 2 ** 30 * 10) / 10 : null;
}

function collectFacts(target) {
  return {
    user: os.userInfo().username, platform: process.platform, claude: claudeFacts(target), repo: repoFacts(target.repo),
    diskFreeGiB: diskFreeGiB(os.homedir()),
    runs: runFacts(), sharesConsoleUser: sharesConsoleUser(), integrityHash: scriptsIntegrityHash(),
  };
}

module.exports = { collectFacts };
