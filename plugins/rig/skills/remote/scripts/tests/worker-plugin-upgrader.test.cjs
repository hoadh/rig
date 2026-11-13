'use strict';
/** worker-plugin-upgrader + upgrade command: step order, stop-on-failure, --check writes nothing, version table, hints. All I/O faked. */
const t = require('./minimal-test-harness.cjs');
const U = require('../lib/worker-plugin-upgrader.cjs');
const upgradeCommand = require('../commands/upgrade-command.cjs');

const ORCH = { version: '2.1.0', hash: 'h-new' };
const CFG = { ssh: 'rig@box', os: 'linux', shell: 'bash', claude: 'claude', node: 'node' };
const INSTALL = '/home/rig/.claude/plugins/cache/rig-marketplace/rig/2.1.0';
const entry = (version, extra = {}) => ({ id: 'rig@rig-marketplace', version, scope: 'user', enabled: true, installPath: INSTALL, ...extra });

/**
 * Fake io. `world` steers answers; `calls` records `exe args` strings. The installed version flips to `world.after`
 * once `plugin update` ran, as the real claude does.
 */
function fakeIo(over = {}) {
  const world = { claudeVersion: '2.1.323 (Claude Code)', before: '2.0.0', after: '2.1.0', runs: [], info: { rigVersion: '2.1.0', integrityHash: 'h-new' }, ...over };
  const calls = [];
  let updated = false;
  const io = {
    calls, world,
    async sh(name, cfg, exe, args) {
      const line = `${exe} ${args.join(' ')}`;
      calls.push(line);
      if (world.sh) { const r = world.sh(line); if (r) return r; }
      if (args[0] === '--version') return { code: 0, stdout: world.claudeVersion, stderr: '' };
      if (args[0] === 'plugin' && args[1] === 'list') {
        const installed = world.noPlugin ? [] : [entry(updated ? world.after : world.before)];
        const body = args.includes('--available') ? { installed, available: [{ pluginId: 'rig@rig-marketplace', version: world.after }] } : installed;
        return { code: 0, stdout: JSON.stringify(body), stderr: '' };
      }
      if (args[1] === 'marketplace') return { code: 0, stdout: 'ok', stderr: '' };
      if (args[1] === 'update') { updated = true; return { code: 0, stdout: JSON.stringify({ success: true }), stderr: '' }; }
      if (exe === 'node') return { code: 0, stdout: JSON.stringify({ status: 'copied', version: world.after }), stderr: '' };
      throw new Error(`unexpected call ${line}`);
    },
    async workerList() { calls.push('worker:list'); return { runs: world.runs }; },
    async workerInfo() { calls.push('worker:info'); if (world.infoError) throw new Error(world.infoError); return world.info; },
    resetHandshake: (m) => calls.push(`reset:${m}`),
    sleep: async () => { calls.push('sleep'); if (world.clearRunsAfterSleep) world.runs = []; },
  };
  return io;
}
const go = (io, opts = {}) => U.upgradeMachine('box', CFG, { orch: ORCH, io, ...opts });
const writes = (calls) => calls.filter((c) => /plugin update|marketplace update|refresh-runtime-copy/.test(c));

