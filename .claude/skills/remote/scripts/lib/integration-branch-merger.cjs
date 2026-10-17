'use strict';
/**
 * Builds rig-int/<slug> in the dedicated worktree .rig/int-<slug>: starts at
 * origin's rig-int tip (or the plan branch sha), merges each worker branch sha
 * in plan order with --no-ff (idempotent: already-merged = skipped), pushes
 * without force and verifies origin == local HEAD. A conflict leaves the
 * merge in progress in the worktree for manual resolution (exit 4).
 */
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const { git, gitOrThrow, safeMessage, ensureLocalWorktree } = require('./rig-local-worktree.cjs');
const { integrationBranch } = require('./rig-branch-and-path-names.cjs');
const { lsRemoteHead } = require('./dispatch-base-resolver.cjs');

const fail = (msg, cls, hint, code = EXIT.ERROR) => new RemoteError(msg, code, { class: cls, hint });

function identityArgs(dir) {
  const has = (k) => git(dir, ['config', '--get', k]).status === 0;
  return has('user.name') && has('user.email') ? [] : ['-c', 'user.name=rig-collect', '-c', 'user.email=rig-collect@localhost'];
}

/**
 * @param {{repo:string, slug:string, planSha:string, branches:Array<{machine:string, sha:string}>}} p
 * @returns {{intSha:string, dir:string, merged:string[], skipped:string[], pushed:boolean}}
 */
function mergeIntoIntegration({ repo, slug, planSha, branches }) {
  const branch = integrationBranch(slug);
  const remoteSha = lsRemoteHead(repo, branch);
  let remoteRef = planSha;
  if (remoteSha) {
    gitOrThrow(repo, ['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    remoteRef = `refs/remotes/origin/${branch}`;
  }
  const { dir } = ensureLocalWorktree(repo, `int-${slug}`, branch, { remoteRef });
  if (remoteSha && git(dir, ['merge', '--ff-only', '-q', remoteSha]).status !== 0) {
    throw fail(`local ${branch} diverged from origin`, 'int-diverged', `inspect ${dir}; origin has ${remoteSha.slice(0, 8)}`);
  }
  const merged = [];
  const skipped = [];
  for (const { machine, sha } of branches) {
    if (git(dir, ['merge-base', '--is-ancestor', sha, 'HEAD']).status === 0) { skipped.push(machine); continue; }
    const r = git(dir, [...identityArgs(dir), 'merge', '--no-ff', '--no-edit', '-m', `Merge rig/${machine}/${slug} into ${branch}`, sha]);
    if (r.status !== 0) {
      const files = String(git(dir, ['diff', '--name-only', '--diff-filter=U']).stdout).trim().split('\n').filter(Boolean);
      throw fail(`merge conflict merging ${machine} (${sha.slice(0, 8)}): ${files.join(', ') || safeMessage(r.stderr)}`, 'merge-conflict',
        `resolve in ${dir}, commit, then rerun collect`, EXIT.CONFLICT);
    }
    merged.push(machine);
  }
  const intSha = gitOrThrow(dir, ['rev-parse', 'HEAD']);
  const needPush = intSha !== remoteSha;
  if (needPush) {
    const p = git(dir, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { timeoutMs: 120000 });
    if (p.status !== 0) throw fail(`push ${branch} failed: ${safeMessage(p.stderr)}`, 'push-failed', 'fetch and rerun collect (no force push is ever used)');
  }
  if (lsRemoteHead(repo, branch) !== intSha) throw fail(`origin ${branch} != local HEAD after push`, 'push-verify-failed', 'rerun collect');
  return { intSha, dir, merged, skipped, pushed: needPush };
}

module.exports = { mergeIntoIntegration };
