'use strict';
/**
 * Orchestrator-side stdout cap on the ssh path: a worker that floods stdout
 * must be killed and reported as bad-output (exit 5), not buffered unbounded.
 * A fake `ssh` executable is put first on PATH; no network is touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeFakeExecutable, fakeRanCount } = require('./fake-executable-for-tests.cjs');
const { hostOs, hostShell } = require('./platform-test-fixtures.cjs');
const { execWorker, MAX_OUTPUT_BYTES } = require('../lib/ssh-transport.cjs');

const MACHINE = process.platform === 'win32'
  ? { ssh: 'u@waso', os: hostOs(), shell: hostShell(), repo: 'C:/Users/u/rig', pathPrepend: [] }
  : { ssh: 'u@waso', os: 'linux', shell: 'bash', repo: '/home/u/rig', pathPrepend: [] };

/** Writes a fake `ssh` script into a temp dir, runs fn with it first on PATH, restores env. */
async function withFakeSsh(body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-fake-ssh-'));
  makeFakeExecutable(dir, 'ssh', body);
  const saved = { PATH: process.env.PATH, RIG_MACHINE: process.env.RIG_MACHINE, RIG_REMOTE_TRANSPORT: process.env.RIG_REMOTE_TRANSPORT };
  process.env.PATH = `${dir}${path.delimiter}${saved.PATH}`;
  process.env.RIG_MACHINE = 'mac';
  delete process.env.RIG_REMOTE_TRANSPORT;
  try { return await fn(dir); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const call = () => execWorker('waso', 'info', [], { machineConfig: MACHINE, timeoutMs: 30000 });

t.test('output cap constant is 10 MB', () => t.eq(MAX_OUTPUT_BYTES, 10 * 1024 * 1024));

t.test('ssh stdout flood beyond 10 MB -> bad-output exit 5, child killed', async () => {
  const body = `
    process.stdin.resume();
    const chunk = 'x'.repeat(1 << 20);
    let n = 0;
    const pump = () => { if (n++ < 40) process.stdout.write(chunk, pump); else process.exit(0); };
    pump();`;
  await withFakeSsh(body, async (dir) => {
    const e = await t.rejectsRemote(call(), { exitCode: 5, cls: 'bad-output' });
    t.ok(fakeRanCount(dir, 'ssh') >= 1, 'fake ssh must have run');
    t.ok(/10 MB/.test(e.message), `unexpected message: ${e.message}`);
  });
});

t.test('ssh exit 255 with no output -> unreachable exit 5 (fake ssh is in use)', async () => {
  await withFakeSsh('process.exit(255);', async (dir) => {
    await t.rejectsRemote(call(), { exitCode: 5, cls: 'unreachable' });
    t.eq(fakeRanCount(dir, 'ssh'), 1, 'fake ssh must have run exactly once (not a vacuous spawn failure)');
  });
});

t.done();
