#!/usr/bin/env node
/**
 * Runtime copy (~/.claude/rig/runtime): complete copy, version-driven refresh, VERSION written last,
 * fail-closed readers, symlink containment, and the session-init hook-up. Every test uses a temp HOME.
 * Run: node --test plugins/rig/hooks/lib/__tests__/runtime-copy-to-user-dir.test.cjs
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const rc = require('../runtime-copy-to-user-dir.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const tmpRoots = [];
after(() => tmpRoots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmpRoots.push(d); return d; };
const symlinkOk = (() => { try { const d = mkTmp('rig-sl-'); fs.symlinkSync(d, path.join(d, 'l'), 'dir'); return true; } catch { return false; } })();

/** A minimal plugin root with every listed entry (dirs get one file) and a plugin.json. */
function fakePlugin(version) {
  const root = mkTmp('rig-fake-plugin-');
  for (const [srcRel] of rc.RUNTIME_ENTRIES) {
    const p = path.join(root, ...srcRel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (/\.cjs$/.test(srcRel)) fs.writeFileSync(p, `// ${srcRel} v${version}\n`);
    else { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'a.cjs'), `// ${srcRel}/a v${version}\n`); }
  }
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'rig', version }));
  return root;
}

describe('runtime copy list', () => {
  const closure = (entry, seen = new Set()) => {
    const file = path.resolve(entry);
    if (seen.has(file)) return seen;
    seen.add(file);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const base = path.resolve(path.dirname(file), m[1]);
      const hit = [base, `${base}.cjs`, `${base}.js`, `${base}.json`].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (hit) closure(hit, seen);
    }
    return seen;
  };
  const listed = () => new Set(rc.RUNTIME_ENTRIES.map(([s]) => path.join(PLUGIN_ROOT, ...s.split('/'))));
  const covered = (file) => [...listed()].some((e) => file === e || file.startsWith(e + path.sep));

  it('covers every file statusline.cjs and the remote worker require (a new dependency must be added to the list)', () => {
    const missing = [];
    for (const entry of ['statusline.cjs', 'skills/remote/scripts/worker.cjs', 'skills/remote/scripts/worker-run-entry.cjs']) {
      for (const f of closure(path.join(PLUGIN_ROOT, entry))) if (!covered(f)) missing.push(path.relative(PLUGIN_ROOT, f));
    }
    for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'skills/remote/scripts/worker-commands'))) {
      for (const dep of closure(path.join(PLUGIN_ROOT, 'skills/remote/scripts/worker-commands', f))) if (!covered(dep)) missing.push(path.relative(PLUGIN_ROOT, dep));
    }
    assert.deepStrictEqual([...new Set(missing)], []);
  });
});

