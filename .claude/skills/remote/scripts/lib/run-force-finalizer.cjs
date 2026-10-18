'use strict';
/**
 * Worker-side finishing of runs that have no live runner to finish themselves:
 * cancel of a lost/starting run, `not-started` runs (launcher never fired), and the
 * sweep of run dirs that never got a run.json (crash between mkdir and write).
 * Order matters: kill the agent tree, write `exit` (a late-firing runner refuses to
 * run once it exists), release the busy marker, delete the auth handoff file.
 */
const fs = require('fs');
const path = require('path');
const R = require('./run-directory.cjs');
const V = require('./identifier-validators.cjs');
const { killRecordedAgent } = require('./agent-process-registry.cjs');
const { stopLaunched } = require('./detached-process-launcher.cjs');

const ORPHAN_DIR_MIN_AGE_MS = 120_000;

/**
 * @param {string} dir run dir
 * @param {object|null} rec parsed run.json (null: only cleanup)
 * @param {{failure:string, code:number, detail:string}} why
 * @returns {boolean} true when this call wrote the exit file
 */
function forceFinalize(dir, rec, why) {
  const runId = path.basename(dir);
  killRecordedAgent(dir);
  stopLaunched(runId);
  let wrote = false;
  if (!R.exists(path.join(dir, 'exit'))) { // a runner that is in fact alive and finishing keeps its own result
    R.writeFileExclusive(path.join(dir, 'result.json'), `${JSON.stringify({ runId, failure: why.failure, detail: why.detail, exit: why.code, head: null, pushed: false })}\n`);
    wrote = R.writeFileExclusive(path.join(dir, 'exit'), `${JSON.stringify({ code: why.code, failure: why.failure, finishedAt: Date.now() })}\n`);
  }
  // run.json without a target (partial/old record): free whichever marker this run holds
  if (rec && rec.spec && rec.target && rec.target.repo) R.releaseBusy(R.busyNameForRun(rec), runId);
  else R.releaseBusyHeldBy(runId);
  try { fs.unlinkSync(path.join(dir, 'env.json')); } catch { /* absent: runner already consumed it */ }
  return wrote;
}

/** Finish a run whose launcher never produced a heartbeat within the grace period. @returns {boolean} */
function finalizeIfNeverStarted(dir) {
  const rec = R.readJson(path.join(dir, 'run.json'));
  if (!rec) return false;
  const st = R.readRunState(dir);
  if (st.state !== 'failed' || st.failure !== 'not-started') return false;
  forceFinalize(dir, rec, { failure: 'not-started', code: 1, detail: 'runner never started (launcher did not fire within the grace period)' });
  return true;
}

/**
 * Remove run dirs that never got a run.json and are older than `minAgeMs`; free a busy marker held by them.
 * @returns {string[]} swept runIds
 */
function sweepOrphanRunDirs(now = Date.now(), minAgeMs = ORPHAN_DIR_MIN_AGE_MS) {
  const swept = [];
  let names = [];
  try { names = fs.readdirSync(R.runsRoot()); } catch { return swept; }
  for (const name of names.filter((n) => V.isRunId(n))) {
    const dir = path.join(R.runsRoot(), name);
    if (R.exists(path.join(dir, 'run.json'))) continue;
    const m = R.mtimeMs(dir);
    if (m === null || now - m < minAgeMs) continue;
    try {
      killRecordedAgent(dir);
      R.releaseBusyHeldBy(name);
      fs.rmSync(dir, { recursive: true, force: true });
      swept.push(name);
    } catch { /* best effort: next intake retries */ }
  }
  return swept;
}

module.exports = { forceFinalize, finalizeIfNeverStarted, sweepOrphanRunDirs, ORPHAN_DIR_MIN_AGE_MS };
