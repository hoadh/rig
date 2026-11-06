'use strict';
/** Review M-C: a recorded agent pid is only killed when its process start identity still matches. */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const P = require('../lib/agent-process-registry.cjs');
const { makeFakeExecutable, fakeRanCount } = require('./fake-executable-for-tests.cjs');

const sleeper = () => cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { detached: true, stdio: 'ignore' });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rig-pidreg-'));
const unix = process.platform !== 'win32';

t.test('matching start identity: recorded group is killed and the record removed', async () => {
  const dir = tmp(); const c = sleeper(); c.unref();
  try {
    P.recordAgentPid(dir, c.pid);
    t.ok(P.processStartIdentity(c.pid) !== '' && fs.readFileSync(P.pidFile(dir), 'utf8').split('\n')[1] !== '');
    t.eq(P.killRecordedAgent(dir), true);
    t.ok(await wait(() => !alive(c.pid)));
    t.ok(!fs.existsSync(P.pidFile(dir)));
  } finally { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('pid reuse: a live unrelated process with a different start identity is NOT killed', async () => {
  if (!unix) return;
  const dir = tmp(); const c = sleeper(); c.unref();
  try {
    fs.writeFileSync(P.pidFile(dir), `${c.pid}\nThu Jan  1 00:00:00 1970\n`); // record from some long-dead process
    t.eq(P.killRecordedAgent(dir), false);
    await new Promise((r) => setTimeout(r, 200));
    t.ok(alive(c.pid), 'unrelated process must survive');
    t.ok(!fs.existsSync(P.pidFile(dir)), 'stale record is dropped');
  } finally { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('identity-less record: no live group -> no kill; live group -> group killed (M4)', async () => {
  if (!unix) return;
  const dir = tmp(); const c = sleeper(); c.unref();
  try {
    fs.writeFileSync(P.pidFile(dir), `${c.pid}\n`);
    t.eq(P.killRecordedAgent(dir), true); // leader alive and its group exists
    t.ok(await wait(() => !alive(c.pid)));
    const dead = cp.spawnSync(process.execPath, ['-e', '0']).pid;
    fs.writeFileSync(P.pidFile(dir), `${dead}\n`);
    t.eq(P.killRecordedAgent(dir), false); // nothing there
  } finally { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('M4: leader dead but group members alive -> group is killed', async () => {
  if (!unix) return;
  const dir = tmp();
  // leader (sh) starts a background sleeper in its own group and exits at once
  const leader = cp.spawn('sh', ['-c', 'sleep 60 & echo $! ; exit 0'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let kid = 0;
  try {
    kid = Number(await new Promise((res) => { let b = ''; leader.stdout.on('data', (d) => { b += d; if (b.includes('\n')) res(b.trim()); }); }));
    t.ok(await wait(() => leader.exitCode !== null || leader.signalCode !== null));
    t.ok(alive(kid), 'group member alive');
    fs.writeFileSync(P.pidFile(dir), `${leader.pid}\nThu Jan  1 00:00:00 1970\n`);
    t.eq(P.killRecordedAgent(dir), true);
    t.ok(await wait(() => !alive(kid)), 'surviving group member killed');
  } finally { try { process.kill(-leader.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('M4: start identity is timezone independent (TZ=UTC pinned)', () => {
  if (!unix) return;
  const c = sleeper(); c.unref();
  try {
    const a = P.processStartIdentity(c.pid);
    const saved = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try { t.eq(P.processStartIdentity(c.pid), a); } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
  } finally { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }
});

/** win32: real process, real PowerShell identity reads (no fakes). */
const winSleeper = () => cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore', windowsHide: true });
const winKill = (c) => { try { c.kill(); } catch { /* gone */ } };

t.test('win32: identity is a UTC ISO start time; psReading ok for live, gone for dead', () => {
  if (unix) return;
  const c = winSleeper(); c.unref();
  try {
    const r = P.psReading(c.pid);
    t.eq(r.state, 'ok');
    t.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(r.identity), r.identity);
    t.eq(P.processStartIdentity(c.pid), r.identity); // stable across reads
    t.eq(P.psReading(NaN), { state: 'error' });
  } finally { winKill(c); }
  // a just-exited pid can be recycled at once on Windows: accept the first of a few dead pids that reads as gone
  const readings = [];
  for (let i = 0; i < 3; i++) {
    const dead = cp.spawnSync(process.execPath, ['-e', '0']).pid;
    readings.push(P.psReading(dead));
    if (readings[i].state === 'gone') break;
  }
  t.ok(readings.some((r) => r.state === 'gone'), `a dead pid reads as gone: ${JSON.stringify(readings)}`);
});

t.test('win32: tampered identity -> no kill, process survives, record dropped; intact -> killed', async () => {
  if (unix) return;
  const dir = tmp(); const c = winSleeper(); c.unref();
  try {
    P.recordAgentPid(dir, c.pid);
    const [l1, l2] = fs.readFileSync(P.pidFile(dir), 'utf8').split('\n');
    t.eq(Number(l1), c.pid);
    t.ok(l2 !== '', 'identity recorded');
    fs.writeFileSync(P.pidFile(dir), `${c.pid}\n1970-01-01T00:00:00.0000000Z\n`);
    t.eq(P.killRecordedAgent(dir), false);
    await new Promise((r) => setTimeout(r, 300));
    t.ok(alive(c.pid), 'pid with a different start time must survive');
    t.ok(!fs.existsSync(P.pidFile(dir)), 'stale record is dropped');
    fs.writeFileSync(P.pidFile(dir), `${c.pid}\n`); // identity-less record: win32 has no group fallback
    t.eq(P.killRecordedAgent(dir), false);
    t.ok(alive(c.pid), 'identity-less record must not kill on win32');
    fs.writeFileSync(P.pidFile(dir), `${l1}\n${l2}\n`);
    t.eq(P.killRecordedAgent(dir), true);
    t.ok(await wait(() => !alive(c.pid)), 'matching identity kills');
    t.ok(!fs.existsSync(P.pidFile(dir)));
  } finally { winKill(c); fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('win32: dead pid with a recorded identity -> no kill', () => {
  if (unix) return;
  const dir = tmp();
  try {
    const dead = cp.spawnSync(process.execPath, ['-e', '0']).pid;
    fs.writeFileSync(P.pidFile(dir), `${dead}\n2020-01-01T00:00:00.0000000Z\n`);
    t.eq(P.killRecordedAgent(dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('killPidTree rejects invalid pids; dead pid -> false', () => {
  t.eq(P.killPidTree(1), false);
  t.eq(P.killPidTree(NaN), false);
  const c = cp.spawnSync(process.execPath, ['-e', '0']);
  t.eq(P.killPidTree(c.pid), false);
});

/** Put a fake `ps` first on PATH. `body` is the shell script; real ps stays reachable as /bin/ps. */
function withFakePs(body, fn) {
  const bin = tmp(); const saved = process.env.PATH;
  fs.writeFileSync(path.join(bin, 'ps'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  process.env.PATH = `${bin}:${saved}`;
  try { return fn(bin); } finally { process.env.PATH = saved; fs.rmSync(bin, { recursive: true, force: true }); }
}

t.test('R4-L4: recorded identity + ps failing (non-zero + stderr) -> retried once, still failing -> NO kill', async () => {
  if (!unix) return;
  const dir = tmp(); const c = sleeper(); c.unref();
  try {
    P.recordAgentPid(dir, c.pid); // real identity recorded
    const killed = withFakePs('echo "ps: boom" >&2; exit 2', () => P.killRecordedAgent(dir));
    t.eq(killed, false);
    await new Promise((r) => setTimeout(r, 200));
    t.ok(alive(c.pid), 'live group must survive a ps failure');
  } finally { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('R4-L4: one transient ps failure is retried and the matching identity still kills', async () => {
  if (!unix) return;
  const dir = tmp(); const c = sleeper(); c.unref();
  try {
    P.recordAgentPid(dir, c.pid);
    const body = 'f="$0.n"; if [ ! -e "$f" ]; then : > "$f"; echo oops >&2; exit 2; fi; exec /bin/ps "$@"';
    t.eq(withFakePs(body, () => P.killRecordedAgent(dir)), true);
    t.ok(await wait(() => !alive(c.pid)));
  } finally { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

/** win32: put a fake powershell.exe first on PATH (psReadingWin32 spawns it by name). */
function withFakePowershell(jsBody, fn) {
  const bin = tmp(); const saved = process.env.PATH;
  makeFakeExecutable(bin, 'powershell', jsBody);
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  try { return fn(bin); } finally { process.env.PATH = saved; fs.rmSync(bin, { recursive: true, force: true }); }
}

t.test('R4-L4 win32: recorded identity + Get-Process failing -> retried once, still failing -> NO kill', async () => {
  if (unix) return;
  const dir = tmp(); const c = winSleeper(); c.unref();
  try {
    P.recordAgentPid(dir, c.pid); // real identity recorded
    t.ok(fs.readFileSync(P.pidFile(dir), 'utf8').split('\n')[1] !== '', 'identity recorded');
    let ran = 0;
    const killed = withFakePowershell("process.stderr.write('boom'); process.exit(1);", (bin) => { const k = P.killRecordedAgent(dir); ran = fakeRanCount(bin, 'powershell'); return k; });
    t.ok(ran >= 2, `fake powershell must have run (retry): ${ran}`);
    t.eq(killed, false);
    await new Promise((r) => setTimeout(r, 300));
    t.ok(alive(c.pid), 'live process must survive a Get-Process failure');
    t.ok(!fs.existsSync(P.pidFile(dir)), 'record is dropped');
  } finally { winKill(c); fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('R4-L4 win32: one transient Get-Process failure is retried and the matching identity still kills', async () => {
  if (unix) return;
  const dir = tmp(); const c = winSleeper(); c.unref();
  try {
    P.recordAgentPid(dir, c.pid);
    const real = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const js = (bin) => `const fs=require('fs');const f=${JSON.stringify(path.join(bin, 'transient.flag'))};`
      + `if(!fs.existsSync(f)){fs.writeFileSync(f,'');process.stderr.write('oops');process.exit(2);}`
      + `const r=require('child_process').spawnSync(${JSON.stringify(real)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status===null?3:r.status);`;
    const bin = tmp(); const saved = process.env.PATH;
    makeFakeExecutable(bin, 'powershell', js(bin));
    process.env.PATH = `${bin}${path.delimiter}${saved}`;
    let killed;
    try { killed = P.killRecordedAgent(dir); } finally { process.env.PATH = saved; }
    const ran = fakeRanCount(bin, 'powershell');
    fs.rmSync(bin, { recursive: true, force: true });
    t.eq(ran, 2, 'failed once, then retried');
    t.eq(killed, true);
    t.ok(await wait(() => !alive(c.pid)), 'matching identity kills');
  } finally { winKill(c); fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('R4-L4: psReading separates a clean "no such process" from a failure', () => {
  if (!unix) return;
  const dead = cp.spawnSync(process.execPath, ['-e', '0']).pid;
  t.eq(P.psReading(dead), { state: 'gone' });
  t.eq(P.psReading(process.pid).state, 'ok');
  t.eq(withFakePs('exit 2', () => P.psReading(process.pid)), { state: 'error' });
});

t.done();
