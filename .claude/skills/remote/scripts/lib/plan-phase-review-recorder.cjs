'use strict';
/**
 * Orchestrator review write-back: after code-reviewer approves a worker's
 * diff, record `reviewedSha` (+ optional `reviewScore`) in the phase file's
 * frontmatter. `collect` refuses a branch whose head differs from the
 * reviewedSha of that machine's last phase, so a later worker commit
 * invalidates the review automatically. Only those two lines are edited.
 */
const fs = require('fs');
const { setFrontmatterScalar } = require('./plan-frontmatter.cjs');
const { usageError } = require('./remote-errors.cjs');
const V = require('./identifier-validators.cjs');

/**
 * @param {string} phaseFile absolute path of a phase file that has frontmatter
 * @param {{sha:string, score?:number|string|null}} o score 0..10 (code-reviewer scale)
 * @returns {{sha:string, score:number|null}}
 */
function recordReview(phaseFile, { sha, score = null }) {
  V.assertSha(sha, 'reviewed sha');
  let n = null;
  if (score !== null && score !== undefined) {
    n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 10) throw usageError(`--score must be a number 0..10, got ${JSON.stringify(score)}`);
  }
  let text = fs.readFileSync(phaseFile, 'utf8');
  try {
    text = setFrontmatterScalar(text, 'reviewedSha', sha);
    if (n !== null) text = setFrontmatterScalar(text, 'reviewScore', String(n));
  } catch (e) {
    throw usageError(`${phaseFile}: ${e.message} (phase file needs a frontmatter block)`);
  }
  fs.writeFileSync(phaseFile, text);
  return { sha, score: n };
}

module.exports = { recordReview };
