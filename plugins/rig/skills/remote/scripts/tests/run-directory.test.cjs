'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-rundir-'));
process.env.RIG_HOME = home;
delete process.env.RIG_RUNS_DIR;
const R = require('../lib/run-directory.cjs');
const V = require('../lib/identifier-validators.cjs');

const NOW = 1_000_000_000_000;
function mkRun(id, { createdAgo = 0, heartbeatAgo = null, exit = null, cancelled = false } = {}) {
  const dir = path.join(R.runsRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ createdAt: NOW - createdAgo, spec: { kind: 'agent', slug: 's1', orchestrator: 'mac' } }));
  if (heartbeatAgo !== null) {
    fs.writeFileSync(path.join(dir, 'heartbeat'), 'x');
    const s = (NOW - heartbeatAgo) / 1000;
    fs.utimesSync(path.join(dir, 'heartbeat'), s, s);
  }
  if (exit) fs.writeFileSync(path.join(dir, 'exit'), JSON.stringify(exit));
  if (cancelled) fs.writeFileSync(path.join(dir, 'cancelled'), '1');
  return dir;
}

t.test('newRunId matches the runId validator and is unique', () => {
  const a = R.newRunId(), b = R.newRunId();
  t.ok(V.isRunId(a)); t.ok(a !== b);
});

t.test('no heartbeat, young -> starting; old -> failed:not-started', () => {
  t.eq(R.readRunState(mkRun('run-aaaa0001', { createdAgo: 30_000 }), NOW).state, 'starting');
  const old = R.readRunState(mkRun('run-aaaa0002', { createdAgo: 181_000 }), NOW);
  t.eq([old.state, old.failure], ['failed', 'not-started']);
});

t.test('fresh heartbeat -> running; stale (>90s) -> lost', () => {
  t.eq(R.readRunState(mkRun('run-aaaa0003', { createdAgo: 500_000, heartbeatAgo: 10_000 }), NOW).state, 'running');
  t.eq(R.readRunState(mkRun('run-aaaa0004', { createdAgo: 500_000, heartbeatAgo: 91_000 }), NOW).state, 'lost');
});

t.test('cancelled sentinel without exit -> cancelling (starting or running); lost stays lost', () => {
  t.eq(R.readRunState(mkRun('run-aaaa0005', { createdAgo: 5_000, cancelled: true }), NOW).state, 'cancelling');
  t.eq(R.readRunState(mkRun('run-aaaa0006', { createdAgo: 500_000, heartbeatAgo: 1_000, cancelled: true }), NOW).state, 'cancelling');
  t.eq(R.readRunState(mkRun('run-aaaa0007', { createdAgo: 500_000, heartbeatAgo: 200_000, cancelled: true }), NOW).state, 'lost');
});

t.test('exit file wins: done / failed with failure class / nonzero code without failure', () => {
  const done = R.readRunState(mkRun('run-aaaa0008', { heartbeatAgo: 500_000, exit: { code: 0, failure: null } }), NOW);
  t.eq([done.state, done.exit], ['done', 0]);
  const f = R.readRunState(mkRun('run-aaaa0009', { exit: { code: 1, failure: 'agent' } }), NOW);
  t.eq([f.state, f.failure], ['failed', 'agent']);
  t.eq(R.readRunState(mkRun('run-aaaa0010', { exit: { code: 3, failure: null } }), NOW).state, 'failed');
  t.eq(R.readRunState(mkRun('run-aaaa0011', { cancelled: true, exit: { code: 130, failure: 'cancelled' } }), NOW).state, 'failed');
});

t.test('summarizeRun / listRunDirs expose the list contract fields', () => {
  const s = R.summarizeRun(path.join(R.runsRoot(), 'run-aaaa0003'), NOW);
  t.eq(Object.keys(s).sort(), ['exit', 'failure', 'head', 'heartbeatAt', 'kind', 'orchestrator', 'phase', 'pushed', 'runId', 'slug', 'startedAt', 'state']);
  t.ok(R.listRunDirs().length >= 11);
});

t.test('busy marker: exclusive, stale when holder finished, same runId re-entrant', () => {
  t.eq(R.acquireBusy('agent', 'run-aaaa0003'), { ok: true }); // holder is running (heartbeat 10s old at NOW, but real clock -> lost)
  // real clock: heartbeat mtime is 1e9 s epoch (year 2001) -> lost -> stale -> a new acquirer steals it
  t.eq(R.acquireBusy('agent', 'run-aaaa0003'), { ok: true });
  const live = path.join(R.runsRoot(), 'run-live0001');
  fs.mkdirSync(live); fs.writeFileSync(path.join(live, 'run.json'), JSON.stringify({ createdAt: Date.now(), spec: {} }));
  R.releaseBusy('agent', 'run-aaaa0003');
  t.eq(R.acquireBusy('agent', 'run-live0001'), { ok: true });
  t.eq(R.acquireBusy('agent', 'run-other001'), { ok: false, holder: 'run-live0001' }); // live holder (starting) blocks
  R.releaseBusy('agent', 'run-other001'); // not the holder -> no effect
  t.eq(R.acquireBusy('agent', 'run-other001').ok, false);
  fs.writeFileSync(path.join(live, 'exit'), JSON.stringify({ code: 0, failure: null }));
  t.eq(R.acquireBusy('agent', 'run-other001'), { ok: true }); // holder done -> stale
  t.eq(R.acquireBusy('test', 'run-other002'), { ok: true }); // independent marker
});

t.test('busy marker: empty holder (writer mid-create) is live inside grace, stale after it; holder never observed empty', () => {
  R.releaseBusy('agent', 'run-other002');
  const bf = path.join(R.rigHome(), 'agent.busy');
  try { fs.unlinkSync(bf); } catch { /* none */ }
  fs.writeFileSync(bf, '');
  t.eq(R.acquireBusy('agent', 'run-zzzz0001'), { ok: false, holder: 'unknown' });
  t.eq(fs.existsSync(bf), true);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(bf, old, old);
  t.eq(R.acquireBusy('agent', 'run-zzzz0001'), { ok: true });
  t.eq(fs.readFileSync(bf, 'utf8'), 'run-zzzz0001');
  t.eq(fs.readdirSync(R.rigHome()).filter((n) => n.endsWith('.tmp')), []);
  R.releaseBusy('agent', 'run-zzzz0001');
});

t.test('writeFileAtomic leaves no tmp file; tailFile returns last lines', () => {
  const f = path.join(home, 'a.txt');
  R.writeFileAtomic(f, 'one\ntwo\nthree\n');
  t.eq(fs.readdirSync(home).filter((n) => n.endsWith('.tmp')), []);
  t.eq(R.tailFile(f, 2), 'two\nthree');
  t.eq(R.tailFile(path.join(home, 'nope'), 2), '');
});

t.done().then(() => fs.rmSync(home, { recursive: true, force: true }));