t.test('happy path: steps in order, handshake cache reset before the verify info call', async () => {
  const io = fakeIo();
  const r = await go(io);
  t.eq([r.status, r.from, r.to, r.note], ['ok', '2.0.0', '2.1.0', 'scripts identical']);
  t.eq(io.calls, [
    'claude --version', 'claude plugin list --json --available', 'worker:list',
    'claude plugin marketplace update rig-marketplace', 'claude plugin update rig@rig-marketplace --json',
    'claude plugin list --json', `node ${INSTALL}/scripts/refresh-runtime-copy.cjs --json`, 'reset:box', 'worker:info',
  ]);
});
t.test('stops at the first failing step: update failure never refreshes the runtime', async () => {
  const io = fakeIo({ sh: (l) => (/^claude plugin update/.test(l) ? { code: 1, stdout: '', stderr: 'network down' } : null) });
  const r = await go(io);
  t.eq([r.status, r.step], ['failed', 'update']);
  t.ok(r.detail.includes('network down') && r.fix, JSON.stringify(r));
  t.ok(!io.calls.some((c) => /refresh-runtime-copy/.test(c)));
});
t.test('marketplace update failure stops before plugin update', async () => {
  const io = fakeIo({ sh: (l) => (/marketplace update/.test(l) ? { code: 1, stdout: '', stderr: 'no route' } : null) });
  const r = await go(io);
  t.eq([r.status, r.step], ['failed', 'update']);
  t.ok(!io.calls.some((c) => /^claude plugin update/.test(c)));
});
t.test('--check makes no write call and no refresh', async () => {
  const io = fakeIo();
  const r = await go(io, { check: true });
  t.eq(r.status, 'would-upgrade');
  t.eq(writes(io.calls), []);
  t.ok(r.note.includes('pinned 2.1.0') && r.note.includes('plugin 2.0.0'), r.note);
  const cur = fakeIo({ before: '2.1.0' });
  t.eq((await go(cur, { check: true })).status, 'current');
});
t.test('missing plugin: skipped with the generic install hint, never a --migrate hint', async () => {
  const r = await go(fakeIo({ noPlugin: true }));
  t.eq(r.status, 'skipped');
  t.ok(r.fix.includes('claude plugin install rig@rig-marketplace') && !/migrate/.test(JSON.stringify(r)), r.fix);
});
t.test('Claude Code below the floor fails preflight before any other call', async () => {
  const io = fakeIo({ claudeVersion: '2.1.100 (Claude Code)' });
  const r = await go(io);
  t.eq([r.status, r.step], ['failed', 'preflight']);
  t.eq(io.calls, ['claude --version']);
});
t.test('busy worker: refused without --wait; --wait polls until idle then upgrades', async () => {
  const run = { runId: 'run-abcdef01', slug: 'plan-x', state: 'running' };
  const refused = fakeIo({ runs: [run] });
  const r = await go(refused);
  t.eq([r.status, r.step], ['failed', 'busy']);
  t.ok(r.detail.includes('run-abcdef01') && r.fix.includes('--wait'));
  t.eq(writes(refused.calls), []);
  const waiting = fakeIo({ runs: [run], clearRunsAfterSleep: true });
  t.eq((await go(waiting, { wait: true })).status, 'ok');
  t.ok(waiting.calls.includes('sleep'));
  // a finished or lost run is not busy
  t.eq((await go(fakeIo({ runs: [{ runId: 'r2', state: 'done' }, { runId: 'r3', state: 'lost' }] }))).status, 'ok');
});
t.test('busy check: no runtime / other major is idle; timeout, unreachable, bad output fail the machine before any write', async () => {
  const { RemoteError } = require('../lib/remote-errors.cjs');
  const listFails = (cls) => { const io = fakeIo(); io.workerList = async () => { throw new RemoteError('list broke', 5, { class: cls }); }; return io; };
  for (const cls of ['worker-missing', 'command-not-found', 'version-mismatch', 'runtime-incomplete']) t.eq((await go(listFails(cls))).status, 'ok', cls);
  for (const cls of ['timeout', 'unreachable', 'bad-output']) {
    const io = listFails(cls);
    const r = await go(io);
    t.eq([r.status, r.step, writes(io.calls)], ['failed', 'busy', []], cls);
    t.ok(/rig-remote doctor box/.test(r.fix), r.fix);
  }
  const plain = fakeIo();
  plain.workerList = async () => { throw new Error('weird'); };
  t.eq((await go(plain)).step, 'busy');
});
t.test('installPath that ssh cannot carry fails in preflight (and --check) as step refresh, before any write', async () => {
  const bad = (installPath) => fakeIo({ sh: (l) => (/plugin list/.test(l) ? { code: 0, stdout: JSON.stringify([entry('2.0.0', { installPath })]), stderr: '' } : null) });
  for (const p of ['/home/rig/it$(x)/p', '/home/rig/a;b/p', 'relative/path']) {
    for (const check of [false, true]) {
      const io = bad(p);
      const r = await go(io, { check });
      t.eq([r.status, r.step, writes(io.calls)], ['failed', 'refresh', []], `${p} check=${check}`);
      t.ok(!/check ssh access/.test(r.fix) && r.fix, r.fix);
    }
  }
  // non-ASCII home and a Windows 8.3 `~` name are consistent: accepted by both the path check and the command builder
  t.eq((await go(bad('/home/josé/.claude/plugins/rig/2.1.0'))).status, 'ok');
  const win = { ...CFG, os: 'windows', shell: 'cmd' };
  const io = bad('C:\\Users\\NGUYEN~1\\.claude\\plugins\\rig');
  t.eq((await U.upgradeMachine('box', win, { orch: ORCH, io })).status, 'ok');
  t.ok(io.calls.some((c) => c.endsWith('\\scripts\\refresh-runtime-copy.cjs --json')), io.calls.join('\n'));
  const noPath = fakeIo({ sh: (l) => (/plugin list/.test(l) ? { code: 0, stdout: JSON.stringify([{ id: 'rig@rig-marketplace', version: '2.0.0' }]), stderr: '' } : null) });
  t.eq((await go(noPath)).step, 'refresh');
});
t.test('worker-controlled text is validated before printing: versions, runIds, slugs', async () => {
  const evil = 'w2  2.1.0  ok\u001b[31m';
  const vio = fakeIo({ sh: (l) => (/plugin list/.test(l) ? { code: 0, stdout: JSON.stringify([entry(evil)]), stderr: '' } : null) });
  const r = await go(vio, { check: true });
  t.eq(r.from, null);
  t.ok(!JSON.stringify(r).includes('w2') && !JSON.stringify(r).includes('\\u001b'), JSON.stringify(r));
  const busy = fakeIo({ runs: [{ runId: 'bad\nid', slug: 'x\ny', state: 'running' }, { runId: 'run-abcdef12', slug: 'plan-x', state: 'running' }] });
  const b = await go(busy);
  t.ok(b.detail.includes('(invalid id)') && b.detail.includes('run-abcdef12 (plan-x)') && !/\n/.test(b.detail), b.detail);
  const v = await go(fakeIo({ info: { rigVersion: '2.1.0\nw3 ok', integrityHash: 'h-new' } }));
  t.eq([v.status, v.step], ['failed', 'verify']);
  t.ok(!v.detail.includes('w3'), v.detail);
  t.eq(U.safeVersion('2.1.0-beta.3'), '2.1.0-beta.3');
  t.eq(U.safeVersion('2.1'), null);
});
t.test('--check on a newer worker says so instead of would-upgrade', async () => {
  const io = fakeIo({ before: '2.2.0', info: { rigVersion: '2.2.0', integrityHash: 'x' } });
  const r = await go(io, { check: true });
  t.eq(r.status, 'current');
  t.ok(r.note.includes('newer than this machine') && r.note.includes('claude plugin update'), r.note);
});
t.test('version outcome table', () => {
  const j = (rigVersion, integrityHash = 'h-new') => U.judgeVersions({ rigVersion, integrityHash }, ORCH);
  t.eq(j('2.1.0').ok, true);
  t.eq(j('2.1.0', 'other').ok, false);
  t.eq(j('2.1.0', null).ok, false);
  const newer = j('2.2.0', 'whatever');
  t.ok(newer.ok && /update this machine|here too/.test(newer.note), newer.note);
  t.eq(j('2.0.9').ok, false);
  t.eq(j('2.1.0-beta.3').ok, false); // prerelease < release
  t.eq(j('unknown').ok, false);
});
t.test('verify failures: worker still older, hash differs, handshake error', async () => {
  let r = await go(fakeIo({ info: { rigVersion: '2.0.0', integrityHash: 'x' } }));
  t.eq([r.status, r.step], ['failed', 'verify']);
  r = await go(fakeIo({ info: { rigVersion: '2.1.0', integrityHash: 'x' } }));
  t.ok(r.detail.includes('scripts differ'), r.detail);
  r = await go(fakeIo({ infoError: 'boom' }));
  t.eq([r.status, r.step], ['failed', 'verify']);
});
t.test('worker newer than the orchestrator: ok with the update-this-machine note', async () => {
  const r = await go(fakeIo({ after: '2.2.0', info: { rigVersion: '2.2.0', integrityHash: 'h-2' } }));
  t.eq([r.status, r.to], ['ok', '2.2.0']);
  t.ok(r.note.includes('this machine'));
});
t.test('refresh exit 3 (newer runtime kept) continues to verify; a missing script gives the Rig < 2.1 fix', async () => {
  const keep = fakeIo({ sh: (l) => (/refresh-runtime-copy/.test(l) ? { code: 3, stdout: JSON.stringify({ status: 'newer-present', version: '9.9.9' }), stderr: '' } : null) });
  t.eq((await go(keep)).status, 'ok');
  const old = fakeIo({ sh: (l) => (/refresh-runtime-copy/.test(l) ? { code: 1, stdout: '', stderr: "Error: Cannot find module '/x/refresh-runtime-copy.cjs'" } : null) });
  const r = await go(old);
  t.eq([r.status, r.step], ['failed', 'refresh']);
  t.ok(/Rig < 2\.1/.test(r.fix), r.fix);
});
t.test('marketplace-declared command (shownCommand) stops and shows it', async () => {
  const io = fakeIo({ sh: (l) => (/^claude plugin update/.test(l) ? { code: 0, stdout: JSON.stringify({ shownCommand: { command: 'curl evil', sha256: 'abc' } }), stderr: '' } : null) });
  const r = await go(io);
  t.eq([r.status, r.step], ['failed', 'update']);
  t.ok(r.detail.includes('curl evil'));
  t.ok(!io.calls.some((c) => /refresh-runtime-copy/.test(c)));
});
t.test('transport failure becomes a failed result, secrets in output are redacted', async () => {
  const { RemoteError } = require('../lib/remote-errors.cjs');
  const io = fakeIo({ sh: () => { throw new RemoteError('box: ssh could not reach the machine', 5, { class: 'unreachable', hint: 'timeout' }); } });
  const r = await go(io);
  t.eq([r.status, r.step], ['failed', 'reach']);
  const leak = fakeIo({ sh: (l) => (/^claude plugin update/.test(l) ? { code: 1, stdout: '', stderr: 'token ghp_abcdefghijklmnopqrstuvwxyz0123 rejected' } : null) });
  const r2 = await go(leak);
  t.ok(!r2.detail.includes('ghp_abcdef') && r2.detail.includes('[REDACTED]'), r2.detail);
});
t.test('plugin list parses the bare array and the {installed, available} shapes; tolerates junk', () => {
  t.eq(U.parsePluginList('[{"id":"a"}]').installed.length, 1);
  t.eq(U.parsePluginList('{"installed":[{"id":"a"}],"available":[{"pluginId":"b"}]}').available.length, 1);
  t.eq(U.parsePluginList('not json'), null);
  t.eq(U.parsePluginList('{"x":1}'), null);
  t.eq(U.findRigEntry({ installed: [{ id: 'rig@rig-marketplace', scope: 'project' }, { id: 'rig@rig-marketplace', scope: 'user', version: '1.0.0' }] }).version, '1.0.0');
});
t.test('buildRemoteCommand: per-shell quoting, cmd wrapped when quotes appear, unsafe tokens refused', () => {
  const B = U.buildRemoteCommand;
  t.eq(B({ shell: 'bash' }, 'claude', ['plugin', 'list', '--json']), 'claude plugin list --json');
  t.eq(B({ shell: 'bash' }, '/opt/my dir/node', ['/a b/x.cjs']), "'/opt/my dir/node' '/a b/x.cjs'");
  t.eq(B({ shell: 'cmd' }, 'C:\\node\\node.exe', ['C:\\u\\x.cjs', '--json']), 'C:\\node\\node.exe C:\\u\\x.cjs --json');
  t.eq(B({ shell: 'cmd' }, 'C:\\Program Files\\nodejs\\node.exe', ['C:\\Users\\A B\\x.cjs']), '""C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\A B\\x.cjs""');
  t.eq(B({ shell: 'powershell' }, 'C:\\n\\node.exe', ['C:\\x.cjs']), '& C:\\n\\node.exe C:\\x.cjs');
  t.assert.throws(() => B({ shell: 'bash' }, 'claude', ['a; rm -rf /']), (e) => e.exitCode === 2);
  t.assert.throws(() => B({ shell: 'bash' }, 'claude', ['$(x)']), (e) => e.exitCode === 2);
});
t.test('compareVersions orders release, prerelease and numeric parts', () => {
  t.ok(U.compareVersions('2.1.0', '2.1.0-beta.3') > 0);
  t.ok(U.compareVersions('2.1.0-beta.3', '2.1.0-beta.10') < 0);
  t.ok(U.compareVersions('2.0.10', '2.0.9') > 0);
  t.eq(U.compareVersions('x', '1.0.0'), null);
});

