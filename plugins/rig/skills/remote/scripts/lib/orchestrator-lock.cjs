'use strict';
/**
 * Orchestrator lock = existence + content of branch rig-coord/<slug>.
 * Claim: push an orphan root commit (cannot fast-forward an existing ref, so a
 * plain push is create-only; exactly one claimant wins). Every mutating command
 * calls assertOrchestrator() right before acting. Fail-closed on any doubt.
 * Branch scheme: rig-coord/<slug> (orchestrator only), rig/<m>/<slug> (runner
 * only), rig-int/<slug> (collect only).
 */
const fs = require('fs');
const path = require('path');
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');
const { parseFrontmatter, setFrontmatterScalar } = require('./plan-frontmatter.cjs');
const { coordBranch } = require('./rig-branch-and-path-names.cjs');
const { ensureLocalWorktree, removeLocalWorktree, git, gitOrThrow, safeMessage } = require('./rig-local-worktree.cjs');
const sync = require('./coord-branch-sync.cjs');

const lockError = (msg, cls, hint) => new RemoteError(msg, EXIT.LOCK, { class: cls, hint });

/** Plan slug = plan directory basename (validated). */
const slugOf = (planDir) => V.assertSlug(path.basename(path.resolve(planDir)), 'plan slug');

/** Set `orchestrator: <self>` in the local plan.md; returns the previous text. */
function setLocalOrchestrator(planDir, self) {
  const file = path.join(planDir, 'plan.md');
  if (!fs.existsSync(file)) throw new RemoteError(`${file} not found`, EXIT.ERROR, { class: 'plan-missing' });
  const text = fs.readFileSync(file, 'utf8');
  if (parseFrontmatter(text).orchestrator !== self) fs.writeFileSync(file, setFrontmatterScalar(text, 'orchestrator', self));
  return text;
}

/** First claim of a slug. Cleans up the local worktree if the push loses. */
function claim(repo, planDir, slug, self) {
  const original = setLocalOrchestrator(planDir, self);
  const dirName = sync.coordDirName(slug);
  const { dir } = ensureLocalWorktree(repo, dirName, coordBranch(slug), { orphan: true });
  try {
    const m = sync.mirrorPlanToCoord(planDir, dir, { slug, self });
    sync.pushCoord(dir, slug);
    return m;
  } catch (e) {
    removeLocalWorktree(repo, dirName, coordBranch(slug));
    fs.writeFileSync(path.join(planDir, 'plan.md'), original);
    if (e.class === 'coord-moved') {
      throw lockError(`plan ${slug} was claimed by another machine`, 'coord-moved', 'fetch and retry, or /rig:remote takeover <plan-dir>');
    }
    throw e;
  }
}

/** orchestrator value of the fetched remote coord plan.md (untrusted -> validated). */
function remoteOrchestrator(repo, slug) {
  const r = git(repo, ['show', `${sync.coordRemoteRef(slug)}:plan.md`]);
  if (r.status !== 0) throw lockError(`coord branch has no readable plan.md: ${safeMessage(r.stderr)}`, 'coord-invalid');
  const orch = parseFrontmatter(r.stdout).orchestrator;
  if (!V.isMachineName(orch)) throw lockError(`coord plan.md has no valid orchestrator (${JSON.stringify(orch)})`, 'coord-invalid', 'run /rig:remote takeover <plan-dir>');
  return orch;
}

/**
 * Verify (or acquire) the lock for `selfId`. Throws RemoteError exit 3 unless we hold it.
 * @returns {{claimed:boolean, coordSha:string, committed?:boolean, warnings?:string[], redactions?:Array}}
 */
function assertOrchestrator(repo, planDir, selfId) {
  V.assertMachineName(selfId, 'self machine id');
  const slug = slugOf(planDir);
  const state = sync.remoteCoordState(repo, slug); // throws 3 on any error: never "unclaimed"
  const dirName = sync.coordDirName(slug);
  const localDir = path.join(repo, '.rig', dirName);
  if (state.state === 'missing') {
    if (fs.existsSync(localDir)) {
      throw lockError(`coord branch ${coordBranch(slug)} was deleted on the remote`, 'coord-deleted', `remove ${localDir} (git worktree remove --force) to reclaim`);
    }
    const m = claim(repo, planDir, slug, selfId);
    return { claimed: true, coordSha: gitOrThrow(path.join(localDir), ['rev-parse', 'HEAD']), ...m };
  }
  sync.fetchCoord(repo, slug);
  const owner = remoteOrchestrator(repo, slug);
  if (owner !== selfId) throw lockError(`plan ${slug} is locked by ${owner}`, 'locked', `/rig:remote takeover ${planDir}`);
  const { dir } = ensureLocalWorktree(repo, dirName, coordBranch(slug), { remoteRef: sync.coordRemoteRef(slug) });
  const ff = git(dir, ['merge', '-q', '--ff-only', sync.coordRemoteRef(slug)]);
  if (ff.status !== 0) throw lockError(`local coord worktree diverged from remote: ${safeMessage(ff.stderr)}`, 'coord-moved', `inspect ${dir}`);
  return { claimed: false, coordSha: state.sha };
}

/** assertOrchestrator + mirror + commit + push (internal API for dispatch/status/collect). */
function syncCoord(repo, planDir, selfId) {
  const lock = assertOrchestrator(repo, planDir, selfId);
  if (lock.claimed) return lock; // claim already mirrored + pushed
  const slug = slugOf(planDir);
  setLocalOrchestrator(planDir, selfId);
  const dir = path.join(repo, '.rig', sync.coordDirName(slug));
  const m = sync.mirrorPlanToCoord(planDir, dir, { slug, self: selfId });
  sync.pushCoord(dir, slug);
  return { ...lock, ...m, coordSha: gitOrThrow(dir, ['rev-parse', 'HEAD']) };
}

module.exports = { slugOf, assertOrchestrator, syncCoord, remoteOrchestrator };
