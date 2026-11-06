'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { runChild, needsFileCapture } = require('../lib/capped-child-process-runner.cjs');

const node = process.execPath;
const script = 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{process.stdout.write("out:"+s);process.stderr.write("err");process.exit(3);});';
// private tmpdir so parallel test processes cannot skew the leftover count (os.tmpdir() reads these env vars per call)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-runner-test-'));
for (const k of ['TMPDIR', 'TEMP', 'TMP']) process.env[k] = tmp;
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const leftovers = () => fs.readdirSync(tmp).filter((f) => f.startsWith('rig-ssh-out-')).length;

t.test('file capture only for ssh on win32', () => {
  t.eq(needsFileCapture('ssh', 'win32'), true);
  t.eq(needsFileCapture('ssh', 'darwin'), false);
  t.eq(needsFileCapture('node', 'win32'), false);
});

t.test('pipe and file capture return the same stdout/stderr/code', async () => {
  const before = leftovers();
  for (const captureToFiles of [false, true]) {
    const r = await runChild(node, ['-e', script], { stdin: 'hello', timeoutMs: 10000, captureToFiles });
    t.eq([r.code, r.stdout, r.stderr], [3, 'out:hello', 'err']);
  }
  t.eq(leftovers(), before); // temp files removed
});

t.test('file capture: timeout and oversize output reject, temp files removed', async () => {
  const before = leftovers();
  let cls = null;
  try { await runChild(node, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 300, captureToFiles: true }); } catch (e) { cls = e.class; }
  t.eq(cls, 'timeout');
  cls = null;
  try { await runChild(node, ['-e', 'process.stdout.write("x".repeat(11*1024*1024))'], { timeoutMs: 20000, captureToFiles: true }); } catch (e) { cls = e.class; }
  t.eq(cls, 'bad-output');
  t.eq(leftovers(), before);
});

t.test('file capture: spawn error rejects unreachable without an uncaught exception', async () => {
  const before = leftovers();
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  let cls = null;
  try { await runChild('rig-no-such-cmd-xyz', [], { timeoutMs: 3000, captureToFiles: true }); } catch (e) { cls = e.class; }
  await new Promise((r) => setTimeout(r, 100)); // let a late 'close' fire
  process.off('uncaughtException', onUncaught);
  t.eq([cls, uncaught.length, leftovers()], ['unreachable', 0, before]);
});

t.test('file capture: endless output is killed early by the size poll; multibyte stdin round-trips', async () => {
  const t0 = Date.now();
  let cls = null;
  try { await runChild(node, ['-e', 'const b="x".repeat(1<<20);(function w(){process.stdout.write(b,w)})()'], { timeoutMs: 30000, captureToFiles: true }); } catch (e) { cls = e.class; }
  t.eq(cls, 'bad-output');
  t.ok(Date.now() - t0 < 15000, 'killed well before the timeout');
  const r = await runChild(node, ['-e', script], { stdin: 'xin chào ✓', timeoutMs: 10000, captureToFiles: true });
  t.eq(r.stdout, 'out:xin chào ✓');
});

t.done();