describe('copyRuntime', () => {
  it('copies the real plugin files, stamps VERSION from plugin.json, and a second call is a no-op', () => {
    const home = mkTmp('rig-home-');
    const first = rc.copyRuntime({ pluginRoot: PLUGIN_ROOT, home });
    const version = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    assert.strictEqual(first.status, 'copied');
    assert.strictEqual(first.dir, path.join(home, '.claude', 'rig', 'runtime'));
    assert.strictEqual(rc.readRuntimeVersion(first.dir), version);
    for (const rel of ['statusline.cjs', 'hooks/lib/colors.cjs', 'remote/worker.cjs', 'remote/worker-commands/info-command.cjs', 'remote/lib/rig-json-nonce-framing.cjs']) {
      assert.ok(fs.existsSync(path.join(first.dir, rel)), rel);
    }
    assert.strictEqual(rc.copyRuntime({ pluginRoot: PLUGIN_ROOT, home }).status, 'current');
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'rig', 'runtime.lock')), 'lock released');
  });

  it('a version change recopies, replaces file contents and drops files the new version no longer has', () => {
    const home = mkTmp('rig-home-');
    const v1 = fakePlugin('2.0.0');
    rc.copyRuntime({ pluginRoot: v1, home });
    const dir = rc.runtimeDirFor(home);
    fs.writeFileSync(path.join(dir, 'remote', 'worker-commands', 'stale-old-command.cjs'), '// from an older version\n');
    const v2 = fakePlugin('2.1.0');
    assert.strictEqual(rc.copyRuntime({ pluginRoot: v2, home }).status, 'copied');
    assert.strictEqual(rc.readRuntimeVersion(dir), '2.1.0');
    assert.match(fs.readFileSync(path.join(dir, 'remote', 'worker.cjs'), 'utf8'), /v2\.1\.0/);
    assert.ok(!fs.existsSync(path.join(dir, 'remote', 'worker-commands', 'stale-old-command.cjs')), 'a stale command file must not be loaded by the worker');
  });

  it('an interrupted copy leaves no VERSION (readers fail closed) and the next call repairs it', () => {
    const home = mkTmp('rig-home-');
    const root = fakePlugin('2.0.0');
    rc.copyRuntime({ pluginRoot: root, home });
    const dir = rc.runtimeDirFor(home);
    // Crash mid-copy: VERSION is gone and a managed file is missing
    fs.rmSync(path.join(dir, 'VERSION'));
    fs.rmSync(path.join(dir, 'remote', 'lib'), { recursive: true });
    assert.strictEqual(rc.readRuntimeVersion(dir), null);
    assert.strictEqual(rc.copyRuntime({ pluginRoot: root, home }).status, 'copied');
    assert.strictEqual(rc.readRuntimeVersion(dir), '2.0.0');
    // VERSION present but a file missing is also repaired (the stamp alone does not prove completeness)
    fs.rmSync(path.join(dir, 'remote', 'lib'), { recursive: true });
    assert.strictEqual(rc.copyRuntime({ pluginRoot: root, home }).status, 'copied');
  });

  it('a refused source symlink aborts before touching the existing copy', { skip: !symlinkOk }, () => {
    const home = mkTmp('rig-home-');
    const root = fakePlugin('2.0.0');
    rc.copyRuntime({ pluginRoot: root, home });
    const outside = mkTmp('rig-outside-');
    fs.writeFileSync(path.join(outside, 'x.cjs'), 'x');
    fs.rmSync(path.join(root, 'statusline.cjs'));
    fs.symlinkSync(path.join(outside, 'x.cjs'), path.join(root, 'statusline.cjs'));
    fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'rig', version: '2.0.1' }));
    assert.throws(() => rc.copyRuntime({ pluginRoot: root, home }), /symlink/);
    assert.strictEqual(rc.readRuntimeVersion(rc.runtimeDirFor(home)), '2.0.0', 'refused before touching the existing copy');
  });

  it('refuses a symlinked source directory that points outside the plugin root', { skip: !symlinkOk }, () => {
    const home = mkTmp('rig-home-');
    const root = fakePlugin('2.0.0');
    const outside = mkTmp('rig-outside-');
    fs.rmSync(path.join(root, 'skills', 'remote', 'scripts', 'lib'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'skills', 'remote', 'scripts', 'lib'), 'dir');
    assert.throws(() => rc.copyRuntime({ pluginRoot: root, home }), /symlink/);
    assert.strictEqual(rc.readRuntimeVersion(rc.runtimeDirFor(home)), null);
  });

  it('refuses a runtime dir that is a symlink to somewhere outside ~/.claude/rig', { skip: !symlinkOk }, () => {
    const home = mkTmp('rig-home-');
    const outside = mkTmp('rig-outside-');
    fs.mkdirSync(path.join(home, '.claude', 'rig'), { recursive: true });
    fs.symlinkSync(outside, path.join(home, '.claude', 'rig', 'runtime'), 'dir');
    assert.throws(() => rc.copyRuntime({ pluginRoot: fakePlugin('2.0.0'), home }), /resolves outside/);
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'nothing written outside');
  });

  it('a managed destination that is a symlink is replaced, never followed', { skip: !symlinkOk }, () => {
    const home = mkTmp('rig-home-');
    const outside = mkTmp('rig-outside-');
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'precious');
    const dir = rc.runtimeDirFor(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(outside, path.join(dir, 'remote'), 'dir');
    rc.copyRuntime({ pluginRoot: fakePlugin('2.0.0'), home });
    assert.deepStrictEqual(fs.readdirSync(outside), ['keep.txt'], 'the link target is untouched');
    assert.ok(!fs.lstatSync(path.join(dir, 'remote')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(dir, 'remote', 'worker.cjs')));
  });

  it('returns busy when another copy holds a fresh lock, and takes over a stale lock', () => {
    const home = mkTmp('rig-home-');
    const root = fakePlugin('2.0.0');
    const lock = path.join(home, '.claude', 'rig', 'runtime.lock');
    fs.mkdirSync(lock, { recursive: true });
    assert.strictEqual(rc.copyRuntime({ pluginRoot: root, home }).status, 'busy');
    assert.strictEqual(rc.readRuntimeVersion(rc.runtimeDirFor(home)), null);
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    assert.strictEqual(rc.copyRuntime({ pluginRoot: root, home }).status, 'copied');
  });

  it('rejects a plugin.json without a valid version', () => {
    const root = fakePlugin('2.0.0');
    fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'rig', version: '../../x' }));
    assert.throws(() => rc.copyRuntime({ pluginRoot: root, home: mkTmp('rig-home-') }), /valid version/);
  });
});

