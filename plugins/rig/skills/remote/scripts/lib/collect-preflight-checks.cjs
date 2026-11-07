'use strict';
/**
 * Per-machine gates before a worker branch may be merged into rig-int/<slug>:
 *  1. head == reviewedSha of the machine's LAST phase (no unreviewed commits)
 *  2. orchestrator re-runs owns + denylist on base..head (defence in depth;
 *     the runner already checked before pushing).
 */
const { RemoteError, EXIT } = require('./remote-errors.cjs');
const { git, safeMessage } = require('./rig-local-worktree.cjs');
const { checkOwnsAndDenylist } = require('./owns-denylist-push-guard.cjs');
const { ownsUnion } = require('./plan-phase-machine-map.cjs');

const fail = (msg, cls, hint) => new RemoteError(msg, EXIT.ERROR, { class: cls, hint });

/** @returns {string} the sha the merge preflight approved (== headSha) */
function preflightMachine({ repo, map, machine, headSha, baseCandidateSha }) {
  const phases = map.filter((e) => e.machine === machine);
  const last = phases[phases.length - 1];
  if (!last) throw fail(`${machine} has no phases in this plan`, 'no-phases');
  if (!last.reviewedSha || last.reviewedSha !== headSha) {
    throw fail(`unreviewed commits on ${machine}: branch head ${headSha.slice(0, 8)} != reviewedSha ${last.reviewedSha ? last.reviewedSha.slice(0, 8) : '(none)'} of phase ${last.phase}`,
      'unreviewed-commits', `review ${machine}'s diff, then run: review <plan-dir> <phase ${last.phase} file> --sha ${headSha}`);
  }
  const mb = git(repo, ['merge-base', headSha, baseCandidateSha]);
  if (mb.status !== 0) throw fail(`${machine}: no merge-base with ${baseCandidateSha.slice(0, 8)}: ${safeMessage(mb.stderr)}`, 'no-merge-base');
  const violations = checkOwnsAndDenylist(repo, String(mb.stdout).trim(), headSha, ownsUnion(map, machine));
  if (violations.length) {
    throw fail(`${machine}: owns/denylist violations: ${violations.slice(0, 10).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('; ')}`, 'owns-violation', 'fix on the worker branch or widen "owns" in the phase frontmatter, then re-review');
  }
  return headSha;
}

module.exports = { preflightMachine };
