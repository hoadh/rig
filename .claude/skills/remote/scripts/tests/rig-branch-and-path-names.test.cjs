'use strict';
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const N = require('../lib/rig-branch-and-path-names.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');

t.test('branch names', () => {
  t.eq(N.coordBranch('my-plan'), 'rig-coord/my-plan');
  t.eq(N.workerBranch('waso', 'my-plan'), 'rig/waso/my-plan');
  t.eq(N.integrationBranch('my-plan'), 'rig-int/my-plan');
  t.eq(N.localRigDir('/r'), path.join('/r', '.rig'));
});
t.test('invalid slug / machine rejected (exit 2)', () => {
  t.throwsRemote(() => N.coordBranch('a/b'), { exitCode: 2 });
  t.throwsRemote(() => N.workerBranch('Bad', 'x'), { exitCode: 2 });
  t.throwsRemote(() => N.integrationBranch('x.lock'), { exitCode: 2 });
});
t.test('ensureRigDirExcluded appends once; git then ignores .rig/', () => {
  const env = makeRepoWithBareRemote({ clones: ['a'] });
  try {
    const dir = env.clone('a');
    t.eq(N.ensureRigDirExcluded(dir), true);
    t.eq(N.ensureRigDirExcluded(dir), false);
    const exclude = env.git(dir, 'rev-parse', '--git-path', 'info/exclude');
    const text = fs.readFileSync(path.resolve(dir, exclude), 'utf8');
    t.eq(text.split('\n').filter((l) => l === '.rig/').length, 1);
    fs.mkdirSync(path.join(dir, '.rig'));
    fs.writeFileSync(path.join(dir, '.rig', 'x'), '1');
    t.eq(env.git(dir, 'status', '--porcelain'), '');
  } finally { env.cleanup(); }
});
t.test('ensureRigDirExcluded works in a linked worktree', () => {
  const env = makeRepoWithBareRemote({ clones: ['a'] });
  try {
    const wt = path.join(env.root, 'wt');
    env.git(env.clone('a'), 'worktree', 'add', '-q', '-b', 'side', wt);
    t.eq(N.ensureRigDirExcluded(wt), true);
    fs.mkdirSync(path.join(wt, '.rig'));
    fs.writeFileSync(path.join(wt, '.rig', 'x'), '1');
    t.eq(env.git(wt, 'status', '--porcelain'), '');
  } finally { env.cleanup(); }
});

t.done();
