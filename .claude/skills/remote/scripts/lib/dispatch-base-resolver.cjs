'use strict';
/**
 * Resolves the IMMUTABLE start state of a dispatch from the remote (ls-remote
 * is the source of truth, never local refs alone):
 *   push-first    plan branch and rig/<self>/<slug> must equal origin
 *   baseSha       rig-int/<slug> head, else plan branch head
 *   collect-first every cross-machine dependency branch must be inside baseSha
 *   startSha      rig/<machine>/<slug> head (resume) else baseSha
 */
const { RemoteError, EXIT, usageError } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');
const { workerBranch, integrationBranch } = require('./rig-branch-and-path-names.cjs');
const { git, gitOrThrow, safeMessage } = require('./rig-local-worktree.cjs');

const fail = (msg, cls, hint) => new RemoteError(msg, EXIT.ERROR, { class: cls, hint });

/** Remote head sha of refs/heads/<branch> or null when absent. Other errors throw. */
function lsRemoteHead(repo, branch) {
  const r = git(repo, ['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`], { timeoutMs: 30000 });
  if (r.status === 2) return null;
  const sha = String(r.stdout).split(/\s+/)[0];
  if (r.status !== 0 || !V.isSha(sha)) throw fail(`ls-remote ${branch} failed: ${safeMessage(r.stderr) || 'unexpected output'}`, 'ls-remote-failed', 'check network / origin access');
  return sha;
}

const localHead = (repo, branch) => {
  const r = git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]);
  return r.status === 0 ? String(r.stdout).trim() : null;
};

/** Plan branch from plan.md frontmatter `branch:` (validated as a safe ref name). */
function planBranchOf(frontmatter) {
  const b = frontmatter.branch;
  if (typeof b !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(b) || b.includes('..') || b.endsWith('.lock')) {
    throw usageError(`plan.md needs a valid "branch:" (got ${JSON.stringify(b)})`);
  }
  return b;
}

/** Orchestrator's own work must be on origin: local head === remote head. */
function assertPushed(repo, branch) {
  const local = localHead(repo, branch);
  if (!local) return null; // branch not present locally: nothing unpushed
  const remote = lsRemoteHead(repo, branch);
  if (local !== remote) {
    throw fail(`${branch} is not pushed (local ${local.slice(0, 8)} vs origin ${remote ? remote.slice(0, 8) : 'missing'})`, 'push-first', `git push origin ${branch}  (workers build on origin state)`);
  }
  return local;
}

function fetchBranch(repo, branch) {
  gitOrThrow(repo, ['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeoutMs: 120000 });
}

/**
 * @param {{repo:string, slug:string, self:string, machine:string, planBranch:string,
 *   dependsOnMachines:string[]}} p other machines whose phases this phase dependsOn
 * @returns {{baseSha:string, startSha:string, planSha:string, intSha:string|null}}
 */
function resolveDispatchBase({ repo, slug, self, machine, planBranch, dependsOnMachines = [] }) {
  const planSha = assertPushed(repo, planBranch);
  if (!planSha) throw fail(`plan branch ${planBranch} does not exist locally`, 'plan-branch-missing', 'check "branch:" in plan.md');
  assertPushed(repo, workerBranch(self, slug));
  const intSha = lsRemoteHead(repo, integrationBranch(slug));
  const baseSha = intSha || planSha;
  for (const dep of [...new Set(dependsOnMachines)].filter((m) => m !== machine)) {
    const head = lsRemoteHead(repo, workerBranch(dep, slug));
    if (!head) throw fail(`dependency on ${dep}: branch ${workerBranch(dep, slug)} not found on origin`, 'collect-first', 'dispatch and collect the dependency phase first');
    fetchBranch(repo, workerBranch(dep, slug));
    if (intSha) fetchBranch(repo, integrationBranch(slug));
    if (git(repo, ['merge-base', '--is-ancestor', head, baseSha]).status !== 0) {
      throw fail(`dependency ${dep} (${head.slice(0, 8)}) is not in base ${baseSha.slice(0, 8)}`, 'collect-first', `run collect for ${slug} so ${integrationBranch(slug)} contains ${dep}'s work`);
    }
  }
  const startSha = lsRemoteHead(repo, workerBranch(machine, slug)) || baseSha;
  return { baseSha, startSha, planSha, intSha };
}

module.exports = { lsRemoteHead, localHead, planBranchOf, resolveDispatchBase };
