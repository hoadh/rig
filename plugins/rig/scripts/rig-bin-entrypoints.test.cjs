#!/usr/bin/env node
/** Tests for plugin bin/ entrypoints: each runs by bare name from PATH, resolves its root from its own location, and rig-python never builds a real venv. */
const { describe, it, after } = require('node:test');
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
const tmpDirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmpDirs.push(d); return d; };
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

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

  it('every bin script target exists (no dead path after a move), for string and path.join forms', () => {
    let checked = 0;
    for (const f of fs.readdirSync(BIN)) {
      const text = fs.readFileSync(path.join(BIN, f), 'utf8');
      const targets = [...text.matchAll(/'((?:scripts|skills)\/[^']+\.(?:cjs|js))'/g)].map((m) => m[1].split('/'));
      for (const m of text.matchAll(/path\.join\(kitRootOf\(__filename\)((?:,\s*'[^']+')+)\)/g)) targets.push([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
      for (const segs of targets) {
        if (segs[segs.length - 1] === 'scripts' || segs[segs.length - 1] === 'skills') continue; // directory-only join (rig-browser --dir, rig-skill-dir)
        assert.ok(fs.existsSync(path.join(ROOT, ...segs)), `${f} -> ${segs.join('/')}`);
        checked++;
      }
    }
    assert.ok(checked >= 10, `checked ${checked} targets`);
    for (const f of ['rig-browser', 'rig-classify-doc', 'rig-ui-search', 'rig-resolve-env', 'rig-skill-dir']) {
      assert.match(fs.readFileSync(path.join(BIN, f), 'utf8'), /path\.join\(/, `${f} uses path.join`);
    }
  });

  it('a child killed by a signal exits with 128+n (143 for SIGTERM), a missing command with 127', { skip: win }, () => {
    const launcher = path.join(ROOT, 'scripts', 'rig-bin-launcher.cjs');
    const sig = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(launcher)}).runAndExit('sh', ['-c', 'kill -TERM $$'])`], { encoding: 'utf8' });
    assert.strictEqual(sig.status, 143);
    const missing = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(launcher)}).runAndExit('rig-no-such-command-xyz', [])`], { encoding: 'utf8' });
    assert.strictEqual(missing.status, 127);
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

describe('scan_skills.py output location', () => {
  const py = spawnSync('python3', ['-c', 'import yaml'], { stdio: 'ignore' });
  it('writes skills_data.yaml to the cwd (or --output), never into the plugin scripts dir', { skip: win || py.status !== 0 }, () => {
    const cwd = tmp('rig-scan-');
    const tracked = path.join(ROOT, 'scripts', 'skills_data.yaml');
    const before = fs.statSync(tracked).mtimeMs;
    const res = spawnSync('python3', [path.join(ROOT, 'scripts', 'scan_skills.py')], { cwd, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(cwd, 'skills_data.yaml')));
    assert.strictEqual(fs.statSync(tracked).mtimeMs, before, 'the file inside the plugin dir was not rewritten');
  });
});

describe('rig-python venv resolution', () => {
  const kitWithReqs = (plugin = true) => {
    const kit = tmp('rig-venv-kit-');
    if (plugin) { fs.mkdirSync(path.join(kit, '.claude-plugin')); fs.writeFileSync(path.join(kit, '.claude-plugin', 'plugin.json'), '{"name":"rig","version":"2.0.0"}'); }
    fs.mkdirSync(path.join(kit, 'scripts'));
    fs.writeFileSync(path.join(kit, 'scripts', 'requirements.txt'), 'pyyaml\n');
    fs.mkdirSync(path.join(kit, 'skills', 'media', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(kit, 'skills', 'media', 'scripts', 'requirements.txt'), 'pillow\n');
    return kit;
  };
  /** Fake spawn that records every call and fakes `python -m venv <dir>` and `python -m pip ...`. */
  const fakeSpawn = ({ pipStatus = 0, onPip } = {}) => {
    const calls = [];
    const spawn = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args.includes('--version')) return { status: 0 };
      if (args[0] === '-m' && args[1] === 'venv') {
        fs.mkdirSync(path.dirname(resolver.venvPythonPath(args[2])), { recursive: true });
        fs.writeFileSync(resolver.venvPythonPath(args[2]), '');
        return { status: 0 };
      }
      if (args[1] === 'pip') { if (onPip) onPip(cmd); return { status: pipStatus }; }
      return { status: 0 };
    };
    return { spawn, calls };
  };

  it('plugin kit -> ~/.claude/rig/venv (CLAUDE_PLUGIN_DATA is never consulted); file install kit -> <root>/skills/.venv', () => {
    const plugin = kitWithReqs(true);
    const file = kitWithReqs(false);
    assert.strictEqual(resolver.venvDirFor({ kitRoot: plugin, home: '/h' }), path.join('/h', '.claude', 'rig', 'venv'));
    assert.strictEqual(resolver.venvDirFor({ kitRoot: file, home: '/h' }), path.join(file, 'skills', '.venv'));
    const saved = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = path.resolve('/some/data');
    try { assert.strictEqual(resolver.venvDirFor({ kitRoot: plugin, home: '/h' }), path.join('/h', '.claude', 'rig', 'venv')); } finally { if (saved === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = saved; }
  });

  it('picks bin/python3 on POSIX and Scripts\\python.exe on Windows', () => {
    assert.strictEqual(resolver.venvPythonPath(path.join('v'), 'linux'), path.join('v', 'bin', 'python3'));
    assert.strictEqual(resolver.venvPythonPath(path.join('v'), 'win32'), path.join('v', 'Scripts', 'python.exe'));
  });

  it('a plugin venv is ready only with a marker holding the current requirements hash (H2)', () => {
    const kit = kitWithReqs(true);
    const venv = path.join(tmp('rig-venv-ready-'), 'venv');
    fs.mkdirSync(path.dirname(resolver.venvPythonPath(venv)), { recursive: true });
    fs.writeFileSync(resolver.venvPythonPath(venv), '');
    assert.strictEqual(resolver.venvReady({ kitRoot: kit, venvDir: venv }), false, 'python alone (interrupted build) is not ready');
    fs.writeFileSync(path.join(venv, resolver.READY_MARKER), `${resolver.requirementsHash(kit)}\n`);
    assert.strictEqual(resolver.venvReady({ kitRoot: kit, venvDir: venv }), true);
    fs.appendFileSync(path.join(kit, 'scripts', 'requirements.txt'), 'requests\n');
    assert.strictEqual(resolver.venvReady({ kitRoot: kit, venvDir: venv }), false, 'a changed requirement invalidates the venv');
  });

  it('a file-install venv without a marker (built by the 1.x installer) is ready as it is', () => {
    const kit = kitWithReqs(false);
    const venv = path.join(kit, 'skills', '.venv');
    fs.mkdirSync(path.dirname(resolver.venvPythonPath(venv)), { recursive: true });
    fs.writeFileSync(resolver.venvPythonPath(venv), '');
    assert.strictEqual(resolver.venvReady({ kitRoot: kit, venvDir: venv }), true);
    fs.writeFileSync(path.join(venv, resolver.READY_MARKER), 'other-hash\n');
    assert.strictEqual(resolver.venvReady({ kitRoot: kit, venvDir: venv }), false, 'our own marker with another hash rebuilds');
  });

  it('builds only a venv plus pip installs of the requirement files: no system, npm, sudo or installer scripts (H1)', () => {
    const kit = kitWithReqs(true);
    const venv = path.join(tmp('rig-venv-new-'), 'venv');
    const { spawn, calls } = fakeSpawn();
    const written = [];
    const realWrite = process.stderr.write;
    process.stderr.write = (m) => { written.push(String(m)); return true; };
    let python;
    try { python = resolver.ensureVenvPython({ kitRoot: kit, venvDir: venv, platform: 'linux', spawn }); } finally { process.stderr.write = realWrite; }
    assert.strictEqual(python, path.join(venv, 'bin', 'python3'));
    const kinds = calls.filter((c) => !c.includes('--version')).map((c) => c.slice(1, 3).join(' '));
    assert.deepStrictEqual(kinds, ['-m venv', '-m pip', '-m pip']);
    const pips = calls.filter((c) => c[2] === 'pip');
    assert.deepStrictEqual(pips.map((c) => path.relative(kit, c[c.length - 1]).split(path.sep).join('/')), ['scripts/requirements.txt', 'skills/media/scripts/requirements.txt']);
    for (const c of calls) assert.ok(!/sudo|brew|npm|winget|apt|install\.(sh|ps1)/.test(c.join(' ').replace(/pip install/g, '')), c.join(' '));
    assert.ok(written.some((m) => m.includes(`creating Rig Python venv at ${venv}, one-time`)), written.join('|'));
    assert.strictEqual(fs.readFileSync(path.join(venv, resolver.READY_MARKER), 'utf8').trim(), resolver.requirementsHash(kit));
    assert.deepStrictEqual(fs.readdirSync(path.dirname(venv)).sort(), ['venv'], 'no temp dir or lock is left behind');
  });

  it('the marker is written last, and the venv sits in a temp dir until then (H2)', () => {
    const kit = kitWithReqs(true);
    const venv = path.join(tmp('rig-venv-order-'), 'venv');
    const seen = [];
    const { spawn } = fakeSpawn({ onPip: (python) => { seen.push({ marker: fs.existsSync(path.join(path.dirname(path.dirname(python)), resolver.READY_MARKER)), final: fs.existsSync(venv) }); } });
    resolver.ensureVenvPython({ kitRoot: kit, venvDir: venv, platform: 'linux', spawn });
    assert.ok(seen.length === 2 && seen.every((s) => !s.marker && !s.final), JSON.stringify(seen));
  });

  it('a partial venv (python without marker) is rebuilt, not trusted (H2)', () => {
    const kit = kitWithReqs(true);
    const venv = path.join(tmp('rig-venv-partial-'), 'venv');
    fs.mkdirSync(path.join(venv, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(venv, 'bin', 'python3'), '');
    fs.writeFileSync(path.join(venv, 'leftover-from-partial'), '');
    const { spawn, calls } = fakeSpawn();
    resolver.ensureVenvPython({ kitRoot: kit, venvDir: venv, platform: 'linux', spawn });
    assert.ok(calls.some((c) => c[2] === 'venv'), 'rebuilt');
    assert.ok(fs.existsSync(path.join(venv, resolver.READY_MARKER)));
    assert.ok(!fs.existsSync(path.join(venv, 'leftover-from-partial')), 'the old dir was replaced whole');
  });

  it('a failing pip leaves no venv at the final path and no temp dir, and reports the step (H2)', () => {
    const kit = kitWithReqs(true);
    const root = tmp('rig-venv-fail-');
    const venv = path.join(root, 'venv');
    const { spawn } = fakeSpawn({ pipStatus: 1 });
    assert.throws(() => resolver.ensureVenvPython({ kitRoot: kit, venvDir: venv, platform: 'linux', spawn }), /pip install -r scripts[\\/]requirements\.txt failed \(exit 1\)/);
    assert.deepStrictEqual(fs.readdirSync(root), [], 'nothing left: the next call starts clean');
  });

  it('a ready venv is used as is: no python probe, no build', () => {
    const kit = kitWithReqs(true);
    const venv = path.join(tmp('rig-venv-have-'), 'venv');
    fs.mkdirSync(path.join(venv, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(venv, 'bin', 'python3'), '');
    fs.writeFileSync(path.join(venv, resolver.READY_MARKER), `${resolver.requirementsHash(kit)}\n`);
    assert.strictEqual(resolver.ensureVenvPython({ kitRoot: kit, venvDir: venv, platform: 'linux', spawn: () => assert.fail('must not spawn') }), path.join(venv, 'bin', 'python3'));
  });

  it('a caller that cannot get the lock waits, then reports who holds it', () => {
    const kit = kitWithReqs(true);
    const root = tmp('rig-venv-lock-');
    const venv = path.join(root, 'venv');
    fs.mkdirSync(`${venv}.lock`);
    const { spawn } = fakeSpawn();
    assert.throws(() => resolver.ensureVenvPython({ kitRoot: kit, venvDir: venv, platform: 'linux', spawn, waitMs: 60, pollMs: 10 }), /another process has been building/);
  });

  it('two concurrent first calls build exactly once and both run the finished venv (H2, real processes)', { skip: win }, () => {
    const home = tmp('rig-py-home-');
    const kit = tmp('rig-py-kit-');
    for (const rel of ['bin/rig-python', 'scripts/rig-bin-launcher.cjs', 'scripts/rig-python-venv-resolver.cjs', 'hooks/lib/dir-lock-with-owner-token.cjs']) {
      fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(kit, rel));
    }
    fs.mkdirSync(path.join(kit, '.claude-plugin'));
    fs.writeFileSync(path.join(kit, '.claude-plugin', 'plugin.json'), '{"name":"rig","version":"2.0.0"}');
    fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(kit, 'scripts', 'requirements.txt'), 'pyyaml\n');
    // A fake system python3: `-m venv D` makes D/bin/python3 (an echo stub) after a pause, `-m pip` is slow and records itself
    const fakeBin = tmp('rig-py-fakebin-');
    const log = path.join(fakeBin, 'builds.log');
    fs.writeFileSync(path.join(fakeBin, 'python3'), `#!/bin/sh
if [ "$1" = "--version" ]; then echo Python 3.12.0; exit 0; fi
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  echo venv >> "${log}"; mkdir -p "$3/bin"; sleep 0.5
  printf '#!/bin/sh\\n[ "$1" = "-m" ] && [ "$2" = "pip" ] && { sleep 0.5; exit 0; }\\necho "stub-python $@"\\n' > "$3/bin/python3"; chmod +x "$3/bin/python3"; exit 0
fi
echo "unexpected $@"; exit 9
`);
    fs.chmodSync(path.join(fakeBin, 'python3'), 0o755);
    const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
    const run = () => new Promise((resolve) => {
      const c = require('child_process').spawn(process.execPath, [path.join(kit, 'bin', 'rig-python'), '-c', 'print(1)'], { env });
      let out = ''; let err = '';
      c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => resolve({ code, out, err }));
    });
    return Promise.all([run(), run()]).then((rs) => {
      for (const r of rs) { assert.strictEqual(r.code, 0, r.err); assert.strictEqual(r.out.trim(), 'stub-python -c print(1)'); }
      assert.strictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'only one build ran');
      assert.ok(fs.existsSync(path.join(home, '.claude', 'rig', 'venv', resolver.READY_MARKER)));
      assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills')), 'the 1.x venv location is untouched');
    });
  });

  it('stdlib-only bins (rig-ui-search) run on the system python while no venv exists, and build nothing', { skip: win }, () => {
    const home = tmp('rig-py-home-');
    const fakeBin = tmp('rig-py-fakebin-');
    fs.writeFileSync(path.join(fakeBin, 'python3'), '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\necho "system-python $@"\n');
    fs.chmodSync(path.join(fakeBin, 'python3'), 0o755);
    const res = spawnSync(process.execPath, [path.join(BIN, 'rig-ui-search'), 'x', '--domain', 'ux'], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` } });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /^system-python .*search\.py x --domain ux/);
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'rig')), 'no venv, lock or state was created');
  });
});
