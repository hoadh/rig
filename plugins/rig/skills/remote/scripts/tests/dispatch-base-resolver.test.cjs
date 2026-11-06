'use strict';
const fs = require('fs');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const R = require('../lib/dispatch-base-resolver.cjs');

const SLUG = 'plan-a';
const base = (env, over = {}) => ({ repo: env.clone('o'), slug: SLUG, self: 'mac', machine: 'waso', planBranch: 'main', dependsOnMachines: [], ...over });
const pushBranch = (env, name, branch, file) => { // commit on a fresh branch from main in clone `name`, push as rig branch
  const c = env.clone(name);
  env.git(c, 'checkout', '-q', '-B', branch, 'main');
  const sha = env.commitFile(name, file, branch);
  env.git(c, 'push', '-q', 'origin', `${branch}:${branch}`);
  env.git(c, 'checkout', '-q', 'main');
  return sha;
};

t.test('baseSha = plan branch when no rig-int; startSha = baseSha without worker branch', () => {
  const env = makeRepoWithBareRemote({ clones: ['o'] });
  try {
    const r = R.resolveDispatchBase(base(env));
    const head = env.git(env.clone('o'), 'rev-parse', 'HEAD');
    t.eq([r.baseSha, r.startSha, r.intSha], [head, head, null]);
  } finally { env.cleanup(); }
});

t.test('unpushed orchestrator work -> exit 1 push-first (plan branch and own worker branch)', () => {
  const env = makeRepoWithBareRemote({ clones: ['o'] });
  try {
    env.commitFile('o', 'x.txt', 'local only');
    t.throwsRemote(() => R.resolveDispatchBase(base(env)), { exitCode: 1, cls: 'push-first' });
    env.git(env.clone('o'), 'push', '-q', 'origin', 'main');
    R.resolveDispatchBase(base(env)); // now fine
    env.git(env.clone('o'), 'branch', `rig/mac/${SLUG}`);
    t.throwsRemote(() => R.resolveDispatchBase(base(env)), { exitCode: 1, cls: 'push-first' }); // local-only rig/mac branch
  } finally { env.cleanup(); }
});

t.test('rig-int wins as baseSha; startSha = existing worker branch head (resume)', () => {
  const env = makeRepoWithBareRemote({ clones: ['o'] });
  try {
    const wsha = pushBranch(env, 'o', `rig/waso/${SLUG}`, 'w.txt');
    const isha = pushBranch(env, 'o', `rig-int/${SLUG}`, 'i.txt');
    const r = R.resolveDispatchBase(base(env));
    t.eq([r.baseSha, r.startSha, r.intSha], [isha, wsha, isha]);
  } finally { env.cleanup(); }
});

t.test('dependency on another machine not collected -> exit 1 collect-first; collected -> ok', () => {
  const env = makeRepoWithBareRemote({ clones: ['o'] });
  try {
    t.throwsRemote(() => R.resolveDispatchBase(base(env, { dependsOnMachines: ['linx'] })), { exitCode: 1, cls: 'collect-first' }); // no branch at all
    const dep = pushBranch(env, 'o', `rig/linx/${SLUG}`, 'dep.txt');
    t.throwsRemote(() => R.resolveDispatchBase(base(env, { dependsOnMachines: ['linx'] })), { exitCode: 1, cls: 'collect-first' }); // not in base
    // collect: rig-int = main + dep merged
    const c = env.clone('o');
    env.git(c, 'checkout', '-q', '-B', `rig-int/${SLUG}`, 'main');
    env.git(c, 'merge', '-q', '--no-ff', '-m', 'merge dep', dep);
    env.git(c, 'push', '-q', 'origin', `rig-int/${SLUG}:rig-int/${SLUG}`);
    env.git(c, 'checkout', '-q', 'main');
    const r = R.resolveDispatchBase(base(env, { dependsOnMachines: ['linx', 'waso'] })); // own machine ignored
    t.eq(r.baseSha, env.git(c, 'rev-parse', `rig-int/${SLUG}`));
  } finally { env.cleanup(); }
});

t.test('planBranchOf validates', () => {
  t.eq(R.planBranchOf({ branch: 'feat/x' }), 'feat/x');
  t.throwsRemote(() => R.planBranchOf({}), { exitCode: 2 });
  t.throwsRemote(() => R.planBranchOf({ branch: '../x' }), { exitCode: 2 });
  t.throwsRemote(() => R.planBranchOf({ branch: '-evil' }), { exitCode: 2 });
});

t.test('unreachable origin -> exit 1 (never "pushed")', () => {
  const env = makeRepoWithBareRemote({ clones: ['o'] });
  try {
    fs.rmSync(env.origin, { recursive: true, force: true });
    t.throwsRemote(() => R.resolveDispatchBase(base(env)), { exitCode: 1, cls: 'ls-remote-failed' });
  } finally { env.cleanup(); }
});

t.done();
