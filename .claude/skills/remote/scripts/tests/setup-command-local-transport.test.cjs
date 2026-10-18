'use strict';
/**
 * `setup` end to end over the local transport (machine === self): registry -> probes -> real
 * worker `prepare` (clone + baseline). doctor is stubbed (its push probe needs a detached run).
 */
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');

const env = makeRepoWithBareRemote({ clones: ['main'] });
process.env.RIG_MACHINE = 'box';
process.env.RIG_HOME = path.join(env.root, 'rig-home');
process.env.RIG_REMOTE_WORKER_PATH = path.join(__dirname, '..', 'worker.cjs');
process.env.RIG_MACHINES_FILE = path.join(env.root, 'machines.json');
const repo = path.join(env.root, 'worker', 'app');
fs.writeFileSync(process.env.RIG_MACHINES_FILE, JSON.stringify({ machines: {
  // node stands in for claude: the probe only runs `--version`
  box: { ssh: 'rig@box', os: process.platform === 'darwin' ? 'macos' : 'linux', shell: 'bash', repo, pathPrepend: [], node: process.execPath, claude: process.execPath },
} }));

const setup = require('../commands/setup-command.cjs');
const { verifyKnownGoodBaseline } = require('../lib/hardened-git-config-env.cjs');

/** Run setup with stdout captured and doctor stubbed. */
async function runSetup(argv, doctorCode = 0) {
  const calls = [];
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try {
    const code = await setup.run(argv, { doctor: async (names) => { calls.push(names); return doctorCode; } });
    return { code, out, calls };
  } finally { process.stdout.write = write; }
}

const cwd = process.cwd();
process.chdir(env.clone('main'));

t.test('cloneableOrigin drops https userinfo and keeps ssh users', () => {
  t.eq(setup.cloneableOrigin('https://ghp_tok@github.com/o/r.git\n'), 'https://github.com/o/r.git');
  t.eq(setup.cloneableOrigin('https://u:p@github.com/o/r.git'), 'https://github.com/o/r.git');
  t.eq(setup.cloneableOrigin('git@github.com:o/r.git'), 'git@github.com:o/r.git');
  t.eq(setup.cloneableOrigin('https://u:p@ss@github.com/o/r.git'), 'https://github.com/o/r.git');
});
t.test('fresh machine: clone created with identity + baseline, then doctor runs', async () => {
  const r = await runSetup(['box', '--git-name', 'Rig box', '--git-email', 'rig@example.invalid']);
  t.eq(r.code, 0, r.out);
  t.ok(/OK\s+clone\s+created dedicated clone/.test(r.out), r.out);
  t.eq(r.calls, [['box']]);
  t.eq(verifyKnownGoodBaseline(repo).status, 'match');
  t.ok(r.out.includes('setup: ok'));
});
t.test('rerun is idempotent; doctor failure makes setup fail', async () => {
  const r = await runSetup(['box'], 1);
  t.eq(r.code, 1);
  t.ok(r.out.includes('baseline matches') && r.out.includes('setup: FAIL'), r.out);
});
t.test('existing clone without baseline: fail line with fix, doctor skipped', async () => {
  fs.rmSync(process.env.RIG_HOME, { recursive: true, force: true });
  const r = await runSetup(['box']);
  t.eq(r.code, 1);
  t.ok(/FAIL\s+baseline/.test(r.out) && r.out.includes('fix:') && r.out.includes('--accept-existing-clone'), r.out);
  t.eq(r.calls, []);
  t.eq((await runSetup(['box', '--accept-existing-clone'])).code, 0);
});
t.test('worker id mismatch: machine-id fails with fix, prepare never called', async () => {
  const calls = [];
  const client = { execWorker: async (_n, cmd) => { calls.push(cmd); return { reply: { protocol: require('../lib/rig-json-nonce-framing.cjs').PROTOCOL_VERSION, rigVersion: 'x', machine: 'other' } }; },
    workerTarget: () => ({}) };
  const r = await setup.setupMachine('box', {}, client);
  t.eq(r.ready, false);
  const s = r.steps.find((x) => x.id === 'machine-id');
  t.eq(s.status, 'fail'); t.ok(s.fix.includes('RIG_MACHINE=box'), s.fix);
  t.eq(calls, ['info']);
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (x) => { out += x; return true; };
  let code;
  try { code = await setup.run(['box'], { client, doctor: async () => 0 }); } finally { process.stdout.write = write; }
  t.eq(code, 1, out); t.ok(/FAIL\s+machine-id/.test(out), out);
});
t.test('usage errors before any work: unknown machine, half identity, no args', async () => {
  await t.rejectsRemote(runSetup(['nope']), { exitCode: 2 });
  await t.rejectsRemote(runSetup(['box', '--git-name', 'x']), { exitCode: 2 });
  await t.rejectsRemote(runSetup([]), { exitCode: 2 });
});

process.on('exit', () => { process.chdir(cwd); env.cleanup(); });
t.done();
