'use strict';
/**
 * Fail-closed gate on the known-good git control-file baseline (review H1).
 * The baseline lives outside the clone (~/.rig/git-baseline-<hash>.json), so a
 * tamper from an earlier run or from the test clone cannot be re-baselined as "h0".
 *   match    -> proceed
 *   missing  -> failed:prepare (record it with `worker.cjs baseline --repo <clone>` after a fresh clone)
 *   mismatch -> quarantine the clone + failed:hooks-tampered
 */
const { RunFailure } = require('./run-directory.cjs');
const { verifyKnownGoodBaseline } = require('./hardened-git-config-env.cjs');
const { writeQuarantine } = require('./git-control-files-integrity.cjs');

/** @returns {string} the baseline hash (h0) */
function assertKnownGoodBaseline(repo, context) {
  const v = verifyKnownGoodBaseline(repo);
  if (v.status === 'match') return v.expected;
  if (v.status === 'missing') {
    throw new RunFailure('prepare', `no known-good git baseline recorded for ${repo}`, {
      hint: `re-clone ${repo}, inspect it, then run: node <skill>/scripts/worker.cjs baseline --repo ${repo}`,
    });
  }
  try { writeQuarantine(repo, `${context}: git config/hooks/info differ from the known-good baseline`); } catch { /* best effort; the failure below still stops the run */ }
  throw new RunFailure('hooks-tampered', `git config/hooks/info differ from the known-good baseline (${context}); clone quarantined, nothing pushed`);
}

module.exports = { assertKnownGoodBaseline };
