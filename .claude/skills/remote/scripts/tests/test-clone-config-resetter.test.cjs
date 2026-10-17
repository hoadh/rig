'use strict';
/** L6 resetter: keeps layout keys + allowlisted [extensions] (M1, real sha256 git), drops overrides, refuses symlinks. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const R = require('../lib/test-clone-config-resetter.cjs');

const GENV = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull };
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: GENV }).trim();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-resetter-')));
const GD = '.' + 'git';

t.test('keptLayoutLines: allowlisted core + extensions keys only, case-insensitive, no subsections', () => {
  const k = R.keptLayoutLines('[Core]\n\trepositoryFormatVersion = 1\n\tsshCommand = evil\n[EXTENSIONS]\n\tObjectFormat = sha256\n\tevil = 1\n\tworktreeConfig = true\n[extensions "x"]\n\trefstorage = reftable\n[remote "origin"]\n\turl = x\n');
  t.eq(k.core, ['\trepositoryFormatVersion = 1']);
  t.eq(k.extensions, ['\tObjectFormat = sha256', '\tworktreeConfig = true']);
});

t.test('M1: sha256 origin test clone survives the reset (rev-parse + fetch work); overrides are dropped', () => {
  const root = tmp();
  try {
    try { execFileSync('git', ['init', '-q', '--bare', '--object-format=sha256', path.join(root, 'o.git')], { env: GENV, stdio: 'pipe' }); } catch { console.log('       SKIP: git lacks sha256 support'); return; }
    const seed = path.join(root, 'seed');
    execFileSync('git', ['init', '-q', '--object-format=sha256', '--initial-branch=main', seed], { env: GENV });
    fs.writeFileSync(path.join(seed, 'a'), 'x');
    git(seed, 'add', '-A');
    git(seed, '-c', 'user.name=t', '-c', 'user.email=t@e.invalid', 'commit', '-q', '-m', 'i');
    git(seed, 'push', '-q', path.join(root, 'o.git'), 'main');
    const wt = path.join(root, 'wt');
    execFileSync('git', ['clone', '-q', '--no-checkout', path.join(root, 'o.git'), wt], { env: GENV });
    git(wt, 'config', 'url.evil.insteadOf', 'x');
    git(wt, 'config', 'core.sshCommand', 'evil');
    fs.writeFileSync(path.join(wt, GD, 'config.worktree'), '[core]\n\thooksPath = /tmp/x\n');
    R.resetTestCloneConfig(wt, path.join(root, 'o.git'));
    const cfg = fs.readFileSync(path.join(wt, GD, 'config'), 'utf8');
    t.ok(/objectformat = sha256/i.test(cfg) && /repositoryformatversion = 1/.test(cfg), cfg);
    t.ok(!/insteadOf|sshCommand/i.test(cfg));
    t.ok(!fs.existsSync(path.join(wt, GD, 'config.worktree')));
    t.eq(git(wt, 'rev-parse', '--show-object-format'), 'sha256');
    git(wt, 'fetch', '-q', 'origin');
    t.ok(/^[0-9a-f]{64}$/.test(git(wt, 'rev-parse', 'origin/main')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

t.test('sha1 clone gets no [extensions] section', () => {
  const root = tmp();
  try {
    const wt = path.join(root, 'wt');
    execFileSync('git', ['init', '-q', wt], { env: GENV });
    R.resetTestCloneConfig(wt, 'file:///x');
    t.ok(!/extensions/.test(fs.readFileSync(path.join(wt, GD, 'config'), 'utf8')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

t.test('symlinked config, config.worktree or git dir entry is refused (RunFailure prepare), target untouched', () => {
  const root = tmp();
  try {
    const victim = path.join(root, 'victim'); fs.writeFileSync(victim, 'keep');
    const wt = path.join(root, 'wt');
    execFileSync('git', ['init', '-q', wt], { env: GENV });
    fs.rmSync(path.join(wt, GD, 'config')); fs.symlinkSync(victim, path.join(wt, GD, 'config'));
    const e = t.throwsRemote(() => R.resetTestCloneConfig(wt, 'file:///x'), {});
    t.eq([e.name, e.failure], ['RunFailure', 'prepare']);
    t.eq(fs.readFileSync(victim, 'utf8'), 'keep');
    fs.rmSync(path.join(wt, GD, 'config')); fs.writeFileSync(path.join(wt, GD, 'config'), '[core]\n');
    fs.symlinkSync(victim, path.join(wt, GD, 'config.worktree'));
    t.eq(t.throwsRemote(() => R.resetTestCloneConfig(wt, 'file:///x'), {}).failure, 'prepare');
    fs.rmSync(path.join(wt, GD, 'config.worktree'));
    const real = path.join(root, 'realgit'); fs.renameSync(path.join(wt, GD), real); fs.symlinkSync(real, path.join(wt, GD));
    t.eq(t.throwsRemote(() => R.resetTestCloneConfig(wt, 'file:///x'), {}).failure, 'prepare');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

t.done();
