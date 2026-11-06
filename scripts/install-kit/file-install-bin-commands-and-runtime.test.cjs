#!/usr/bin/env node
/**
 * File installs keep working after kit text moved to `rig-<name>` bin commands: the installer copies bin/,
 * rewrites the commands to `node .claude/bin/rig-<name>` (project) or `node $HOME/.claude/bin/...` (global),
 * and a global install also writes the runtime copy (remote worker) into the target home.
 * Run: node --test scripts/install-kit/file-install-bin-commands-and-runtime.test.cjs
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { rewriteBinCommandsForFileInstall } = require('./kit-path-rewrite-for-install-mode.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const INSTALLER = path.join(REPO, 'scripts', 'install-kit-from-local-repo.cjs');
const tmpDirs = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); tmpDirs.push(d); return d; };
const win = process.platform === 'win32';

describe('rewriteBinCommandsForFileInstall', () => {
  const names = ['rig-worktree', 'rig-remote', 'rig-set-active-plan'];
  const run = (text) => rewriteBinCommandsForFileInstall(text, names).content;

  it('rewrites a bare command, also inside $( ) and backticks', () => {
    assert.strictEqual(run('`rig-worktree info --json`'), '`node .claude/bin/rig-worktree info --json`');
    assert.strictEqual(run('D="$(rig-remote --dir)"'), 'D="$(node .claude/bin/rig-remote --dir)"');
    assert.strictEqual(run('rig-set-active-plan {plan-dir}'), 'node .claude/bin/rig-set-active-plan {plan-dir}');
  });

  it('leaves longer tokens, paths, file names and already-prefixed commands alone', () => {
    for (const keep of ['bin/rig-remote', '~/.claude/bin/rig-remote', 'rig-remote.cjs', 'my-rig-remote', 'rig-remote-x', 'node .claude/bin/rig-remote', 'rig-other']) {
      assert.strictEqual(run(keep), keep, keep);
    }
  });

  it('is a no-op without bin names', () => {
    assert.deepStrictEqual(rewriteBinCommandsForFileInstall('rig-remote', []), { content: 'rig-remote', changes: 0 });
  });
});

describe('project file install', () => {
  const project = tmp('rig-bin-install-');
  const res = spawnSync(process.execPath, [INSTALLER, '--dir', project, '--yes'], { encoding: 'utf8' });
  const claude = path.join(project, '.claude');

  it('installs bin/ (executable) and rewrites kit text to node .claude/bin/...', () => {
    assert.strictEqual(res.status, 0, res.stderr + res.stdout);
    assert.ok(fs.existsSync(path.join(claude, 'bin', 'rig-worktree')));
    if (!win) assert.ok(fs.statSync(path.join(claude, 'bin', 'rig-worktree')).mode & 0o100, 'executable bit kept');
    const skill = fs.readFileSync(path.join(claude, 'skills', 'worktree', 'SKILL.md'), 'utf8');
    assert.match(skill, /node \.claude\/bin\/rig-worktree info --json/);
    assert.doesNotMatch(skill, /(?<![\w./-])(?<!node \.claude\/bin\/)rig-worktree (info|create)/);
    const plan = fs.readFileSync(path.join(claude, 'skills', 'plan', 'SKILL.md'), 'utf8');
    assert.match(plan, /node \.claude\/bin\/rig-set-active-plan \{plan-dir\}/);
  });

  it('an installed bin runs from the install dir (root resolved from its own location)', () => {
    const git = tmp('rig-bin-install-git-');
    spawnSync('git', ['init', '-q', git]);
    const out = spawnSync(process.execPath, [path.join(claude, 'bin', 'rig-worktree'), 'info', '--json'], { cwd: git, encoding: 'utf8' });
    assert.strictEqual(out.status, 0, out.stderr);
    assert.doesNotThrow(() => JSON.parse(out.stdout));
  });

  it('a project install does not write a runtime copy', () => {
    assert.ok(!fs.existsSync(path.join(claude, 'rig')));
  });
});

describe('global file install (temp HOME)', () => {
  const home = tmp('rig-bin-global-home-');
  const res = spawnSync(process.execPath, [INSTALLER, '--global', '--yes'], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });

  it('rewrites to node $HOME/.claude/bin/... and writes the runtime copy next to it', () => {
    assert.strictEqual(res.status, 0, res.stderr + res.stdout);
    const skill = fs.readFileSync(path.join(home, '.claude', 'skills', 'worktree', 'SKILL.md'), 'utf8');
    assert.match(skill, /node \$HOME\/\.claude\/bin\/rig-worktree info --json/);
    const runtime = path.join(home, '.claude', 'rig', 'runtime');
    assert.ok(fs.existsSync(path.join(runtime, 'VERSION')), 'VERSION written');
    assert.ok(fs.existsSync(path.join(runtime, 'remote', 'worker.cjs')));
    assert.match(res.stdout, /Runtime copy .*copied/);
  });

  it('--dry-run writes no runtime copy', () => {
    const h = tmp('rig-bin-global-dry-');
    const dry = spawnSync(process.execPath, [INSTALLER, '--global', '--yes', '--dry-run'], { encoding: 'utf8', env: { ...process.env, HOME: h, USERPROFILE: h } });
    assert.strictEqual(dry.status, 0, dry.stderr);
    assert.ok(!fs.existsSync(path.join(h, '.claude', 'rig')));
  });
});
