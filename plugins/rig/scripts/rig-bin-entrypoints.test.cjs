#!/usr/bin/env node
/** Tests for plugin bin/ entrypoints: each runs by bare name from PATH, resolves its root from its own location, and rig-python never builds a real venv. */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const resolver = require('./rig-python-venv-resolver.cjs');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const win = process.platform === 'win32';
// A bare `rig-x` needs a PATH lookup of an extensionless file: POSIX only. On Windows Claude Code/the installer launches `node <bin>`.
const launch = (name, args, opts = {}) => (win
  ? spawnSync(process.execPath, [path.join(BIN, name), ...args], { encoding: 'utf8', ...opts })
  : spawnSync(name, args, { encoding: 'utf8', ...opts, env: { ...(opts.env || process.env), PATH: `${BIN}${path.delimiter}${(opts.env || process.env).PATH}` } }));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe('bin/ entrypoints', () => {
  it('every bin file starts with a node shebang, is executable on POSIX, and uses LF endings', () => {
    const files = fs.readdirSync(BIN);
    assert.ok(files.length >= 10, `found ${files.length} bins`);
    for (const f of files) {
      const text = fs.readFileSync(path.join(BIN, f), 'utf8');
      assert.ok(text.startsWith('#!/usr/bin/env node\n'), `${f} shebang`);
      assert.ok(!text.includes('\r'), `${f} has CR`);
      if (!win) assert.ok(fs.statSync(path.join(BIN, f)).mode & 0o100, `${f} executable`);
    }
  });

  it('every bin script target exists (no dead path after a move)', () => {
    for (const f of fs.readdirSync(BIN)) {
      const text = fs.readFileSync(path.join(BIN, f), 'utf8');
      for (const m of text.matchAll(/'((?:scripts|skills)\/[^']+\.(?:cjs|js))'/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${f} -> ${m[1]}`);
    }
  });

  it('rig-set-active-plan runs by name and reports usage with --help', () => {
    const res = launch('rig-set-active-plan', ['--help'], { cwd: os.tmpdir() });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /Usage: rig-set-active-plan <plan-path>/);
  });

  it('rig-set-active-plan with no argument exits 1 (status is propagated)', () => {
    const res = launch('rig-set-active-plan', [], { cwd: os.tmpdir(), env: { ...process.env, RIG_SESSION_ID: '' } });
    assert.strictEqual(res.status, 1);
  });

  it('rig-worktree info --json runs from a git dir and prints JSON', () => {
    const dir = tmp('rig-bin-wt-');
    spawnSync('git', ['init', '-q', dir]);
    const res = launch('rig-worktree', ['info', '--json'], { cwd: dir });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.doesNotThrow(() => JSON.parse(res.stdout), res.stdout);
  });

  it('rig-browser --dir prints the browser scripts dir and rejects unknown scripts', () => {
    const ok = launch('rig-browser', ['--dir']);
    assert.strictEqual(ok.stdout.trim(), path.join(ROOT, 'skills', 'browser', 'scripts'));
    for (const bad of ['../evil', 'nope']) assert.strictEqual(launch('rig-browser', [bad]).status, 2, bad);
  });

  it('works through a symlink: the root comes from the real path, not the link', { skip: win }, () => {
    const dir = tmp('rig-bin-link-');
    fs.symlinkSync(path.join(BIN, 'rig-browser'), path.join(dir, 'rig-browser'));
    const res = spawnSync(path.join(dir, 'rig-browser'), ['--dir'], { encoding: 'utf8' });
    assert.strictEqual(res.stdout.trim(), path.join(ROOT, 'skills', 'browser', 'scripts'));
  });
});

