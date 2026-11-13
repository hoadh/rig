#!/usr/bin/env node
/**
 * Tests for the terminal consent gate (terminal-consent-gate.cjs) and the settings writer (settings-json-io-and-backup-dir.cjs),
 * moved unchanged from the 2.0.x review-fix regressions (C1, H1, M3, L6). Fixture HOMEs only.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const { spawnSync } = require('child_process');
const { askYesNo, applyRefusal, isClaudeCodeProcess, readAncestry } = require('../terminal-consent-gate.cjs');
const { writeJsonAtomic } = require('../settings-json-io-and-backup-dir.cjs');
const cli = require('../cli.cjs');
const { applyPermissions } = require('../user-settings-permissions-and-runtime.cjs');
const { makeMachine, snapshot } = require('./rig-init-fixtures.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(PLUGIN_ROOT, 'bin', 'rig-init');
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'rig-init', 'cli.cjs');
const machines = [];
const machine = (opts) => { const m = makeMachine(opts); machines.push(m); return m; };
after(() => machines.forEach((m) => m.cleanup()));
const claude = (m) => path.join(m.home, '.claude');
const readSettings = (m) => JSON.parse(fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8'));
const writeSettings = (m, mutate) => { const s = readSettings(m); mutate(s); fs.writeFileSync(path.join(claude(m), 'settings.json'), JSON.stringify(s, null, 2)); };
const cleanEnv = (m) => { const env = { ...process.env, HOME: m.home, USERPROFILE: m.home }; delete env.CLAUDECODE; return env; };

// ---------------------------------------------------------------- C1
describe('C1: the y/N prompt accepts an answer', () => {
  const ask = (text, end = false) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = askYesNo('Go?', { input, output });
    input.write(text);
    if (end) input.end();
    return p;
  };

  it('resolves true for y/yes and false for n, empty and EOF (real readable stream)', async () => {
    assert.strictEqual(await ask('y\n'), true);
    assert.strictEqual(await ask('YES\n'), true);
    assert.strictEqual(await ask('n\n'), false);
    assert.strictEqual(await ask('\n'), false);
    assert.strictEqual(await ask('', true), false, 'EOF without an answer is no');
    assert.strictEqual(await ask('y\n', true), true, 'an answer followed by EOF still counts');
  });

  it('works on a real pty: rig-init --permissions answered y writes the rules (skipped without `script`)', (t) => {
    if (process.platform !== 'linux') return t.skip('pty check uses util-linux script');
    if (spawnSync('script', ['--version'], { encoding: 'utf8' }).error) return t.skip('`script` not installed');
    const m = machine();
    // The wrapper uses the REAL prompt on the pty; only the ancestry is injected (a test run inside Claude Code has Claude as ancestor)
    const wrapper = path.join(m.root, 'pty-main.cjs');
    fs.writeFileSync(wrapper, `require(${JSON.stringify(CLI)})._mainWithIo({ argv: ['--permissions'], home: ${JSON.stringify(m.home)}, env: {}, ancestors: [], checkVersion: () => ({ status: 'ok' }) }).then((c) => process.exit(c));\n`);
    const res = spawnSync('sh', ['-c', `(sleep 2; printf 'y\\r'; sleep 1) | script -qec "${process.execPath} ${wrapper}" /dev/null`], { encoding: 'utf8', timeout: 30000 });
    assert.match(res.stdout, /Added \d+ rule/, res.stdout);
    assert.ok(readSettings(m).permissions.deny.includes('Read(**/node_modules/**)'));
  });

  it('every apply verb of the real bin refuses piped input instead of prompting (stdin is not a TTY)', () => {
    const m = machine();
    const state = snapshot(m.root);
    for (const argv of [['--permissions'], ['--runtime'], ['--deps']]) {
      const res = spawnSync(process.execPath, [BIN, ...argv], { env: cleanEnv(m), input: 'y\ny\ny\n', encoding: 'utf8', cwd: m.root });
      assert.strictEqual(res.status, 2, argv.join(' '));
      assert.match(res.stderr, /interactive terminal/, argv.join(' '));
    }
    assert.deepStrictEqual(snapshot(m.root), state);
  });
});

// ---------------------------------------------------------------- H1
describe('H1: no apply from inside Claude Code, however the pty and env are arranged', () => {
  it('recognizes Claude Code processes (binary, node running the CLI package) and nothing else', () => {
    assert.ok(isClaudeCodeProcess({ name: 'claude', args: ['/x/claude', '--resume'] }));
    assert.ok(isClaudeCodeProcess({ name: 'node', args: ['node', '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'] }));
    assert.ok(isClaudeCodeProcess({ name: 'claude.exe', args: [] }));
    assert.ok(isClaudeCodeProcess({ name: 'bun', args: ['bun', '/x/claude'] }));
    for (const p of [{ name: 'bash', args: ['bash'] }, { name: 'node', args: ['node', '/p/server.js'] }, { name: 'grep', args: ['grep', 'claude'] }, { name: 'ghostty', args: [] }]) assert.ok(!isClaudeCodeProcess(p), p.name);
  });

  it('refuses with a Claude Code ancestor even when CLAUDECODE is unset and a TTY is present; fails closed when the chain is unreadable', () => {
    const tty = { env: {}, stdinIsTTY: true, stdoutIsTTY: true, command: 'rig-init --runtime' };
    const viaAncestor = applyRefusal({ ...tty, ancestors: [{ pid: 7, name: 'bash', args: [] }, { pid: 6, name: 'claude', args: [] }] });
    assert.match(viaAncestor, /parent process, pid 6, is Claude Code/);
    assert.strictEqual(applyRefusal({ ...tty, ancestors: [{ pid: 7, name: 'bash', args: [] }] }), null);
    assert.match(applyRefusal({ ...tty, ancestors: () => { throw new Error('no /proc'); } }), /could not check[\s\S]*no \/proc[\s\S]*refuses/);
  });

  it('without a TTY refuses before reading the ancestry (no Windows PowerShell query for piped or CI runs)', () => {
    let read = 0;
    const ancestors = () => { read += 1; throw new Error('must not be read'); };
    for (const io of [{ stdinIsTTY: false, stdoutIsTTY: true }, { stdinIsTTY: true, stdoutIsTTY: false }]) {
      assert.match(applyRefusal({ env: {}, ...io, command: 'rig-init --runtime', ancestors }), /interactive terminal/);
    }
    assert.strictEqual(read, 0);
    assert.match(applyRefusal({ env: { CLAUDECODE: '1' }, stdinIsTTY: false, stdoutIsTTY: false, command: 'x', ancestors }), /CLAUDECODE is set/);
  });

  it('reads the real ancestry (Linux /proc) and walks fake chains for /proc, ps and PowerShell', (t) => {
    if (process.platform === 'linux') assert.strictEqual(readAncestry()[0].pid, process.ppid);
    else t.diagnostic('real /proc chain only on Linux');
    const procs = { 100: ['sh', 50], 50: ['claude', 10], 10: ['init', 0] };
    const readFile = (file) => {
      const [, pid, what] = /\/proc\/(\d+)\/(stat|cmdline)/.exec(file);
      if (!procs[pid]) throw new Error('gone');
      return what === 'stat' ? `${pid} (${procs[pid][0]}) S ${procs[pid][1]} 0 0` : `${procs[pid][0]}\0--x`;
    };
    assert.deepStrictEqual(readAncestry({ platform: 'linux', startPid: 100, readFile }).map((p) => p.name), ['claude', 'init']);
    const ps = (cmd, args) => {
      const pid = args[args.length - 1];
      const row = { 100: '50 bash bash', 50: '10 claude /x/claude --resume', 10: '1 launchd /sbin/launchd' }[pid];
      return { status: 0, stdout: `${row}\n` };
    };
    assert.ok(readAncestry({ platform: 'darwin', startPid: 100, run: ps }).some(isClaudeCodeProcess));
    const rows = [{ ProcessId: 100, ParentProcessId: 50, Name: 'node.exe', CommandLine: 'node x' }, { ProcessId: 50, ParentProcessId: 10, Name: 'claude.exe', CommandLine: 'claude' }, { ProcessId: 10, ParentProcessId: 0, Name: 'explorer.exe', CommandLine: '' }];
    let psArgs;
    const win = readAncestry({ platform: 'win32', startPid: 100, run: (cmd, args) => { psArgs = [cmd, ...args]; return { status: 0, stdout: JSON.stringify(rows) }; } });
    assert.ok(win.some(isClaudeCodeProcess));
    assert.deepStrictEqual(psArgs.slice(0, 4), ['powershell', '-NoProfile', '-NonInteractive', '-Command']);
    assert.match(psArgs[4], /^\$ProgressPreference = 'SilentlyContinue'; Get-CimInstance Win32_Process /, 'no progress CLIXML on stderr');
    assert.throws(() => readAncestry({ platform: 'win32', startPid: 1, run: () => ({ status: 1, stdout: '' }) }), /process query failed/);
  });

  it('end to end: `env -u CLAUDECODE` in a pty made with `script` under a claude parent process is refused by the real bin (Linux)', (t) => {
    if (process.platform !== 'linux') return t.skip('needs /proc and a symlink named claude');
    if (spawnSync('script', ['--version'], { encoding: 'utf8' }).status !== 0) return t.skip('needs util-linux script for a pty');
    const m = machine();
    const fakeClaude = path.join(m.root, 'claude');
    fs.symlinkSync(process.execPath, fakeClaude); // comm of this process is `claude`, like the real binary
    const state = snapshot(m.root);
    // A TTY is required now: without one the gate refuses before it reads the ancestry
    const inner = `${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} --runtime; echo "exit=$?"`;
    // SHELL=/bin/sh: `script -c` runs $SHELL -c, and `$?` is not fish syntax
    const code = `const r = require('child_process').spawnSync('script', ['-qec', ${JSON.stringify(inner)}, '/dev/null'], { env: { ...process.env, SHELL: '/bin/sh' }, encoding: 'utf8', input: '', timeout: 30000 }); process.stdout.write(JSON.stringify({ out: r.stdout }));`;
    const res = spawnSync(fakeClaude, ['-e', code], { env: cleanEnv(m), encoding: 'utf8' });
    const { out } = JSON.parse(res.stdout);
    assert.match(out, /exit=2/, out);
    // the fake parent's own pid: run inside a Claude Code session, the real claude is an ancestor too
    assert.match(out, new RegExp(`parent process, pid ${res.pid}, is Claude Code`), out);
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('main() reads the real env, TTY and prompt: injected values are ignored; the injectable entry is separate', () => {
    const m = machine();
    const state = snapshot(m.root);
    const code = `require(${JSON.stringify(CLI)}).main({ argv: ['--runtime'], env: {}, stdinIsTTY: true, stdoutIsTTY: true, ask: async () => true, ancestors: [] }).then((c) => process.exit(c));`;
    const res = spawnSync(process.execPath, ['-e', code], { env: cleanEnv(m), encoding: 'utf8', input: '' });
    assert.strictEqual(res.status, 2, 'no verb in the real argv: usage, nothing applied');
    assert.deepStrictEqual(snapshot(m.root), state);
    assert.strictEqual(cli.main.length, 0);
    assert.strictEqual(typeof cli._mainWithIo, 'function');
  });
});

// ---------------------------------------------------------------- M3
describe('M3: a symlinked settings.json stays a symlink', () => {
  it('--permissions and writeJsonAtomic write the link target', (t) => {
    if (process.platform === 'win32') return t.skip('symlink privileges');
    const m = machine();
    const real = path.join(m.root, 'dotfiles', 'settings.json');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.renameSync(path.join(claude(m), 'settings.json'), real);
    const link = path.join(claude(m), 'settings.json');
    fs.symlinkSync(real, link);
    applyPermissions({ home: m.home });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'link survived --permissions');
    assert.ok(JSON.parse(fs.readFileSync(real, 'utf8')).permissions.deny.includes('Read(**/node_modules/**)'));
    writeJsonAtomic(link, { a: 1 });
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { a: 1 });
  });
});

describe('lows', () => {
  it('L6: --permissions refuses a malformed permissions.ask instead of replacing it', () => {
    const m = machine();
    writeSettings(m, (s) => { s.permissions.ask = 'Read(**/.env)'; });
    const before = fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8');
    assert.throws(() => applyPermissions({ home: m.home }), /permissions\.ask .* not an array/);
    assert.strictEqual(fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8'), before);
  });

});

describe('settings-json-io-and-backup-dir helpers', () => {
  const { withRetry, createBackupDir } = require('../settings-json-io-and-backup-dir.cjs');

  it('withRetry retries transient codes and gives up on a persistent one', () => {
    let calls = 0;
    assert.strictEqual(withRetry(() => { if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return 'ok'; }), 'ok');
    assert.strictEqual(calls, 3);
    assert.throws(() => withRetry(() => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); }), /no/);
  });

  it('createBackupDir never reuses a dir: two backups in the same second get distinct, private dirs', () => {
    const m = machine();
    const group = path.join(m.home, '.claude', 'rig-backups', 'user-settings');
    const now = new Date(2026, 10, 14, 1, 2, 3);
    const a = createBackupDir(group, now);
    const b = createBackupDir(group, now);
    assert.notStrictEqual(a, b);
    assert.strictEqual(path.basename(a), '261114-010203');
    assert.strictEqual(path.basename(b), '261114-010203-1');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(a).mode & 0o777, 0o700);
  });
});
