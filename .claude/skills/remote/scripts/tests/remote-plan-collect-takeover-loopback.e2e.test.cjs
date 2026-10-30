'use strict';
/**
 * Loopback E2E, happy paths of a multi-machine plan: alpha orchestrates,
 * beta + gamma run stub agents. dispatch -> status --wait -> review -> collect
 * (+ per-machine tests, idempotent rerun), merge conflict -> resolve -> rerun,
 * dispatch refusals, --settings passthrough, and opt-in real claude.
 * Faults (push failure, tampering, locks, takeover) live in
 * remote-faults-lock-takeover-loopback.e2e.test.cjs.
 */
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { createFixture } = require('./remote-loopback-e2e-fixture.cjs');
const { filesExistCommand } = require('./platform-test-fixtures.cjs');

const fx = createFixture(['alpha']);
fx.addWorker('beta');
fx.addWorker('gamma');
const PHASES = [
  { file: 'phase-01-beta.md', machine: 'beta', owns: ['src/beta/**'], name: 'Beta' },
  { file: 'phase-02-gamma.md', machine: 'gamma', owns: ['src/gamma/**'], name: 'Gamma' },
];
const settingsFile = path.join(fx.root, 'worker-settings.json');
fs.writeFileSync(settingsFile, '{}\n');

/** Dispatch both phases of `dir`, wait for the plan, return status exit code. */
function dispatchAll(dir, extra = {}) {
  for (const p of PHASES) {
    const r = fx.cli('alpha', ['dispatch', dir, p.file, ...(extra[p.machine] || [])]);
    t.eq(r.code, 0, `dispatch ${p.machine}: ${r.err}`);
  }
  return fx.cli('alpha', ['status', dir, '--wait']);
}
const review = (dir, file, slug, machine) => fx.cli('alpha', ['review', dir, file, '--sha', fx.originHead(`rig/${machine}/${slug}`), '--score', '9']);

t.test('plan flow: dispatch -> status --wait -> unreviewed refused -> review -> collect + tests -> rerun no-op', () => {
  const slug = 'flow-plan';
  const dir = fx.writePlan(slug, PHASES, { orchestrator: 'alpha' });
  fx.setMode('beta', { files: { 'src/beta/a.js': 'exports.beta = 1;\n' } });
  fx.setMode('gamma', { files: { 'src/gamma/b.js': 'exports.gamma = 2;\n' } });
  const st = dispatchAll(dir, { gamma: ['--settings', settingsFile] });
  t.eq(st.code, 0, st.out + st.err);
  t.ok(/beta: phase 0?1 agent \S+ done/.test(st.out) && /gamma: phase 0?2 agent \S+ done/.test(st.out), st.out);
  t.ok(fx.originHas(`rig/beta/${slug}`) && fx.originHas(`rig/gamma/${slug}`));
  // --settings reaches the worker's claude argv; beta (no flag) has none.
  const gArgv = fx.stubCalls('gamma')[0].argv;
  t.eq(gArgv[gArgv.indexOf('--settings') + 1], settingsFile);
  t.ok(!fx.stubCalls('beta')[0].argv.includes('--settings'));
  const early = fx.cli('alpha', ['collect', dir]);
  t.eq(early.code, 1, early.err);
  t.ok(/review/i.test(early.err), early.err);
  t.eq(review(dir, PHASES[0].file, slug, 'beta').code, 0);
  t.eq(review(dir, PHASES[1].file, slug, 'gamma').code, 0);
  t.ok(/reviewedSha: [0-9a-f]{40}/.test(fs.readFileSync(path.join(dir, PHASES[0].file), 'utf8')));
  const c = fx.cli('alpha', ['collect', dir, '--test', `beta=${filesExistCommand('src/beta/a.js', 'src/gamma/b.js')}`, '--test', `gamma=${filesExistCommand('src/gamma/b.js')}`]);
  t.eq(c.code, 0, c.out + c.err);
  t.ok(/merged=\[beta,gamma\]/.test(c.out), c.out);
  t.ok(/test beta: done exit=0/.test(c.out) && /test gamma: done exit=0/.test(c.out), c.out);
  t.ok(fx.originHas(`rig-int/${slug}`));
  const again = fx.cli('alpha', ['collect', dir]);
  t.eq(again.code, 0, again.err);
  t.ok(/merged=\[\]/.test(again.out), again.out);
});

