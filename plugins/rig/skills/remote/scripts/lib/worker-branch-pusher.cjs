'use strict';
/**
 * Runner-owned push of the worker branch: explicit refspec, never force,
 * runs with the runner's full env (agent never holds push rights). Retries
 * transient failures (1 try + 3 retries, backoff 5/15/45 s); auth and
 * non-fast-forward rejections fail fast since retrying cannot help.
 */
const { safeGit } = require('./safe-git-runner.cjs');

const BACKOFF_MS = [5000, 15000, 45000];
const AUTH_RE = /permission denied|authentication failed|could not read (?:username|password)|host key verification failed|invalid username or password|\b40[13]\b|repository not found|publickey/i;
const RATE_RE = /rate limit|\b429\b|too many requests|abuse detection|secondary rate/i;
const REJECT_RE = /\[rejected\]|non-fast-forward|fetch first|protected branch|pre-receive hook declined|cannot lock ref/i;

/** @returns {'auth'|'ratelimit'|'push'} failure class for a git push stderr */
function classifyPushError(stderr) {
  const s = String(stderr || '');
  if (RATE_RE.test(s)) return 'ratelimit';
  if (AUTH_RE.test(s)) return 'auth';
  return 'push';
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve the commit that the owns/denylist guard checked (HEAD unless `head` given). */
function resolveHead(repo, head, git) {
  const sha = head || git(repo, ['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error(`cannot resolve a 40-hex head sha: ${JSON.stringify(sha)}`);
  return sha;
}

/**
 * Pushes the exact SHA the guard checked (`<sha>:refs/heads/<branch>`), never
 * the local branch ref (which an agent child could move after the check), then
 * verifies via ls-remote that origin holds that SHA.
 * @param {string} repo
 * @param {string} branch rig/<machine>/<slug>
 * @param {{head?: string, backoffMs?: number[], git?: Function, sleep?: Function}} [opts] injectable for tests;
 *   `head` = the checked sha (defaults to HEAD, which is what the guard diffs)
 * @returns {Promise<{ok:true, attempts:number, head:string}|{ok:false, attempts:number, failure:'auth'|'ratelimit'|'push', detail:string}>}
 */
async function pushWithRetry(repo, branch, { head, backoffMs = BACKOFF_MS, git = safeGit, sleep = sleepMs } = {}) {
  let sha;
  try { sha = resolveHead(repo, head, git); } catch (e) { return { ok: false, attempts: 0, failure: 'push', detail: e.message }; }
  const remoteRef = `refs/heads/${branch}`;
  const refspec = `${sha}:${remoteRef}`; // no '+': never force
  let last = { failure: 'push', detail: '' };
  for (let attempt = 1; attempt <= backoffMs.length + 1; attempt++) {
    try {
      git(repo, ['push', '--quiet', 'origin', refspec]);
      const remote = String(git(repo, ['ls-remote', 'origin', remoteRef])).split(/\s+/)[0];
      if (remote !== sha) {
        return { ok: false, attempts: attempt, failure: 'push', detail: `post-push verify failed: origin ${remoteRef} is ${remote || 'missing'}, expected ${sha}` };
      }
      return { ok: true, attempts: attempt, head: sha };
    } catch (e) {
      const stderr = String(e.stderr || e.message || '');
      last = { failure: classifyPushError(stderr), detail: stderr.trim().slice(-500) };
      const permanent = last.failure === 'auth' || REJECT_RE.test(stderr);
      if (permanent || attempt > backoffMs.length) return { ok: false, attempts: attempt, ...last };
      await sleep(backoffMs[attempt - 1]);
    }
  }
  return { ok: false, attempts: backoffMs.length + 1, ...last };
}

module.exports = { classifyPushError, pushWithRetry, BACKOFF_MS };