// ---- upgrade command ----
const registry = { machines: { a: { ...CFG }, b: { ...CFG }, c: { ...CFG } } };
const capture = async (argv, upgrade, ctx = { self: 'studio' }) => {
  const out = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  try { return { code: await upgradeCommand.run(argv, ctx, { upgrade, orch: ORCH, registry }), out: out.join('') }; } finally { process.stdout.write = orig; }
};
t.test('command: --all runs every machine in order, one failure does not stop the rest, exit 1', async () => {
  const seen = [];
  const upgrade = async (name, cfg, o) => { seen.push([name, o.check, o.wait]); return name === 'b' ? { machine: name, status: 'failed', step: 'reach', detail: 'down', fix: 'ssh' } : { machine: name, status: 'ok', from: '2.0.0', to: '2.1.0' }; };
  const { code, out } = await capture(['--all', '--wait'], upgrade);
  t.eq(seen, [['a', false, true], ['b', false, true], ['c', false, true]]);
  t.eq(code, 1);
  t.ok(out.includes('a  2.0.0 -> 2.1.0  ok') && out.includes('b  FAILED at reach: down') && out.includes('fix: ssh'), out);
});
t.test('command: an unexpected rejection from one machine still yields every result and the --json summary', async () => {
  const upgrade = async (name) => { if (name === 'a') throw new Error('seam bug\nsecond line'); return { machine: name, status: 'ok', from: '1.0.0', to: '1.0.0' }; };
  const { code, out } = await capture(['--all', '--json'], upgrade);
  const doc = JSON.parse(out);
  t.eq([code, doc.results.map((r) => r.status)], [1, ['failed', 'ok', 'ok']]);
  t.eq(doc.results[0].step, 'error');
});
t.test('command: named machines, --check passed through, --json one document, exit 0', async () => {
  const upgrade = async (name, cfg, o) => ({ machine: name, status: 'current', from: '2.1.0', to: '2.1.0', note: String(o.check) });
  const { code, out } = await capture(['b', 'b', '--check', '--json'], upgrade);
  const doc = JSON.parse(out);
  t.eq([code, doc.check, doc.results.map((r) => [r.machine, r.note])], [0, true, [['b', 'true']]]);
});
t.test('command: usage errors (nothing named, all + names, unknown machine, bad flag) exit 2 and call nothing', async () => {
  const never = async () => { throw new Error('must not run'); };
  for (const argv of [[], ['--all', 'a'], ['zzz'], ['a', '--force']]) {
    await t.assert.rejects(capture(argv, never), (e) => e.exitCode === 2, JSON.stringify(argv));
  }
});
t.test('command: the orchestrator machine is left alone, a skipped worker makes exit 1', async () => {
  const upgrade = async (name) => (name === 'c' ? { machine: name, status: 'skipped', detail: 'no plugin', fix: 'install' } : { machine: name, status: 'ok', from: '1', to: '2' });
  const { code, out } = await capture(['--all'], upgrade, { self: 'a' });
  t.ok(out.includes('a  not touched'), out);
  t.eq(code, 1);
  t.eq((await capture(['b'], upgrade, { self: 'a' })).code, 0);
});
t.done();
