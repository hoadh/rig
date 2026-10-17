'use strict';
/**
 * Loopback E2E, fault paths: push rejection, owns violation, git-config
 * tampering (quarantine), unreachable origin (nothing claimed), coord lock
 * race between two orchestrator clones, takeover with an in-flight run.
 * Every fault uses a fresh worker machine: quarantine/dirty state persists.
 */
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { createFixture } = require('./remote-loopback-e2e-fixture.cjs');

const fx = createFixture(['alpha', 'delta']);
const phaseFor = (machine, owns) => ({ file: `phase-01-${machine}.md`, machine, owns, name: machine });

/** Plan with one phase on `machine`; dispatch; wait. @returns {{dir, d, st}} */
function runPhase(slug, machine, owns, mode) {
  fx.addWorker(machine);
  fx.setMode(machine, mode);
  const ph = phaseFor(machine, owns);
  const dir = fx.writePlan(slug, [ph], { orchestrator: 'alpha' });
  const d = fx.cli('alpha', ['dispatch', dir, ph.file]);
  t.eq(d.code, 0, d.err);
  return { dir, ph, d, st: fx.cli('alpha', ['status', dir, '--wait']) };
}

t.test('push rejected by origin -> failed:push', () => {
  fx.addWorker('pf');
  fx.setMode('pf', { files: { 'src/pf/a.js': '1\n' } });
  const ph = phaseFor('pf', ['src/pf/**']);
  const dir = fx.writePlan('push-plan', [ph], { orchestrator: 'alpha' });
  t.eq(fx.cli('alpha', ['dispatch', dir, ph.file]).code, 0);
  fx.rejectPushes();
  try {
    const st = fx.cli('alpha', ['status', dir, '--wait']);
    t.eq(st.code, 1, st.out);
    t.ok(/failed:push/.test(st.out), st.out);
  } finally { fx.allowPush(); }
  t.ok(!fx.originHas('rig/pf/push-plan'));
});

t.test('owns violation (.github/) -> failed:owns-violation, branch absent on origin', () => {
  const { st } = runPhase('owns-plan', 'ov', ['src/ov/**'], { files: { '.github/x.yml': 'on: push\n' } });
  t.eq(st.code, 1, st.out);
  t.ok(/failed:owns-violation/.test(st.out), st.out);
  t.ok(!fx.originHas('rig/ov/owns-plan'));
});

t.test('git config tamper -> failed:hooks-tampered, next start fails at prepare (quarantined)', () => {
  const { dir, ph, st } = runPhase('tamper-plan', 'tp', ['src/tp/**'], { files: { 'src/tp/a.js': '1\n' }, tamper: true });
  t.eq(st.code, 1, st.out);
  t.ok(/failed:hooks-tampered/.test(st.out), st.out);
  t.ok(!fx.originHas('rig/tp/tamper-plan'));
  fx.setMode('tp', { files: { 'src/tp/b.js': '2\n' } });
  const next = fx.cli('alpha', ['dispatch', dir, ph.file]);
  t.eq(next.code, 0, next.out + next.err);
  const st2 = fx.cli('alpha', ['status', dir, '--wait']);
  t.eq(st2.code, 1, st2.out);
  t.ok(/failed:prepare/.test(st2.out), st2.out);
  t.ok(!fx.originHas('rig/tp/tamper-plan'));
  t.eq(fx.stubCalls('tp').length, 1, 'agent never started again');
});

t.test('unreachable origin: dispatch/collect/takeover exit 3 and nothing is claimed', () => {
  const slug = 'bogus-plan';
  fx.addWorker('bg');
  const ph = phaseFor('bg', ['src/bg/**']);
  const dir = fx.writePlan(slug, [ph], { orchestrator: 'alpha' });
  const real = fx.git(fx.repoOf('alpha'), 'remote', 'get-url', 'origin');
  fx.git(fx.repoOf('alpha'), 'remote', 'set-url', 'origin', path.join(fx.root, 'does-not-exist.git'));
  fx.git(fx.repoOf('delta'), 'remote', 'set-url', 'origin', path.join(fx.root, 'does-not-exist.git'));
  try {
    t.eq(fx.cli('alpha', ['dispatch', dir, ph.file]).code, 3);
    t.eq(fx.cli('alpha', ['collect', dir]).code, 3);
    t.eq(fx.cli('delta', ['takeover', dir]).code, 3);
  } finally {
    fx.git(fx.repoOf('alpha'), 'remote', 'set-url', 'origin', real);
    fx.git(fx.repoOf('delta'), 'remote', 'set-url', 'origin', real);
  }
  t.ok(!fx.originHas(`rig-coord/${slug}`), 'coord branch not created');
  t.eq(fx.allRuns().filter((r) => r.machine === 'bg').length, 0);
});

t.test('lock race: two orchestrator clones claim the same slug -> exactly one wins (exit 3 for the loser)', async () => {
  const slug = 'race-plan';
  fx.addWorker('lk');
  fx.setMode('lk', { files: { 'src/lk/a.js': '1\n' } });
  const ph = phaseFor('lk', ['src/lk/**']);
  const dirA = fx.writePlan(slug, [ph]);
  const dirD = fx.writePlan(slug, [ph], { as: 'delta' });
  const [a, d] = await Promise.all([fx.cliAsync('alpha', ['dispatch', dirA, ph.file]), fx.cliAsync('delta', ['dispatch', dirD, ph.file])]);
  const codes = [a.code, d.code].sort();
  t.eq(codes, [0, 3], `${a.out}${a.err} | ${d.out}${d.err}`);
  t.ok(fx.originHas(`rig-coord/${slug}`));
  t.eq(fx.cli(a.code === 0 ? 'alpha' : 'delta', ['status', a.code === 0 ? dirA : dirD, '--wait']).code, 0);
});

t.test('takeover: delta takes over, lists alpha\'s in-flight beta run, alpha is then locked out', () => {
  const slug = 'takeover-plan';
  fx.addWorker('tk');
  fx.setMode('tk', { files: { 'src/tk/a.js': '1\n' }, then: 'sleep' });
  const ph = phaseFor('tk', ['src/tk/**']);
  const dir = fx.writePlan(slug, [ph], { orchestrator: 'alpha' });
  const d = fx.cli('alpha', ['dispatch', dir, ph.file]);
  t.eq(d.code, 0, d.err);
  const runId = /\b(r\d{12}-[a-z0-9]+)\b/.exec(d.out)[1];
  const dDir = path.join(fx.repoOf('delta'), 'plans', slug);
  const tk = fx.cli('delta', ['takeover', dDir]);
  t.eq(tk.code, 0, tk.out + tk.err);
  t.ok(tk.out.includes(`in-flight: tk run ${runId}`), tk.out);
  t.ok(/orchestrator: delta/.test(fs.readFileSync(path.join(dDir, 'plan.md'), 'utf8')));
  const locked = fx.cli('alpha', ['dispatch', dir, ph.file]);
  t.eq(locked.code, 3, locked.err);
  t.eq(fx.cli('delta', ['cancel', 'tk', runId]).code, 0);
});

t.done().finally(() => fx.cleanup()).catch((e) => { console.error(e); process.exitCode = 1; });
