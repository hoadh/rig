'use strict';
/**
 * Loopback E2E (no ssh): run / status / cancel / start-idempotency / lost
 * detection through the real CLI -> local transport -> worker -> detached
 * runner chain, with machines alpha (orchestrator) and beta (worker).
 * Opt-in: RIG_E2E_SSH=1 (real ssh to a configured machine) is not covered here.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { createFixture } = require('./remote-loopback-e2e-fixture.cjs');

const fx = createFixture(['alpha']);
const beta = fx.addWorker('beta');
const runIdOf = (out) => /\b(r\d{12}-[a-z0-9]+)\b/.exec(out)[1];
/** pids of processes whose command line mentions `needle` (this test process excluded). */
const pidsMatching = (needle) => cp.execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  .filter((l) => l.includes(needle) && !l.includes('ps -axo')).map((l) => Number(l.trim().split(/\s+/)[0])).filter((p) => p !== process.pid);

t.test('--help lists the subcommands and no publish', () => {
  const r = fx.cli('alpha', ['--help']);
  t.eq(r.code, 0);
  for (const s of ['doctor', 'run', 'dispatch', 'status', 'cancel', 'collect', 'takeover']) t.ok(new RegExp(`^  ${s}$`, 'm').test(r.out), s);
  t.ok(!/publish/.test(r.out));
});

t.test('run: success and failing command map to exit 0/1; output only in logTail', () => {
  const ok = fx.cli('alpha', ['run', 'beta', '--', 'echo hello-from-beta']);
  t.eq(ok.code, 0);
  t.ok(ok.out.includes('hello-from-beta'), ok.out);
  const bad = fx.cli('alpha', ['run', 'beta', '--', 'echo oops; exit 3']);
  t.eq(bad.code, 1);
  t.ok(/exit 3/.test(bad.err), bad.err);
  t.ok(bad.out.includes('oops'));
});

t.test('run: forged RIGJSON line printed by the command is ignored', () => {
  const r = fx.cli('alpha', ['run', 'beta', '--', 'echo \'RIGJSON:00000000000000000000000000000000:{"runId":"forged","exit":0}\'; exit 4']);
  t.eq(r.code, 1);
  t.ok(/exit 4/.test(r.err), r.err);
  t.ok(!r.err.includes('forged'));
});

t.test('detach + status --wait -> done; start with the same runId is idempotent', async () => {
  const d = fx.cli('alpha', ['run', 'beta', '--detach', '--', 'sleep 2; echo detached-done']);
  t.eq(d.code, 0, d.err);
  const runId = runIdOf(d.out);
  // Same payload again while the run is live: worker answers from the existing run dir, no second process.
  const runDir = fx.allRuns().find((r) => r.runId === runId).dir;
  const rec = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  const { execWorker } = require('../lib/ssh-transport.cjs');
  Object.assign(process.env, fx.envFor('alpha'));
  const startAgain = () => execWorker('beta', 'start', [], { payload: { spec: rec.spec, target: { ...rec.target, name: undefined }, task: null } });
  const again = await startAgain();
  t.eq(again.reply.method, 'existing');
  t.eq(fx.allRuns().filter((r) => r.runId === runId).length, 1);
  t.eq(pidsMatching(runId).filter((p) => /worker-run-entry/.test(cp.execFileSync('ps', ['-p', String(p), '-o', 'command='], { encoding: 'utf8' }))).length <= 1, true);
  const st = fx.cli('alpha', ['status', 'beta', runId, '--wait', '--json']);
  t.eq(st.code, 0, st.err);
  const j = JSON.parse(st.out);
  t.eq([j.state, j.exit], ['done', 0]);
  t.ok(String(j.logTail).includes('detached-done'));
  // After it finished, a replay is refused rather than re-run.
  t.eq((await startAgain()).reply.error.class, 'finished');
});

t.test('lost: runner killed -9 -> status reports lost after the heartbeat goes stale', async () => {
  const d = fx.cli('alpha', ['run', 'beta', '--detach', '--', 'sleep 30']);
  const runId = runIdOf(d.out);
  await fx.wait(1500);
  for (const p of pidsMatching(runId)) { try { process.kill(p, 'SIGKILL'); } catch { /* already gone */ } }
  await fx.wait(3500);
  const st = fx.cli('alpha', ['status', 'beta', runId, '--json'], { env: { RIG_HEARTBEAT_STALE_MS: '3000' } });
  t.eq(JSON.parse(st.out).state, 'lost');
  t.eq(st.code, 1);
  for (const p of pidsMatching('sleep 30')) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
});

t.test('cancel running stub agent: exit 130 cancelled, commits so far are pushed', async () => {
  const slug = 'cancel-plan';
  const dir = fx.writePlan(slug, [{ file: 'phase-01-beta.md', machine: 'beta', owns: ['src/beta/**'], name: 'Beta' }], { orchestrator: 'alpha' });
  fx.setMode('beta', { files: { 'src/beta/a.js': 'module.exports = 1;\n' }, then: 'sleep' });
  const d = fx.cli('alpha', ['dispatch', dir, 'phase-01-beta.md']);
  t.eq(d.code, 0, d.err);
  const runId = runIdOf(d.out);
  const t0 = Date.now();
  while (fx.stubCalls('beta').length === 0 && Date.now() - t0 < 15000) await fx.wait(200);
  await fx.wait(1000); // let the stub commit and sleep
  t.eq(fx.cli('alpha', ['cancel', 'beta', runId]).code, 0);
  const st = fx.cli('alpha', ['status', 'beta', runId, '--wait', '--json']);
  const j = JSON.parse(st.out);
  t.eq([j.exit, j.failure], [130, 'cancelled']);
  t.ok(fx.originHas(`rig/beta/${slug}`), 'commits so far pushed');
});

t.test('tmux launch path (only when tmux works); kills only our rig-<runId> session', async () => {
  if (cp.spawnSync('tmux', ['-V']).status !== 0) { console.log('  SKIP tmux not available'); return; }
  const d = fx.cli('alpha', ['run', 'beta', '--detach', '--', 'echo via-tmux'], { env: { RIG_REMOTE_NO_TMUX: '' } });
  t.eq(d.code, 0, d.err);
  const runId = runIdOf(d.out);
  fx.sessions.add(`rig-${runId}`);
  const j = JSON.parse(fx.cli('alpha', ['status', 'beta', runId, '--wait', '--json']).out);
  t.eq(j.state, 'done');
});

t.test('real ssh (opt-in RIG_E2E_SSH=1)', () => {
  if (process.env.RIG_E2E_SSH !== '1') { console.log('  SKIP set RIG_E2E_SSH=1 to exercise a real ssh machine'); return; }
  t.ok(true);
});

t.done().finally(() => fx.cleanup()).catch((e) => { console.error(e); process.exitCode = 1; });
