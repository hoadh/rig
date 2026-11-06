'use strict';
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const I = require('../lib/git-control-files-integrity.cjs');

function withRepo(fn) {
  const env = makeRepoWithBareRemote({ clones: ['w'] });
  try { return fn(env, env.clone('w')); } finally { env.cleanup(); }
}

t.test('hash is stable; commits and new objects do not change it', () => withRepo((env, repo) => {
  const h = I.hashGitControlFiles(repo);
  t.eq(I.hashGitControlFiles(repo), h);
  env.commitFile('w', 'a.txt', 'x');
  t.eq(I.hashGitControlFiles(repo), h);
}));

t.test('config change (e.g. aliases / core.sshCommand) changes the hash', () => withRepo((env, repo) => {
  const h = I.hashGitControlFiles(repo);
  env.git(repo, 'config', 'core.sshCommand', 'evil');
  t.ok(I.hashGitControlFiles(repo) !== h);
}));

t.test('new or edited hook changes the hash; info/exclude too', () => withRepo((env, repo) => {
  const gitDir = env.git(repo, 'rev-parse', '--absolute-git-dir');
  const h0 = I.hashGitControlFiles(repo);
  fs.writeFileSync(path.join(gitDir, 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const h1 = I.hashGitControlFiles(repo);
  t.ok(h1 !== h0);
  fs.writeFileSync(path.join(gitDir, 'hooks', 'pre-push'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const h2 = I.hashGitControlFiles(repo);
  t.ok(h2 !== h1);
  fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  fs.appendFileSync(path.join(gitDir, 'info', 'exclude'), 'x\n');
  t.ok(I.hashGitControlFiles(repo) !== h2);
}));

t.test('quarantine marker round trip', () => withRepo((env, repo) => {
  t.eq(I.isQuarantined(repo), false);
  I.writeQuarantine(repo, 'tamper');
  t.eq(I.isQuarantined(repo), true);
  t.ok(fs.readFileSync(I.quarantinePath(repo), 'utf8').includes('tamper'));
}));

t.done();