describe('rig-python venv resolution', () => {
  it('uses CLAUDE_PLUGIN_DATA/venv when absolute, else ~/.claude/rig/venv', () => {
    assert.strictEqual(resolver.venvDirFor({ env: { CLAUDE_PLUGIN_DATA: path.resolve('/d') }, home: '/h' }), path.join(path.resolve('/d'), 'venv'));
    assert.strictEqual(resolver.venvDirFor({ env: {}, home: '/h' }), path.join('/h', '.claude', 'rig', 'venv'));
    assert.strictEqual(resolver.venvDirFor({ env: { CLAUDE_PLUGIN_DATA: 'relative' }, home: '/h' }), path.join('/h', '.claude', 'rig', 'venv'));
  });

  it('picks bin/python3 on POSIX and Scripts\\python.exe on Windows', () => {
    assert.strictEqual(resolver.venvPythonPath(path.join('v'), 'linux'), path.join('v', 'bin', 'python3'));
    assert.strictEqual(resolver.venvPythonPath(path.join('v'), 'win32'), path.join('v', 'Scripts', 'python.exe'));
  });

  it('uses install.sh on POSIX and install.ps1 on Windows', () => {
    assert.deepStrictEqual(resolver.installerCommand('s', 'darwin'), ['bash', [path.join('s', 'install.sh'), '-y']]);
    const [cmd, args] = resolver.installerCommand('s', 'win32');
    assert.strictEqual(cmd, 'powershell');
    assert.ok(args.includes(path.join('s', 'install.ps1')) && args.includes('-Y'));
  });

  it('an existing venv python is used as is: the installer is not run', () => {
    const venv = tmp('rig-venv-have-');
    fs.mkdirSync(path.join(venv, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(venv, 'bin', 'python3'), '');
    const spawn = () => assert.fail('installer must not run');
    assert.strictEqual(resolver.ensureVenvPython({ kitRoot: ROOT, venvDir: venv, platform: 'linux', spawn }), path.join(venv, 'bin', 'python3'));
  });

  it('a missing venv runs the installer once with RIG_VENV_DIR set, then returns the new python', () => {
    const venv = path.join(tmp('rig-venv-new-'), 'venv');
    const calls = [];
    const spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env });
      fs.mkdirSync(path.join(venv, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(venv, 'bin', 'python3'), '');
      return { status: 0 };
    };
    const python = resolver.ensureVenvPython({ kitRoot: ROOT, venvDir: venv, platform: 'linux', spawn });
    assert.strictEqual(python, path.join(venv, 'bin', 'python3'));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].env.RIG_VENV_DIR, venv);
    assert.strictEqual(calls[0].args[0], path.join(ROOT, 'skills', 'install.sh'));
  });

  it('an installer that leaves no python fails with a clear error', () => {
    const venv = path.join(tmp('rig-venv-bad-'), 'venv');
    assert.throws(() => resolver.ensureVenvPython({ kitRoot: ROOT, venvDir: venv, platform: 'linux', spawn: () => ({ status: 3 }) }), /exit 3.*does not exist/);
  });

  it('bin/rig-python end to end with a temp HOME and a stub installer (no real venv is built)', { skip: win }, () => {
    const home = tmp('rig-py-home-');
    const kit = tmp('rig-py-kit-');
    for (const rel of ['bin/rig-python', 'scripts/rig-bin-launcher.cjs', 'scripts/rig-python-venv-resolver.cjs']) {
      fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(kit, rel));
    }
    fs.chmodSync(path.join(kit, 'bin', 'rig-python'), 0o755);
    fs.mkdirSync(path.join(kit, 'skills'));
    // Stub installer: makes a venv whose python3 echoes its argv; records that it ran.
    fs.writeFileSync(path.join(kit, 'skills', 'install.sh'),
      '#!/bin/bash\nmkdir -p "$RIG_VENV_DIR/bin"\nprintf \'#!/bin/sh\\necho "stub-python $@"\\n\' > "$RIG_VENV_DIR/bin/python3"\nchmod +x "$RIG_VENV_DIR/bin/python3"\necho ran >> "$RIG_VENV_DIR/../installer-ran"\n');
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_PLUGIN_DATA;
    const first = spawnSync(process.execPath, [path.join(kit, 'bin', 'rig-python'), '-c', 'print(1)'], { encoding: 'utf8', env });
    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(first.stdout.trim(), 'stub-python -c print(1)');
    assert.match(first.stderr, /creating it/);
    const second = spawnSync(process.execPath, [path.join(kit, 'bin', 'rig-python'), '--version'], { encoding: 'utf8', env });
    assert.strictEqual(second.stdout.trim(), 'stub-python --version');
    assert.strictEqual(fs.readFileSync(path.join(home, '.claude', 'rig', 'installer-ran'), 'utf8').trim().split('\n').length, 1, 'installer ran once');
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills')), 'the 1.x venv location is untouched');
  });
});
