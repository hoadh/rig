'use strict';
/**
 * Test checkout for `rig:remote run`: `<repo>-rig-test` is a SEPARATE clone
 * (own object store and git dir, no --shared / worktree link) of the real origin, so
 * untrusted test code cannot reach the agent clone's git dir through it (review H1).
 * Never pushes. The origin url is read from the agent clone, so the agent clone must pass the known-good
 * baseline gate first (a tampered url would otherwise receive the runner's credentials on fetch, review M-A):
 * test runs therefore need `worker.cjs baseline --repo <clone>` just like agent runs. On reuse the test
 * clone's config is rewritten wholesale (L6). Same-user code can still address the agent clone by path; the
 * known-good baseline gate catches that on the next agent run.
 */
const fs = require('fs');
const path = require('path');
const { RunFailure } = require('./run-directory.cjs');
const { safeGit, tryGit } = require('./safe-git-runner.cjs');
const { assertKnownGoodBaseline } = require('./git-baseline-gate.cjs');
const { resetTestCloneConfig } = require('./test-clone-config-resetter.cjs');
const { assertRepo, ensureCommits } = require('./worker-repo-preparer.cjs');

const GITDIR = '.' + 'git'; // the clone's git dir entry

/** Pre-H1 layout: the git dir entry of `<repo>-rig-test` is a FILE linking to the agent clone. Remove that worktree. */
function removeLegacyLinkedWorktree(repo, wt) {
  let isFile = false;
  try { isFile = fs.statSync(path.join(wt, GITDIR)).isFile(); } catch { /* absent: handled by caller */ }
  if (!isFile) return;
  tryGit(repo, ['worktree', 'remove', '--force', wt]);
  fs.rmSync(wt, { recursive: true, force: true });
  tryGit(repo, ['worktree', 'prune']);
}

/** @returns {{cwd:string, head:string}} */
function prepareTestClone(spec, target) {
  const repo = target.repo;
  assertRepo(repo);
  assertKnownGoodBaseline(repo, `test run of ${spec.ref}`); // M-A: fail closed before trusting remote.origin.url
  const origin = tryGit(repo, ['config', '--get', 'remote.origin.url']);
  if (!origin.ok || !origin.out) throw new RunFailure('prepare', 'agent clone has no origin url', { detail: origin.err.slice(-400) });
  const wt = `${repo}-rig-test`;
  removeLegacyLinkedWorktree(repo, wt);
  if (!fs.existsSync(path.join(wt, GITDIR))) {
    fs.rmSync(wt, { recursive: true, force: true }); // leftover non-git dir
    const c = tryGit(path.dirname(wt), ['clone', '--quiet', '--no-checkout', '--no-local', '--', origin.out, wt]);
    if (!c.ok) throw new RunFailure('prepare', 'cannot create test clone', { detail: c.err.slice(-400) });
  } else {
    // untrusted code may have rewritten remotes/insteadOf/credential/core settings: rewrite the whole config
    try { resetTestCloneConfig(wt, origin.out); } catch (e) { throw e instanceof RunFailure ? e : new RunFailure('prepare', 'cannot reset config of test clone', { detail: e.message }); }
  }
  ensureCommits(wt, [spec.ref]);
  const co = tryGit(wt, ['checkout', '--quiet', '--detach', '--force', spec.ref]);
  if (!co.ok) throw new RunFailure('prepare', 'cannot check out ref in test clone', { detail: co.err.slice(-400) });
  tryGit(wt, ['clean', '-fdq']); // keeps ignored files (node_modules caches)
  return { cwd: wt, head: safeGit(wt, ['rev-parse', 'HEAD']) };
}

module.exports = { prepareTestClone };