t.test('conflict: collect exit 4 -> resolve in .rig/int-<slug> -> rerun exit 0', () => {
  const slug = 'conflict-plan';
  const both = PHASES.map((p) => ({ ...p, owns: ['shared/**'] }));
  const dir = fx.writePlan(slug, both, { orchestrator: 'alpha' });
  fx.setMode('beta', { files: { 'shared/x.txt': 'from beta\n' } });
  fx.setMode('gamma', { files: { 'shared/x.txt': 'from gamma\n' } });
  t.eq(dispatchAll(dir).code, 0);
  t.eq(review(dir, both[0].file, slug, 'beta').code, 0);
  t.eq(review(dir, both[1].file, slug, 'gamma').code, 0);
  const c = fx.cli('alpha', ['collect', dir]);
  t.eq(c.code, 4, c.out + c.err);
  const wt = path.join(fx.repoOf('alpha'), '.rig', `int-${slug}`);
  t.ok((c.out + c.err).includes(wt), `prints worktree: ${c.out}${c.err}`);
  fs.writeFileSync(path.join(wt, 'shared', 'x.txt'), 'resolved\n');
  fx.git(wt, 'add', '-A');
  fx.git(wt, 'commit', '-q', '--no-edit');
  const again = fx.cli('alpha', ['collect', dir]);
  t.eq(again.code, 0, again.out + again.err);
  t.eq(fx.git(fx.origin, 'show', `rig-int/${slug}:shared/x.txt`), 'resolved');
});

t.test('dispatch refusals: unpushed work (exit 1), uncollected dependsOn (exit 1), widened --allowed-tools (exit 2)', () => {
  const slug = 'refusal-plan';
  const phases = [PHASES[0], { ...PHASES[1], dependsOn: ['01'] }];
  const dir = fx.writePlan(slug, phases, { orchestrator: 'alpha' });
  const repo = fx.repoOf('alpha');
  fx.setMode('beta', { files: { 'src/beta/r.js': '1\n' } });
  fx.git(repo, 'commit', '-q', '--allow-empty', '-m', 'unpushed orchestrator work');
  const unpushed = fx.cli('alpha', ['dispatch', dir, PHASES[0].file]);
  t.eq(unpushed.code, 1);
  t.ok(/not pushed/.test(unpushed.err), unpushed.err);
  fx.git(repo, 'push', '-q', 'origin', 'main');
  const widened = fx.cli('alpha', ['dispatch', dir, PHASES[0].file, '--allowed-tools', 'Bash']);
  t.eq(widened.code, 2, widened.err);
  t.eq(fx.cli('alpha', ['dispatch', dir, PHASES[0].file]).code, 0);
  t.eq(fx.cli('alpha', ['status', dir, '--wait']).code, 0);
  const dep = fx.cli('alpha', ['dispatch', dir, PHASES[1].file]);
  t.eq(dep.code, 1, dep.err);
  t.ok(/collect/.test(dep.err), dep.err);
});

t.test('real claude trivial phase + resume (opt-in RIG_E2E_CLAUDE=1)', () => {
  if (process.env.RIG_E2E_CLAUDE !== '1') { console.log('  SKIP set RIG_E2E_CLAUDE=1 to run against a real claude'); return; }
  fx.addWorker('real');
  fx.useRealClaude('real');
  const slug = 'real-claude';
  const phase = { file: 'phase-01-real.md', machine: 'real', owns: ['real/**'], name: 'Real' };
  const dir = fx.writePlan(slug, [phase], { orchestrator: 'alpha' });
  t.eq(fx.cli('alpha', ['dispatch', dir, phase.file, '--max-turns', '8']).code, 0);
  t.eq(fx.cli('alpha', ['status', dir, '--wait']).code, 0);
  const msg = path.join(fx.root, 'resume.txt');
  fs.writeFileSync(msg, 'Reply with the single word ok. Do not edit files.\n');
  t.eq(fx.cli('alpha', ['dispatch', dir, phase.file, '--resume', '--message-file', msg, '--max-turns', '4']).code, 0);
  t.eq(fx.cli('alpha', ['status', dir, '--wait']).code, 0);
});

t.done().finally(() => fx.cleanup()).catch((e) => { console.error(e); process.exitCode = 1; });
