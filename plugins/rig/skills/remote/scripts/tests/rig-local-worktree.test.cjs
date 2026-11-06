'use strict';
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const W = require('../lib/rig-local-worktree.cjs');

const withEnv = (fn) => () => { const env = makeRepoWithBareRemote({ clones: ['a'] }); try { return fn(env, env.clone('a')); } finally { env.cleanup(); } };

t.test('orphan worktree: empty tree, own branch, .rig excluded, main untouched', withEnv((env, a) => {
  const head = env.git(a, 'rev-parse', 'HEAD');
  const { dir, created } = W.ensureLocalWorktree(a, 'coord-x', 'rig-coord/x', { orphan: true });
  t.ok(created);
  t.eq(env.git(dir, 'symbolic-ref', '--short', 'HEAD'), 'rig-coord/x');
  t.ok(!fs.existsSync(path.join(dir, 'README.md'))); // main's files must not leak into the orphan
  t.eq(env.git(dir, 'status', '--porcelain'), '');
  t.eq(env.git(a, 'status', '--porcelain'), '');
  t.eq(env.git(a, 'rev-parse', 'HEAD'), head);
  t.eq(env.git(a, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
}));

t.test('existing worktree verified; dirty or wrong branch rejected', withEnv((env, a) => {
  const { dir } = W.ensureLocalWorktree(a, 'coord-x', 'rig-coord/x', { orphan: true });
  t.eq(W.ensureLocalWorktree(a, 'coord-x', 'rig-coord/x', {}).created, false);
  t.throwsRemote(() => W.ensureLocalWorktree(a, 'coord-x', 'rig-coord/other', {}), { exitCode: 1, cls: 'worktree-mismatch' });
  fs.writeFileSync(path.join(dir, 'f'), 'x');
  t.throwsRemote(() => W.ensureLocalWorktree(a, 'coord-x', 'rig-coord/x', {}), { exitCode: 1, cls: 'worktree-dirty' });
}));

t.test('remoteRef worktree and removal', withEnv((env, a) => {
  env.git(a, 'push', '-q', 'origin', 'HEAD:refs/heads/rig-coord/y');
  env.git(a, 'fetch', '-q', 'origin', '+refs/heads/rig-coord/y:refs/remotes/origin/rig-coord/y');
  const { dir } = W.ensureLocalWorktree(a, 'coord-y', 'rig-coord/y', { remoteRef: 'refs/remotes/origin/rig-coord/y' });
  t.ok(fs.existsSync(path.join(dir, 'README.md')));
  W.removeLocalWorktree(a, 'coord-y', 'rig-coord/y');
  t.ok(!fs.existsSync(dir));
  t.eq(env.git(a, 'branch', '--list', 'rig-coord/y'), '');
}));

t.test('invalid dir name and missing mode rejected', withEnv((env, a) => {
  t.throwsRemote(() => W.ensureLocalWorktree(a, '../evil', 'b', { orphan: true }), { exitCode: 2 });
  t.throwsRemote(() => W.ensureLocalWorktree(a, 'ok', 'b', {}), { exitCode: 1 });
}));

t.test('safeMessage strips url credentials', () => {
  const m = W.safeMessage('fatal: unable to access https://user:pw@h.example/x/ and https://TOK@h.example/y');
  t.ok(!m.includes('pw') && !m.includes('TOK'), m);
});

t.done();
