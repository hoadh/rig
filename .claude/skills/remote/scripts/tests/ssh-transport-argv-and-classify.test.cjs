'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const T = require('../lib/ssh-transport.cjs');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-transport-test-'));
const stub = path.join(dir, 'stub-worker.cjs');
// Stub worker: behaviour chosen by argv[2]; reads envelope like the real worker.
fs.writeFileSync(stub, `
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  const env = JSON.parse(s); const mode = process.argv[2];
  const out = (o,n=env.nonce)=>console.log('RIGJSON:'+n+':'+JSON.stringify(o));
  if (mode==='info') out({protocol:${PROTOCOL_VERSION},rigVersion:'t',node:process.version,platform:process.platform});
  else if (mode==='old') out({protocol:${PROTOCOL_VERSION + 1}});
  else if (mode==='echo') out({payload:env.payload});
  else if (mode==='forged') { console.log('RIGJSON:{"forged":true}'); out({real:true}); }
  else if (mode==='wrongnonce') { out({forged:true},'0'.repeat(32)); out({real:true}); }
  else if (mode==='forgedonly') out({forged:true},'f'.repeat(32));
  else if (mode==='twice') { out({a:1}); out({a:2}); }
  else if (mode==='badjson') console.log('RIGJSON:'+env.nonce+':{oops');
  else if (mode==='noreply') { console.error('boom'); process.exit(3); }
  else if (mode==='notfound') { console.error('sh: node: command not found'); process.exit(127); }
  else if (mode==='exitssh') { console.error('ssh: Could not resolve hostname'); process.exit(255); }
  else if (mode==='exitcode') { out({x:1}); process.exit(4); }
  else if (mode==='hang') setInterval(()=>{},1000);
});`);

process.env.RIG_REMOTE_TRANSPORT = 'local';
process.env.RIG_REMOTE_WORKER_PATH = stub;
// The stub takes its mode from argv[2] = the "sub" position, so use sub names that are valid ([a-z]+).
const call = (mode, opts) => T.execWorker('anybox', mode, [], opts);

t.test('ssh argv: hardening flags, -- before target, command last', () => {
  const argv = T.buildSshArgv('dev@waso', 'node x info');
  const opt = (k) => argv.some((a, i) => a === '-o' && argv[i + 1] === k);
  for (const o of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ConnectTimeout=10', 'ServerAliveInterval=15', 'ServerAliveCountMax=3',
    'ForwardAgent=no', 'ClearAllForwardings=yes', 'PermitLocalCommand=no', 'ForwardX11=no']) t.ok(opt(o), o);
  t.eq(argv.slice(-3), ['--', 'dev@waso', 'node x info']);
  t.ok(!argv.some((a) => /ProxyCommand/i.test(a)));
});
t.test('ssh argv rejects option-injecting targets', () => {
  for (const bad of ['-oProxyCommand=x', 'a@-o', 'a b']) t.throwsRemote(() => T.buildSshArgv(bad, 'x'), { exitCode: 2 });
});
t.test('classify: 255 unreachable', () => t.eq(T.classifyFailure({ code: 255, stderr: 'x' }).cls, 'unreachable'));
t.test('classify: spike signatures -> command-not-found', () => {
  const c = (code, stderr) => T.classifyFailure({ code, stderr }).cls;
  t.eq(c(127, 'bash: node: command not found'), 'command-not-found');
  t.eq(c(1, "'node' is not recognized as an internal or external command,"), 'command-not-found');
  t.eq(c(1, "The term 'node' is not recognized as the name of a cmdlet, function"), 'command-not-found');
  t.eq(c(9009, ''), 'command-not-found');
  t.ok(/absolute "node"|"node" path/.test(T.classifyFailure({ code: 127, stderr: '' }).hint));
});
t.test('classify: other -> bad-output with stderr tail hint', () => {
  const r = T.classifyFailure({ code: 1, stderr: 'Error: Cannot find module x' });
  t.eq(r.cls, 'bad-output');
  t.ok(r.hint.includes('Cannot find module'));
});
t.test('local transport returns parsed reply and passes payload via stdin', async () => {
  const r = await call('echo', { payload: { a: [1, 2] } });
  t.eq(r.reply, { payload: { a: [1, 2] } });
  t.eq(r.code, 0);
});
t.test('nonzero worker exit with valid reply returns code + reply', async () => {
  const r = await call('exitcode');
  t.eq([r.code, r.reply], [4, { x: 1 }]);
});
t.test('forged / wrong-nonce lines are ignored', async () => {
  t.eq((await call('forged')).reply, { real: true });
  t.eq((await call('wrongnonce')).reply, { real: true });
});
t.test('only forged reply -> bad-output (exit 5)', async () => {
  await t.rejectsRemote(call('forgedonly'), { exitCode: 5, cls: 'bad-output' });
});
t.test('two framed replies / bad json -> bad-output', async () => {
  await t.rejectsRemote(call('twice'), { exitCode: 5, cls: 'bad-output' });
  await t.rejectsRemote(call('badjson'), { exitCode: 5, cls: 'bad-output' });
});
t.test('no reply classes: noreply, notfound, 255', async () => {
  const e = await t.rejectsRemote(call('noreply'), { exitCode: 5, cls: 'bad-output' });
  t.ok(e.hint.includes('boom'));
  await t.rejectsRemote(call('notfound'), { exitCode: 5, cls: 'command-not-found' });
  await t.rejectsRemote(call('exitssh'), { exitCode: 5, cls: 'unreachable' });
});
t.test('invalid sub rejected before spawn', async () => {
  await t.assert.rejects(T.execWorker('anybox', 'Bad Sub', []), (e) => e.exitCode === 2);
});
t.test('hard timeout kills child', async () => {
  await t.rejectsRemote(call('hang', { timeoutMs: 400 }), { exitCode: 5, cls: 'timeout' });
});
t.test('handshake ok + memoized; mismatch -> protocol-mismatch exit 5', async () => {
  const info = await T.ensureWorkerCompatible('boxa');
  t.eq(info.protocol, PROTOCOL_VERSION);
  t.ok((await T.ensureWorkerCompatible('boxa')) === info); // same memoized object
  process.env.RIG_REMOTE_WORKER_PATH = path.join(dir, 'old-worker.cjs');
  fs.writeFileSync(process.env.RIG_REMOTE_WORKER_PATH, fs.readFileSync(stub, 'utf8').replace("mode = process.argv[2]", "mode = 'old'"));
  await t.rejectsRemote(T.ensureWorkerCompatible('boxb'), { exitCode: 5, cls: 'protocol-mismatch' });
  process.env.RIG_REMOTE_WORKER_PATH = stub;
});
t.test('real worker.cjs via local transport: info handshake', async () => {
  delete process.env.RIG_REMOTE_WORKER_PATH;
  process.env.HOME = dir; // no ~/.claude install in temp home -> falls back to this checkout's worker
  const r = await T.execWorker('realbox', 'info');
  t.eq(r.reply.protocol, PROTOCOL_VERSION);
  t.eq(r.reply.platform, process.platform);
});

t.done().finally(() => fs.rmSync(dir, { recursive: true, force: true }));