describe('readers fail closed', () => {
  const runStatusline = (dir) => spawnSync(process.execPath, [path.join(dir, 'statusline.cjs')], {
    input: JSON.stringify({ model: { display_name: 'M' }, cwd: os.tmpdir(), workspace: { current_dir: os.tmpdir() } }), encoding: 'utf8',
  });

  it('the copied statusline prints nothing without VERSION and renders with it', () => {
    const home = mkTmp('rig-home-');
    const { dir } = rc.copyRuntime({ pluginRoot: PLUGIN_ROOT, home });
    assert.ok(runStatusline(dir).stdout.length > 0, 'renders with VERSION');
    fs.rmSync(path.join(dir, 'VERSION'));
    const res = runStatusline(dir);
    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.stdout, '');
  });
});

describe('session-init hook-up', () => {
  const run = (root, home) => spawnSync(process.execPath, [path.join(root, 'hooks', 'session-init.cjs')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: `rt-${Date.now()}` }),
    cwd: mkTmp('rig-proj-'), encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_ENV_FILE: '', CLAUDE_PLUGIN_DATA: mkTmp('rig-data-') },
  });

  it('plugin mode copies the runtime into the (temp) HOME', () => {
    const home = mkTmp('rig-home-');
    assert.strictEqual(run(PLUGIN_ROOT, home).status, 0);
    assert.ok(rc.readRuntimeVersion(rc.runtimeDirFor(home)), 'VERSION written');
  });

  it('a file install (no plugin manifest next to hooks) does not write a runtime copy', () => {
    const home = mkTmp('rig-home-');
    const root = path.join(mkTmp('rig-fileinstall-'), '.claude');
    fs.cpSync(path.join(PLUGIN_ROOT, 'hooks'), path.join(root, 'hooks'), { recursive: true, filter: (s) => !/[\\/](__tests__|\.logs)$/.test(s) });
    assert.strictEqual(run(root, home).status, 0);
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'rig')));
  });

  it('a copy failure does not block the session (hook still exits 0)', () => {
    const home = mkTmp('rig-home-');
    const root = path.join(mkTmp('rig-partial-'), 'rig'); // hooks + manifest but no skills/: the source list cannot be read
    fs.cpSync(path.join(PLUGIN_ROOT, 'hooks'), path.join(root, 'hooks'), { recursive: true, filter: (s) => !/[\\/](__tests__|\.logs)$/.test(s) });
    fs.cpSync(path.join(PLUGIN_ROOT, '.claude-plugin'), path.join(root, '.claude-plugin'), { recursive: true });
    const res = run(root, home);
    assert.strictEqual(res.status, 0);
    assert.strictEqual(rc.readRuntimeVersion(rc.runtimeDirFor(home)), null);
  });
});
