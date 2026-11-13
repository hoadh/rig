'use strict';
/**
 * `rig-remote upgrade` end to end on the local transport: a worker whose runtime copy is an older Rig (VERSION 2.0.0,
 * one script changed) and a stub `claude` that reports the older plugin until `plugin update` ran. The real CLI runs
 * every step; the refresh runs the checkout's refresh-runtime-copy.cjs against the temp HOME. Proves: --check writes
 * nothing, the upgrade stamps the runtime with the checkout version, the scripts hash matches, settings.json is untouched.
 */
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeFakeExecutable } = require('./fake-executable-for-tests.cjs');
const { hostOs, hostShell } = require('./platform-test-fixtures.cjs');
const { copyRuntime, runtimeDirFor } = require('../../../../hooks/lib/runtime-copy-to-user-dir.cjs');
const { scriptsIntegrityHash } = require('../lib/skill-scripts-integrity-hash.cjs');

const REMOTE_CJS = path.join(__dirname, '..', 'remote.cjs');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
// Own throwaway HOME, never the inherited one (the harness keeps the real HOME when RIG_E2E_* / RIG_TEST_REAL_HOME are set,
// and this test writes ~/.claude/settings.json and the runtime copy). Every child gets it explicitly.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-upgrade-e2e-'));
const HOME = path.join(root, 'home');
fs.mkdirSync(HOME);
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

// older runtime: a real copy stamped 2.0.0 whose scripts differ from this checkout
const runtime = runtimeDirFor(HOME);
copyRuntime({ pluginRoot: PLUGIN_ROOT, home: HOME });
fs.writeFileSync(path.join(runtime, 'VERSION'), '2.0.0\n');
fs.appendFileSync(path.join(runtime, 'remote', 'worker-run-entry.cjs'), '\n// older release\n');
const settings = path.join(HOME, '.claude', 'settings.json');
fs.writeFileSync(settings, '{"statusLine":{"type":"command","command":"keep-me"}}\n');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const settingsBefore = sha(settings);

const stubDir = path.join(root, 'stub');
fs.mkdirSync(stubDir);
const stateFile = path.join(stubDir, 'state.json');
fs.writeFileSync(stateFile, JSON.stringify({ version: '2.0.0' }));
const claude = makeFakeExecutable(stubDir, 'claude', `
const fs = require('fs');
const a = process.argv.slice(2);
const state = () => JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const entry = () => ({ id: 'rig@rig-marketplace', version: state().version, scope: 'user', enabled: true, installPath: ${JSON.stringify(PLUGIN_ROOT)} });
if (a[0] === '--version') console.log('2.1.323 (Claude Code)');
else if (a[0] === 'plugin' && a[1] === 'list') {
  const installed = [entry()];
  console.log(JSON.stringify(a.includes('--available') ? { installed, available: [{ pluginId: 'rig@rig-marketplace', version: ${JSON.stringify(VERSION)} }] } : installed));
} else if (a[1] === 'marketplace') console.log('refreshed');
else if (a[1] === 'update') { fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({ version: ${JSON.stringify(VERSION)} })); console.log(JSON.stringify({ success: true })); }
else process.exit(9);
`);
const registryFile = path.join(root, 'rig-machines.json');
fs.writeFileSync(registryFile, JSON.stringify({ machines: {
  w1: { ssh: 'rig@loopback', os: hostOs(), shell: hostShell(), repo: path.join(root, 'repo'), pathPrepend: [], node: process.execPath, claude },
} }));
const cli = (args) => cp.spawnSync(process.execPath, [REMOTE_CJS, 'upgrade', ...args], {
  encoding: 'utf8', timeout: 120000,
  env: { ...process.env, HOME, USERPROFILE: HOME, RIG_MACHINE: 'orch', RIG_REMOTE_TRANSPORT: 'local', RIG_MACHINES_FILE: registryFile, RIG_REMOTE_WORKER_PATH: '' },
});
const runtimeVersion = () => fs.readFileSync(path.join(runtime, 'VERSION'), 'utf8').trim();

t.test('--check reports would-upgrade and changes nothing', () => {
  const r = cli(['w1', '--check', '--json']);
  t.eq(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout).results[0];
  t.eq([res.status, res.from], ['would-upgrade', '2.0.0']);
  t.ok(res.note.includes('runtime 2.0.0') && res.note.includes(`pinned ${VERSION}`), res.note);
  t.eq(runtimeVersion(), '2.0.0');
  t.eq(JSON.parse(fs.readFileSync(stateFile, 'utf8')).version, '2.0.0');
  t.eq(sha(settings), settingsBefore);
});
t.test('upgrade: 2.0.0 runtime -> checkout version, scripts identical, settings.json untouched', () => {
  const r = cli(['w1', '--json']);
  t.eq(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout).results[0];
  t.eq([res.status, res.from, res.to, res.note], ['ok', '2.0.0', VERSION, 'scripts identical']);
  t.eq(runtimeVersion(), VERSION);
  t.eq(scriptsIntegrityHash(path.join(runtime, 'remote')), scriptsIntegrityHash());
  t.eq(sha(settings), settingsBefore);
});
t.test('second run: up to date, still exit 0 (--check says current)', () => {
  const r = cli(['w1', '--check']);
  t.eq(r.status, 0, r.stderr);
  t.ok(/w1\s+\S+\s+up to date/.test(r.stdout), r.stdout);
});
t.done();
