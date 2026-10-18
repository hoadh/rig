'use strict';
/** Phase 03: busy markers are per clone (agent-<hash>/test-<hash>); legacy machine-wide markers are honored read-only. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { setup } = require('./worker-run-flow-fixture.cjs');
const R = require('../lib/run-directory.cjs');
const H = require('../lib/hardened-git-config-env.cjs');
const { intakeRun } = require('../lib/worker-run-intake.cjs');
const { sweepOrphanRunDirs, forceFinalize } = require('../lib/run-force-finalizer.cjs');

/** fn(fixture, targetForASecondClone) */
async function scenario(fn) {
  const f = setup();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-clone2-'));
  try { await fn(f, { ...f.target, repo: other }); } finally { fs.rmSync(other, { recursive: true, force: true }); f.cleanup(); }
}
const start = (f, target) => intakeRun({ spec: f.agentSpec(), target, task: 'x' });

t.test('cloneHash is shared (hardened-git-config-env re-exports run-directory)', () => {
  t.eq(H.cloneHash, R.cloneHash);
});

t.test('busyNameFor: agent/test kinds keyed by clone; command shares the test marker', () => {
  const h = R.cloneHash(os.tmpdir());
  t.eq(R.busyNameFor('agent', os.tmpdir()), `agent-${h}`);
  t.eq(R.busyNameFor('command', os.tmpdir()), `test-${h}`);
});

t.test('different clones run concurrently; same clone twice is refused busy with the per-clone hint', () => scenario(async (f, other) => {
  const a = start(f, f.target);
  const b = start(f, other);
  t.ok(!a.existing && !b.existing);
  t.throwsRemote(() => start(f, f.target), { cls: 'busy' });
  t.throwsRemote(() => start(f, other), { cls: 'busy' });
  let err;
  try { start(f, f.target); } catch (e) { err = e; }
  t.ok(/per clone/.test(JSON.stringify(err)), 'hint says per clone');
}));

t.test('legacy live agent.busy refuses; stale legacy marker is ignored', () => scenario(async (f) => {
  const holder = start(f, f.target); // live run (starting)
  R.releaseBusy(R.busyNameForRun(holder.run), holder.run.spec.runId);
  fs.writeFileSync(R.busyFile('agent'), holder.run.spec.runId); // pretend an older Rig holds it
  t.throwsRemote(() => start(f, f.target), { cls: 'busy' });
  fs.writeFileSync(path.join(holder.dir, 'exit'), JSON.stringify({ code: 0, failure: null })); // holder finished -> stale
  t.ok(start(f, f.target).run);
}));

t.test('orphan sweep releases a new-style marker held by a run.json-less dir', () => scenario(async (f) => {
  const old = 'r260101000001-bbbbbb';
  const dir = path.join(R.runsRoot(), old);
  fs.mkdirSync(dir, { recursive: true });
  const name = R.busyNameFor('agent', f.target.repo);
  t.eq(R.acquireBusy(name, old).ok, true);
  t.eq(sweepOrphanRunDirs(Date.now() + 3_600_000), [old]);
  t.ok(!fs.existsSync(R.busyFile(name)));
}));

t.test('force-finalize releases only the busy file of the run clone', () => scenario(async (f, other) => {
  const a = start(f, f.target);
  const b = start(f, other);
  forceFinalize(a.dir, a.run, { failure: 'cancelled', code: 130, detail: 'x' });
  t.ok(!fs.existsSync(R.busyFile(R.busyNameForRun(a.run))));
  t.ok(fs.existsSync(R.busyFile(R.busyNameForRun(b.run))));
}));

/** Write the env.json the runner would normally consume; returns its path. */
const writeEnv = (dir) => { const p = path.join(dir, 'env.json'); fs.writeFileSync(p, '{}'); return p; };

t.test('force-finalize on run.json with spec but no target: releases the marker held by its runId, removes env.json, no throw', () => scenario(async (f, other) => {
  const a = start(f, f.target);
  const b = start(f, other);
  const envPath = writeEnv(a.dir);
  const rec = { ...a.run };
  delete rec.target;
  let threw = null;
  try { forceFinalize(a.dir, rec, { failure: 'cancelled', code: 130, detail: 'x' }); } catch (e) { threw = e; }
  t.eq(threw, null, 'forceFinalize must not throw on a target-less record');
  t.ok(!fs.existsSync(R.busyFile(R.busyNameFor('agent', f.target.repo))), 'a marker held by the run is released');
  t.ok(!fs.existsSync(envPath), 'env.json removed');
  t.ok(fs.existsSync(R.busyFile(R.busyNameForRun(b.run))), "other clone's marker untouched");
}));

t.test('force-finalize on a null record (no run.json) falls back to releasing by runId, no throw', () => scenario(async (f, other) => {
  const a = start(f, f.target);
  const b = start(f, other);
  const envPath = writeEnv(a.dir);
  t.eq(forceFinalize(a.dir, null, { failure: 'not-started', code: 1, detail: 'x' }), true);
  t.ok(!fs.existsSync(R.busyFile(R.busyNameForRun(a.run))), 'marker held by the run released');
  t.ok(fs.existsSync(R.busyFile(R.busyNameForRun(b.run))), "other clone's marker untouched");
  t.ok(!fs.existsSync(envPath), 'env.json removed');
}));

t.test('force-finalize on a record with target but no spec falls back to releasing by runId', () => scenario(async (f) => {
  const a = start(f, f.target);
  const envPath = writeEnv(a.dir);
  const rec = { ...a.run };
  delete rec.spec;
  forceFinalize(a.dir, rec, { failure: 'cancelled', code: 130, detail: 'x' });
  t.ok(!fs.existsSync(R.busyFile(R.busyNameForRun(a.run))), 'marker released without spec');
  t.ok(!fs.existsSync(envPath), 'env.json removed');
}));

t.done();
