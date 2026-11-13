'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const V = require('../lib/rig-version-compat.cjs');
const { scriptsIntegrityHash } = require('../lib/skill-scripts-integrity-hash.cjs');
const { copyRuntime } = require('../../../../hooks/lib/runtime-copy-to-user-dir.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-vc-'));
const mk = (name) => fs.mkdirSync(path.join(tmp, name), { recursive: true }) || path.join(tmp, name);

t.test('readRigVersion: VERSION, then plugin.json, else unknown (a 1.x metadata.json is not read)', () => {
  const a = mk('a');
  t.eq(V.readRigVersion(a), 'unknown');
  fs.writeFileSync(path.join(a, 'metadata.json'), JSON.stringify({ version: '1.2.3' }));
  t.eq(V.readRigVersion(a), 'unknown');
  fs.mkdirSync(path.join(a, '.claude-plugin'));
  fs.writeFileSync(path.join(a, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '2.0.0-beta.1' }));
  t.eq(V.readRigVersion(a), '2.0.0-beta.1');
  fs.writeFileSync(path.join(a, 'VERSION'), '3.1.4\n');
  t.eq(V.readRigVersion(a), '3.1.4');
  fs.writeFileSync(path.join(a, 'VERSION'), '../../etc\n');
  t.eq(V.readRigVersion(a), '2.0.0-beta.1', 'a junk VERSION is ignored');
});
t.test('readRigVersion with no argument reads this checkout (plugin.json)', () => {
  t.eq(V.readRigVersion(), JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version);
});
t.test('majorOf', () => {
  t.eq([V.majorOf('2.0.0'), V.majorOf('2.0.0-beta.1'), V.majorOf('10.2.3'), V.majorOf('unknown'), V.majorOf(undefined), V.majorOf('2.0')], [2, 2, 10, null, null, null]);
});
t.test('checkWorkerCompat: protocol first, then major; minor/patch drift is compatible', () => {
  const orch = { protocol: 2, rigVersion: '2.1.0' };
  t.eq(V.checkWorkerCompat({ protocol: 2, rigVersion: '2.0.5' }, orch), null);
  t.eq(V.checkWorkerCompat({ protocol: 2, rigVersion: '2.1.0-beta.2' }, orch), null);
  t.eq(V.checkWorkerCompat({ protocol: 1, rigVersion: '1.1.0' }, orch).cls, 'protocol-mismatch');
  t.eq(V.checkWorkerCompat({ protocol: 2, rigVersion: '3.0.0' }, orch).cls, 'version-mismatch');
  t.eq(V.checkWorkerCompat({ protocol: 2, rigVersion: 'unknown' }, orch).cls, 'version-unknown');
  t.eq(V.checkWorkerCompat({ protocol: 2, rigVersion: '2.0.0' }, { protocol: 2, rigVersion: 'unknown' }).cls, 'version-unknown');
  t.ok(/rig-init/.test(V.checkWorkerCompat({ protocol: 1 }, orch).hint));
});
t.test('runtimeVersionProblem: only runtime copies are checked, and need a valid VERSION', () => {
  t.eq(V.runtimeVersionProblem(mk('not-runtime')), null);
  const rt = path.join(mk('rig'), 'runtime');
  fs.mkdirSync(rt);
  t.ok(/no valid VERSION/.test(V.runtimeVersionProblem(rt)));
  fs.writeFileSync(path.join(rt, 'VERSION'), '2.0.0\n');
  t.eq(V.runtimeVersionProblem(rt), null);
});
t.test('the worker integrity hash of the source tree equals the one of its runtime copy (doctor compares them)', () => {
  const home = mk('hash-home');
  const { dir } = copyRuntime({ pluginRoot: PLUGIN_ROOT, home });
  t.eq(scriptsIntegrityHash(path.join(dir, 'remote')), scriptsIntegrityHash());
  fs.appendFileSync(path.join(dir, 'remote', 'worker.cjs'), '\n// tampered\n');
  t.ok(scriptsIntegrityHash(path.join(dir, 'remote')) !== scriptsIntegrityHash(), 'a changed worker changes the hash');
});

t.done().finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
