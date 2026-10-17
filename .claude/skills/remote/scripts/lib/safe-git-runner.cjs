'use strict';
/**
 * Hardened git runner shared by every privileged git call (prepare, guard, push).
 * Two layers: `-c` flags (belt) + hardenedGitConfigEnv GIT_CONFIG_* pins (braces,
 * highest non-CLI precedence, so a tampered repo config cannot win). Hooks are
 * disabled, fsmonitor off, ext:: transport off, sshCommand pinned, system config ignored.
 */
const { execFileSync } = require('child_process');
const { hardenedGitConfigEnv, pinnedHooksPath } = require('./hardened-git-config-env.cjs');

// A hung git (dead network, credential prompt, lock) must not wedge the runner: every call is bounded.
// execFileSync blocks the event loop, so the runner heartbeats from a worker thread (see runner-heartbeat-thread.cjs).
const GIT_TIMEOUT_MS = 120_000;
const GIT_NETWORK_TIMEOUT_MS = 300_000;
const NETWORK_SUBCOMMANDS = new Set(['fetch', 'push', 'clone', 'pull', 'ls-remote']);

/** Timeout for a git invocation (env RIG_GIT_TIMEOUT_MS overrides both classes: test seam). */
function gitTimeoutMs(args) {
  const forced = Number(process.env.RIG_GIT_TIMEOUT_MS);
  if (forced > 0) return forced;
  return NETWORK_SUBCOMMANDS.has(args[0]) ? GIT_NETWORK_TIMEOUT_MS : GIT_TIMEOUT_MS;
}

/** Run git in `repo` with hooks off and a hard timeout. Returns trimmed stdout; error.stderr kept on failure. */
function safeGit(repo, args, { env, input, timeoutMs } = {}) {
  const hooks = pinnedHooksPath(); // throws RunFailure hooks-tampered (win32) when the fallback dir was planted
  // Caller-supplied GIT_CONFIG_COUNT entries are preserved: the pins continue after them.
  const base = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env };
  return execFileSync('git', ['-C', repo, '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs || gitTimeoutMs(args), killSignal: 'SIGKILL',
    env: { ...base, ...hardenedGitConfigEnv({ baseEnv: base, noSystem: false }) },
  }).trim();
}

/** safeGit returning {ok, out, err} instead of throwing. */
function tryGit(repo, args, opts) {
  try { return { ok: true, out: safeGit(repo, args, opts), err: '' }; } catch (e) {
    return { ok: false, out: '', err: String((e.stderr || '') + (e.message || '')).trim() };
  }
}

module.exports = { gitTimeoutMs, safeGit, tryGit };
