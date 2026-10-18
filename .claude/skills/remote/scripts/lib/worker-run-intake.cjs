'use strict';
/**
 * Shared front half of worker `start` and `exec`: validate payload, enforce
 * idempotency by runId, take the busy marker, create the 0700 run dir with
 * run.json + task.md. run.json = { v, spec, target, specHash, createdAt }
 * (the payload nonce never reaches disk: the envelope is parsed before us).
 */
const fs = require('fs');
const path = require('path');
const { RemoteError, EXIT, usageError } = require('./remote-errors.cjs');
const { selfMachineId, validateMachineEntry } = require('./machine-registry.cjs');
const { validateSpec, specHash } = require('./run-spec-validator.cjs');
const R = require('./run-directory.cjs');
const { sweepOrphanRunDirs } = require('./run-force-finalizer.cjs');

const MAX_TASK_BYTES = 1024 * 1024;

/**
 * @param {{spec:object, target:object, task?:string}} payload
 * @returns {{dir:string, run:object, existing:boolean}}
 */
function intakeRun(payload) {
  if (!payload || typeof payload !== 'object') throw usageError('payload must be {spec, target, task}');
  const self = selfMachineId();
  const target = validateMachineEntry(self, payload.target); // adds name; rejects unknown/secret keys
  const spec = validateSpec(payload.spec, { self, registryTools: target.allowedTools || [] });
  if (spec.kind === 'agent' && (typeof payload.task !== 'string' || !payload.task.trim() || Buffer.byteLength(payload.task) > MAX_TASK_BYTES)) {
    throw usageError('agent runs need a non-empty task string (<= 1 MB)');
  }
  try { sweepOrphanRunDirs(); } catch { /* housekeeping must never block a start */ }
  const hash = specHash(spec);
  const dir = R.runDirOf(spec.runId);
  const prev = R.readJson(path.join(dir, 'run.json'));
  if (prev) {
    if (prev.specHash !== hash) throw usageError(`runId ${spec.runId} exists with a different spec`, 'use a new runId');
    if (R.exists(path.join(dir, 'exit'))) {
      throw new RemoteError(`run ${spec.runId} already finished`, EXIT.ERROR, { class: 'finished', hint: 'use a new runId' });
    }
    return { dir, run: prev, existing: true };
  }
  // The exclusive mkdir is the ownership claim: busy acquire is re-entrant for the same runId, so a
  // losing same-runId racer must be stopped here, before it can touch (or clean up) the winner's state.
  try {
    R.createRunDir(spec.runId);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw new RemoteError(`run ${spec.runId} is already being started`, EXIT.ERROR, { class: 'exists', hint: 'retry status in a moment; do not reuse the runId' });
  }
  const busyName = R.busyNameFor(spec.kind, target.repo);
  const busyHint = 'one agent run and one test run per clone; wait or cancel it';
  try {
    // Older Rig versions on this worker user still use machine-wide agent.busy/test.busy: honor a live one (read-only).
    const legacy = R.liveBusyHolder(spec.kind === 'agent' ? 'agent' : 'test');
    if (legacy && legacy !== spec.runId) {
      throw new RemoteError(`${self} is busy with run ${legacy}`, EXIT.ERROR, { class: 'busy', hint: busyHint });
    }
    const busy = R.acquireBusy(busyName, spec.runId);
    if (!busy.ok) {
      throw new RemoteError(`${self} is busy with run ${busy.holder}`, EXIT.ERROR, { class: 'busy', hint: busyHint });
    }
    try {
      if (spec.kind === 'agent') R.writeFileAtomic(path.join(dir, 'task.md'), payload.task);
      const run = { v: 1, spec, target, specHash: hash, createdAt: Date.now() };
      R.writeJsonAtomic(path.join(dir, 'run.json'), run);
      return { dir, run, existing: false };
    } catch (e) {
      R.releaseBusy(busyName, spec.runId); // we acquired it above
      throw e;
    }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true }); // we created it above
    throw e;
  }
}

/** Finish a run that could not even be launched: exit file + busy release. */
function failUnlaunched(run, dir, message) {
  R.writeJsonAtomic(path.join(dir, 'result.json'), { runId: run.spec.runId, failure: 'prepare', detail: message, exit: 1, head: null, pushed: false });
  R.writeJsonAtomic(path.join(dir, 'exit'), { code: 1, failure: 'prepare', finishedAt: Date.now() });
  R.releaseBusy(R.busyNameForRun(run), run.spec.runId);
}

module.exports = { intakeRun, failUnlaunched, MAX_TASK_BYTES };
