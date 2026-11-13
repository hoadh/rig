'use strict';
/** Handshake: same-major version drift is reported once per machine (never refused); equal prints nothing; other major still refused. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const T = require('../lib/ssh-transport.cjs');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');
const { readRigVersion } = require('../lib/rig-version-compat.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-drift-test-'));
process.env.RIG_REMOTE_TRANSPORT = 'local';
const worker = (version) => {
  const f = path.join(dir, `worker-${version}.cjs`);
  fs.writeFileSync(f, `let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const e=JSON.parse(s);
    console.log('RIGJSON:'+e.nonce+':'+JSON.stringify({protocol:${PROTOCOL_VERSION},rigVersion:${JSON.stringify(version)}}));});`);
  return f;
};
const orch = readRigVersion();
const major = orch.split('.')[0];

t.test('driftHint: null when equal, one actionable line otherwise', () => {
  t.eq(T.driftHint('waso-vm', '2.1.0', '2.1.0'), null);
  t.eq(T.driftHint('waso-vm', '2.0.0', '2.1.0'), 'waso-vm runs Rig 2.0.0, this machine 2.1.0: run rig-remote upgrade waso-vm');
});
t.test('driftHint: a NEWER worker is told to update this machine, not to upgrade the worker', () => {
  const h = T.driftHint('waso-vm', '2.2.0', '2.1.0');
  t.ok(h.includes('newer than this machine 2.1.0') && h.includes('update this machine') && !h.includes('rig-remote upgrade'), h);
});
t.test('same major, other version: reported once per machine, handshake still succeeds', async () => {
  process.env.RIG_REMOTE_WORKER_PATH = worker(`${major}.0.0-drift`);
  const lines = [];
  const info = await T.ensureWorkerCompatible('drifty', { onDrift: (l) => lines.push(l) });
  t.eq(info.rigVersion, `${major}.0.0-drift`);
  await T.ensureWorkerCompatible('drifty', { onDrift: (l) => lines.push(l) }); // memoized: no second line
  t.eq(lines, [`drifty runs Rig ${major}.0.0-drift, this machine ${orch}: run rig-remote upgrade drifty`]);
});
t.test('equal version prints nothing', async () => {
  process.env.RIG_REMOTE_WORKER_PATH = worker(orch);
  const lines = [];
  await T.ensureWorkerCompatible('same', { onDrift: (l) => lines.push(l) });
  t.eq(lines, []);
});
t.test('another major is still refused, no drift line', async () => {
  process.env.RIG_REMOTE_WORKER_PATH = worker(`${Number(major) + 1}.0.0`);
  const lines = [];
  await t.rejectsRemote(T.ensureWorkerCompatible('major', { onDrift: (l) => lines.push(l) }), { exitCode: 5, cls: 'version-mismatch' });
  t.eq(lines, []);
});
t.test('resetHandshake makes the next call ask again', async () => {
  process.env.RIG_REMOTE_WORKER_PATH = worker(orch);
  const a = await T.ensureWorkerCompatible('again');
  T.resetHandshake('again');
  t.ok((await T.ensureWorkerCompatible('again')) !== a);
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
t.done();
