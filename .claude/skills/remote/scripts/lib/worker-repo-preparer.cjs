'use strict';
/**
 * Prepares the Rig-dedicated agent clone (the test clone lives in worker-test-clone-preparer).
 * EVERY git call here goes through safeGit (safe-git-runner): hooks off, config pins via env,
 * so repo-local hooks/config cannot run code in the privileged runner. Failures throw RunFailure(prepare|lock).
 */
const { RunFailure } = require('./run-directory.cjs');
const { safeGit, tryGit, gitTimeoutMs } = require('./safe-git-runner.cjs');
const { assertKnownGoodBaseline } = require('./git-baseline-gate.cjs');
const { parseFrontmatter } = require('./plan-frontmatter.cjs');
const { coordBranch } = require('./rig-branch-and-path-names.cjs');
const { isQuarantined } = require('./git-control-files-integrity.cjs');

/** Merge commits need an identity; supply one only when the clone has none. */
function identityEnv(repo) {
  if (tryGit(repo, ['config', 'user.email']).ok) return {};
  return {
    GIT_AUTHOR_NAME: 'Rig Worker', GIT_AUTHOR_EMAIL: 'rig-worker@localhost',
    GIT_COMMITTER_NAME: 'Rig Worker', GIT_COMMITTER_EMAIL: 'rig-worker@localhost',
  };
}

const hasCommit = (repo, sha) => tryGit(repo, ['cat-file', '-e', `${sha}^{commit}`]).ok;

/** Fetch whichever of `shas` are missing locally; any still missing afterwards -> prepare failure. */
function ensureCommits(repo, shas) {
  const missing = [...new Set(shas)].filter((s) => !hasCommit(repo, s));
  if (!missing.length) return;
  const f = tryGit(repo, ['fetch', '--quiet', 'origin', ...missing]);
  const still = missing.filter((s) => !hasCommit(repo, s));
  if (still.length) {
    throw new RunFailure('prepare', `commit ${still[0]} not available from origin`, { detail: f.err.slice(-400), hint: 'was it pushed? (push-first rule)' });
  }
}

function assertRepo(repo) {
  if (!tryGit(repo, ['rev-parse', '--git-dir']).ok) {
    throw new RunFailure('prepare', `${repo} is not a git clone`, { hint: 'create the dedicated clone first (rig:remote doctor)' });
  }
}

/** Fetch the coord branch and require plan.md `orchestrator` === spec.orchestrator. */
function recheckCoordOwner(repo, spec) {
  const ref = `refs/remotes/origin/${coordBranch(spec.slug)}`;
  const f = tryGit(repo, ['fetch', '--quiet', 'origin', `+refs/heads/${coordBranch(spec.slug)}:${ref}`]);
  if (!f.ok) throw new RunFailure('lock', `cannot fetch ${coordBranch(spec.slug)}`, { detail: f.err.slice(-400) });
  const show = tryGit(repo, ['show', `${ref}:plan.md`]);
  if (!show.ok) throw new RunFailure('lock', `plan.md missing on ${coordBranch(spec.slug)}`);
  const owner = parseFrontmatter(show.out).orchestrator;
  if (owner !== spec.orchestrator) {
    throw new RunFailure('lock', `plan is owned by ${JSON.stringify(owner)}, run was dispatched by ${JSON.stringify(spec.orchestrator)}`);
  }
}

/**
 * The clone is Rig-dedicated: leftovers from a crashed/failed run are discarded instead of wedging
 * every later run. `clean -fd` (no -x) keeps ignored files such as dependency caches.
 * @returns {string} the discarded `status --porcelain` (capped; '' when the tree was clean)
 */
function resetDedicatedClone(repo) {
  const dirty = safeGit(repo, ['status', '--porcelain']);
  if (dirty === '') return '';
  tryGit(repo, ['merge', '--abort']); // a half-finished merge from a prior run; failure just means none in progress
  for (const args of [['reset', '--hard', '--quiet'], ['clean', '-fdq']]) {
    const r = tryGit(repo, args);
    if (!r.ok) throw new RunFailure('prepare', `cannot reset dirty dedicated clone (git ${args[0]})`, { detail: r.err.slice(-400) });
  }
  return dirty.slice(0, 2000);
}

/** @returns {{cwd:string, head:string, wasDirty:string, baseline:string}} baseline = known-good control-file hash (h0) */
function prepareAgentClone(spec, target) {
  const repo = target.repo;
  assertRepo(repo);
  if (isQuarantined(repo)) throw new RunFailure('prepare', 'clone is quarantined after a hooks/config tamper', { hint: `inspect, then delete the rig-quarantine marker in its git dir or re-clone ${repo}` });
  const baseline = assertKnownGoodBaseline(repo, 'prepare'); // before any agent run; mismatch quarantines
  const wasDirty = resetDedicatedClone(repo);
  ensureCommits(repo, [spec.baseSha, spec.startSha]);
  recheckCoordOwner(repo, spec);
  const co = tryGit(repo, ['checkout', '--quiet', '-B', spec.branch, spec.startSha]);
  if (!co.ok) throw new RunFailure('prepare', `checkout ${spec.branch} failed`, { detail: co.err.slice(-400) });
  if (!tryGit(repo, ['merge-base', '--is-ancestor', spec.baseSha, 'HEAD']).ok) {
    const m = tryGit(repo, ['merge', '--no-edit', '--quiet', spec.baseSha], { env: identityEnv(repo) });
    if (!m.ok) {
      tryGit(repo, ['merge', '--abort']);
      throw new RunFailure('prepare', `merging base ${spec.baseSha.slice(0, 8)} conflicts`, { detail: m.err.slice(-400) });
    }
  }
  return { cwd: repo, head: safeGit(repo, ['rev-parse', 'HEAD']), wasDirty, baseline };
}

module.exports = { prepareAgentClone, identityEnv, assertRepo, ensureCommits };
