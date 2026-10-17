'use strict';
/**
 * Durable secondary worktrees under <repo>/.rig/ (coord-<slug>, int-<slug>),
 * plus the one hardened git runner shared by phase 04/05 libs.
 * Main checkout working tree / HEAD / index are never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const { localRigDir, ensureRigDirExcluded } = require('./rig-branch-and-path-names.cjs');
const { stripUrlCredentials, redactText } = require('./secret-redaction.cjs');

// No hooks, no CRLF rewriting: coord content must round-trip byte-exact.
const SAFE_ARGS = ['-c', 'core.autocrlf=false', '-c', `core.hooksPath=${os.devNull}`];
const DIR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Run git in `cwd`; never throws. `encoding:'buffer'` returns stdout as Buffer.
 * @returns {{status:number, stdout:string|Buffer, stderr:string}}
 */
function git(cwd, args, { input, encoding = 'utf8', timeoutMs = 120000 } = {}) {
  const r = spawnSync('git', ['-C', cwd, ...SAFE_ARGS, ...args], {
    encoding, input, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const stderr = r.error ? r.error.message : String(r.stderr || '');
  return { status: r.status === null ? -1 : r.status, stdout: r.stdout === null ? '' : r.stdout, stderr };
}

/** Message safe to show/log: credentials in URLs stripped, tokens redacted. */
const safeMessage = (s) => redactText(stripUrlCredentials(s).replace(/:\/\/[^\s/@]+@/g, '://')).text.trim();

/** git or RemoteError(exit 1). Returns trimmed stdout (or Buffer when encoding=buffer). */
function gitOrThrow(cwd, args, opts) {
  const r = git(cwd, args, opts);
  if (r.status !== 0) {
    throw new RemoteError(`git ${args[0]} failed: ${safeMessage(r.stderr) || `exit ${r.status}`}`, EXIT.ERROR, { class: 'git-failed' });
  }
  return typeof r.stdout === 'string' ? r.stdout.trim() : r.stdout;
}

/**
 * Create or verify `<repo>/.rig/<dirName>` as a worktree on `branch`.
 * @param {{orphan?: boolean, remoteRef?: string}} opts one of: orphan (new root
 *   commit lineage) or remoteRef (e.g. refs/remotes/origin/rig-coord/x; branch reset to it)
 * @returns {{dir: string, created: boolean}}
 */
function ensureLocalWorktree(repoRoot, dirName, branch, opts = {}) {
  if (!DIR_RE.test(dirName)) throw new RemoteError(`invalid worktree dir name ${JSON.stringify(dirName)}`, EXIT.USAGE, { class: 'invalid-input' });
  ensureRigDirExcluded(repoRoot);
  const dir = path.join(localRigDir(repoRoot), dirName);
  if (fs.existsSync(dir)) {
    const top = git(dir, ['rev-parse', '--show-toplevel']);
    const head = git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
    if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(dir) || head.stdout.trim() !== branch) {
      throw new RemoteError(`${dir} exists but is not a worktree on ${branch}`, EXIT.ERROR, { class: 'worktree-mismatch', hint: `remove ${dir} (git worktree remove --force) and retry` });
    }
    if (gitOrThrow(dir, ['status', '--porcelain'])) {
      throw new RemoteError(`${dir} has uncommitted changes`, EXIT.ERROR, { class: 'worktree-dirty', hint: `inspect or remove ${dir}` });
    }
    return { dir, created: false };
  }
  fs.mkdirSync(localRigDir(repoRoot), { recursive: true });
  if (opts.remoteRef) {
    gitOrThrow(repoRoot, ['worktree', 'add', '-q', '-B', branch, dir, opts.remoteRef]);
  } else if (opts.orphan) {
    git(repoRoot, ['branch', '-D', branch]); // stale leftover from an aborted claim; failure = absent
    gitOrThrow(repoRoot, ['worktree', 'add', '-q', '--detach', dir]);
    gitOrThrow(dir, ['checkout', '-q', '--orphan', branch]);
    gitOrThrow(dir, ['rm', '-rf', '-q', '--ignore-unmatch', '.']); // empty index AND tree (git >= 2.30 safe)
  } else {
    throw new RemoteError('ensureLocalWorktree: need orphan or remoteRef to create', EXIT.ERROR);
  }
  return { dir, created: true };
}

/** Best-effort removal of a worktree and its local branch (failed claim cleanup). */
function removeLocalWorktree(repoRoot, dirName, branch) {
  const dir = path.join(localRigDir(repoRoot), dirName);
  git(repoRoot, ['worktree', 'remove', '--force', dir]);
  fs.rmSync(dir, { recursive: true, force: true });
  git(repoRoot, ['worktree', 'prune']);
  git(repoRoot, ['branch', '-D', branch]);
}

module.exports = { git, gitOrThrow, safeMessage, ensureLocalWorktree, removeLocalWorktree };
