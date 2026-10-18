'use strict';
/** Worker `prepare`: create/verify the dedicated clone and its known-good baseline. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');

process.env.RIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-bootstrap-home-'));
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const { prepareDedicatedClone } = require('../lib/worker-dedicated-clone-bootstrapper.cjs');
const { verifyKnownGoodBaseline } = require('../lib/hardened-git-config-env.cjs');
const { writeQuarantine } = require('../lib/git-control-files-integrity.cjs');

const env = makeRepoWithBareRemote({ clones: ['main', 'existing'] });
const ID = { name: 'Rig box', email: 'rig-box@example.invalid' };
const target = (name) => path.join(env.root, 'workers', name, 'app');
const prep = (repo, extra = {}) => prepareDedicatedClone({ repo, originUrl: env.origin, ...extra });
const refused = (fn, re) => { const e = t.throwsRemote(fn, { exitCode: 1, cls: 'setup-refused' }); t.ok(re.test(e.message), e.message); };

t.test('missing repo: clones origin (parents created), sets identity, records a matching baseline', () => {
  const repo = target('a');
  const r = prep(repo, { identity: ID });
  t.eq(r.action, 'cloned');
  t.ok(fs.existsSync(path.join(repo, 'README.md')));
  t.eq(env.git(repo, 'config', '--local', 'user.email'), ID.email);
  t.eq(verifyKnownGoodBaseline(repo).status, 'match');
});
t.test('rerun is a no-op; a new identity is written and re-baselined', () => {
  const repo = target('a');
  t.eq(prep(repo, { identity: ID }).action, 'unchanged');
  t.eq(prep(repo, { identity: { ...ID, name: 'Rig box 2' } }).action, 'identity-set');
  t.eq(verifyKnownGoodBaseline(repo).status, 'match');
});
t.test('empty existing directory is cloned into', () => {
  const repo = target('empty');
  fs.mkdirSync(repo, { recursive: true });
  t.eq(prep(repo).action, 'cloned');
});
t.test('existing clone without baseline: needs-accept, then baselined with acceptExisting', () => {
  const repo = env.clone('existing');
  const r = prep(repo);
  t.eq(r.action, 'needs-accept');
  t.ok(r.hint.includes('--accept-existing-clone'));
  t.eq(verifyKnownGoodBaseline(repo).status, 'missing', 'nothing recorded without consent');
  t.eq(prep(repo, { acceptExisting: true }).action, 'baselined');
  t.eq(verifyKnownGoodBaseline(repo).status, 'match');
});
t.test('baseline mismatch also needs explicit acceptance', () => {
  const repo = env.clone('existing');
  env.git(repo, 'config', '--local', 'rig.test', 'changed');
  t.eq(prep(repo).action, 'needs-accept');
  t.eq(prep(repo, { acceptExisting: true }).action, 'baselined');
});
t.test('refuses: dirty clone, other origin, non-git dir, quarantined clone', () => {
  const repo = env.clone('existing');
  fs.writeFileSync(path.join(repo, 'wip.txt'), 'x');
  refused(() => prep(repo, { acceptExisting: true }), /uncommitted/);
  fs.rmSync(path.join(repo, 'wip.txt'));
  refused(() => prepareDedicatedClone({ repo, originUrl: 'git@github.com:other/repo.git' }), /origin/);
  const plain = target('plain');
  fs.mkdirSync(plain, { recursive: true });
  fs.writeFileSync(path.join(plain, 'f'), 'x');
  refused(() => prep(plain), /not a git clone/);
  const q = target('a');
  writeQuarantine(q, 'test');
  refused(() => prep(q, { acceptExisting: true }), /quarantined/);
});
t.test('input validation: relative repo, option-like / helper origin, bad identity', () => {
  t.throwsRemote(() => prepareDedicatedClone({ repo: 'rel/app', originUrl: env.origin }), { exitCode: 2 });
  t.throwsRemote(() => prep(target('x'), { originUrl: '--upload-pack=evil' }), { exitCode: 2 });
  t.throwsRemote(() => prep(target('x'), { originUrl: 'ext::sh -c evil' }), { exitCode: 2 });
  t.throwsRemote(() => prep(target('x'), { identity: { name: 'x', email: 'no at sign' } }), { exitCode: 2 });
  t.ok(!fs.existsSync(target('x')), 'nothing created on invalid input');
});
t.test('clone failure is a refusal with an access hint and leaves nothing behind', () => {
  const e = t.throwsRemote(() => prepareDedicatedClone({ repo: target('nope'), originUrl: path.join(env.root, 'missing.git') }), { exitCode: 1 });
  t.ok(/clone/.test(e.message) && /access/.test(e.hint), `${e.message} ${e.hint}`);
  t.ok(!fs.existsSync(target('nope')), 'partial clone removed');
  const empty = target('empty-fail');
  fs.mkdirSync(empty, { recursive: true });
  t.throwsRemote(() => prepareDedicatedClone({ repo: empty, originUrl: path.join(env.root, 'missing.git') }), { exitCode: 1 });
  t.ok(fs.existsSync(empty) && fs.readdirSync(empty).length === 0, 'given empty dir kept, still empty');
});
t.test('accept refuses a clone with unpushed commits or a stash', () => {
  const repo = target('local-work');
  t.eq(prep(repo).action, 'cloned');
  env.git(repo, 'config', '--local', 'rig.test', 'x'); // baseline mismatch -> accept path
  env.git(repo, 'checkout', '-q', '-b', 'mine');
  fs.writeFileSync(path.join(repo, 'local.txt'), 'x');
  env.git(repo, 'add', 'local.txt');
  env.git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'local');
  refused(() => prep(repo, { acceptExisting: true }), /not on origin/);
  env.git(repo, 'checkout', '-q', '-');
  env.git(repo, 'branch', '-qD', 'mine');
  fs.writeFileSync(path.join(repo, 'README.md'), 'stashed');
  env.git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'stash', '-q');
  refused(() => prep(repo, { acceptExisting: true }), /stash/);
  env.git(repo, 'stash', 'drop', '-q');
  t.eq(prep(repo, { acceptExisting: true }).action, 'baselined');
});
t.test('identity is trimmed (rerun stays unchanged) and option-like values are rejected', () => {
  const repo = target('trim');
  prep(repo, { identity: { name: ' Rig trim ', email: 'rig@example.invalid' } });
  t.eq(prep(repo, { identity: { name: 'Rig trim', email: 'rig@example.invalid' } }).action, 'unchanged');
  t.throwsRemote(() => prep(repo, { identity: { name: '-x', email: 'rig@example.invalid' } }), { exitCode: 2 });
});

process.on('exit', () => { env.cleanup(); fs.rmSync(process.env.RIG_HOME, { recursive: true, force: true }); });
t.done();
