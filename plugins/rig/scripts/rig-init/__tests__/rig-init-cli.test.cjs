#!/usr/bin/env node
/** Tests for the rig-init CLI: consent gate, verbs on fixture HOMEs, permissions, runtime, deps, the real bin. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { _mainWithIo: main, parseArgs } = require('../cli.cjs');
const { applyPermissions, applyRuntime, planPermissions, missingRules } = require('../user-settings-permissions-and-runtime.cjs');
const { checkClaudeCodeVersion, describeVersionCheck } = require('../cc-version-check.cjs');
const { installerCommand, runSkillsInstaller } = require('../skills-dependency-installer-runner.cjs');
const { findIncompleteBackup } = require('../migration-planner.cjs');
const { makeMachine, snapshot, tmpDir } = require('./rig-init-fixtures.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(PLUGIN_ROOT, 'bin', 'rig-init');
const machines = [];
const machine = (opts) => { const m = makeMachine(opts); machines.push(m); return m; };
after(() => machines.forEach((m) => m.cleanup()));

/** Drives main() with captured output; defaults to a real terminal outside Claude Code that answers `answer`. */
async function run(m, argv, { env = {}, tty = true, answer = true, cwd, hooks, runInstaller } = {}) {
  const out = [];
  const err = [];
  const asked = [];
  const code = await main({
    argv, env, home: m.home, cwd: cwd || m.project, ancestors: [], stdinIsTTY: tty, stdoutIsTTY: tty, pluginRoot: PLUGIN_ROOT, hooks, runInstaller,
    stdout: (s) => out.push(s), stderr: (s) => err.push(s),
    ask: async (q) => { asked.push(q); return answer; },
    checkVersion: () => ({ status: 'ok', version: '2.1.318', min: '2.1.292' }),
  });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}

describe('argument parsing', () => {
  it('has no --yes or any other skip-consent option', () => {
    for (const bad of [['--yes'], ['-y'], ['--migrate', '--yes'], ['--migrate', '--force'], ['--i-reviewed', 'x']]) assert.throws(() => parseArgs(bad), /unknown option/, bad.join(' '));
  });
  it('accepts the documented forms and rejects mixed or misplaced flags', () => {
    assert.deepStrictEqual(parseArgs(['--migrate', '--project', '/a']).project, '/a');
    assert.strictEqual(parseArgs(['--resume']).resume, true);
    assert.strictEqual(parseArgs(['--migrate', '--resume']).verb, '--migrate');
    assert.strictEqual(parseArgs(['--restore', '/b']).restoreDir, '/b');
    assert.throws(() => parseArgs(['--migrate', '--runtime']), /one verb/);
    assert.throws(() => parseArgs(['--runtime', '--global']), /go with --migrate/);
    assert.throws(() => parseArgs(['--migrate', '--global', '--project', '/x']), /not both/);
    assert.throws(() => parseArgs(['--json', '--migrate']), /goes with --plan/);
    assert.throws(() => parseArgs(['--restore']), /needs a backup directory/);
  });
});

describe('consent gate', () => {
  it('refuses every apply verb inside a Claude Code session, prints the terminal command, and changes nothing', async () => {
    const m = machine();
    const state = snapshot(m.root);
    for (const argv of [['--migrate'], ['--migrate', '--global'], ['--resume'], ['--restore', '/x'], ['--permissions'], ['--runtime'], ['--deps']]) {
      const r = await run(m, argv, { env: { CLAUDECODE: '1' } });
      assert.strictEqual(r.code, 2, argv.join(' '));
      assert.match(r.err, /outside Claude Code/);
      // A terminal has no plugin bin/ on PATH, so the printed command is `node "<abs>/bin/rig-init" <verbs>`.
      assert.ok(r.err.includes('node "') && r.err.includes(`rig-init" ${argv.join(' ')}`), `prints the command: ${r.err}`);
      assert.deepStrictEqual(r.asked, [], 'never prompts');
    }
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('refuses without a TTY (no way to answer, no skip option)', async () => {
    const m = machine();
    const state = snapshot(m.root);
    const r = await run(m, ['--migrate'], { tty: false });
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /interactive terminal/);
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('answering no cancels and changes nothing', async () => {
    const m = machine();
    const state = snapshot(m.root);
    const r = await run(m, ['--migrate'], { answer: false });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Cancelled, nothing changed/);
    assert.strictEqual(r.asked.length, 1);
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('--plan is read-only and works inside Claude Code and without a TTY', async () => {
    const m = machine();
    const state = snapshot(m.root);
    const r = await run(m, ['--plan', '--json'], { env: { CLAUDECODE: '1' }, tty: false });
    assert.strictEqual(r.code, 0);
    const plan = JSON.parse(r.out);
    assert.deepStrictEqual(plan.targets.map((t) => t.kind), ['global', 'project']);
    assert.ok(plan.targets[0].moves.count > 600 && plan.targets[0].moves.sample.length === 10);
    assert.strictEqual(plan.permissions.needed > 0, true);
    assert.strictEqual(plan.claudeCode.status, 'ok');
    assert.deepStrictEqual(snapshot(m.root), state);
    const text = await run(m, ['--plan'], { tty: false });
    assert.match(text.out, /Global install[\s\S]*Project /);
  });

  it('the real bin refuses a non-terminal run and prints the command (spawned, HOME is a fixture)', () => {
    const m = machine({ project: false });
    const state = snapshot(m.root);
    const env = { ...process.env, HOME: m.home, USERPROFILE: m.home };
    delete env.CLAUDECODE;
    const res = spawnSync(process.execPath, [BIN, '--migrate', '--global'], { env, input: 'y\n', encoding: 'utf8', cwd: m.root });
    assert.strictEqual(res.status, 2);
    assert.match(res.stderr, /node "[^"]+[/\\\\]bin[/\\\\]rig-init" --migrate --global/);
    assert.deepStrictEqual(snapshot(m.root), state);
    const inside = spawnSync(process.execPath, [BIN, '--runtime'], { env: { ...env, CLAUDECODE: '1' }, input: 'y\n', encoding: 'utf8', cwd: m.root });
    assert.strictEqual(inside.status, 2);
    const plan = spawnSync(process.execPath, [BIN, '--plan', '--json'], { env, encoding: 'utf8', cwd: m.root });
    assert.strictEqual(plan.status, 0, plan.stderr);
    assert.ok(JSON.parse(plan.stdout).targets.length >= 1);
  });
});

describe('--migrate, --resume, --restore through the CLI', () => {
  it('migrates global and project after one confirmation; restore brings them back', async () => {
    const m = machine({ limit: 15 });
    const r = await run(m, ['--migrate']);
    assert.strictEqual(r.code, 0, r.err);
    assert.strictEqual(r.asked.length, 1, 'one confirmation for the whole plan');
    assert.match(r.out, /Global: done[\s\S]*Project .*: done/);
    assert.ok(!fs.existsSync(path.join(m.home, '.claude', 'hooks', 'session-init.cjs')));
    assert.ok(!fs.existsSync(path.join(m.project, '.claude', 'hooks', 'session-init.cjs')));
    assert.match(r.out, /rig-init --runtime/);
    const globalBackup = /Global: done, \d+ path\(s\) moved to (.+)/.exec(r.out)[1];
    const back = await run(m, ['--restore', globalBackup]);
    assert.strictEqual(back.code, 0, back.err);
    assert.match(back.out, /Restored \d+ path\(s\), 6 hook registration/);
    assert.ok(fs.existsSync(path.join(m.home, '.claude', 'hooks', 'session-init.cjs')));
    const none = await run(m, ['--migrate', '--global']);
    assert.strictEqual(none.code, 0);
  });

  it('exits 3 with the resume command when a path is in use, then --resume completes', async () => {
    const m = machine({ project: false, limit: 12 });
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' });
    const movePath = (src, dest) => { if (src.endsWith('statusline.cjs')) throw busy; return require('../backup-restore-standalone.cjs').movePath(src, dest); };
    const first = await run(m, ['--migrate', '--global'], { hooks: { movePath } });
    assert.strictEqual(first.code, 3);
    assert.match(first.err, /statusline\.cjs \(EBUSY\)[\s\S]*rig-init --migrate --resume/);
    assert.ok(findIncompleteBackup({ kind: 'global', home: m.home, root: m.home }));
    const again = await run(m, ['--migrate', '--global']);
    assert.strictEqual(again.code, 1, 'a fresh --migrate is refused while a journal is open');
    assert.match(again.err, /--resume/);
    const resumed = await run(m, ['--resume', '--global']);
    assert.strictEqual(resumed.code, 0, resumed.err);
    assert.strictEqual(findIncompleteBackup({ kind: 'global', home: m.home, root: m.home }), null);
    assert.ok(!fs.existsSync(path.join(m.home, '.claude', 'statusline.cjs')));
  });

  it('stops on a blocker (unparsable settings.json) before touching anything', async () => {
    const m = machine({ project: false, limit: 12 });
    fs.writeFileSync(path.join(m.home, '.claude', 'settings.json'), '{ nope');
    const state = snapshot(m.root);
    const r = await run(m, ['--migrate', '--global']);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /fix the blockers/);
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('--project needs an existing directory', async () => {
    const m = machine({ project: false });
    const r = await run(m, ['--migrate', '--project', path.join(m.root, 'missing')]);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /not found/);
  });
});

describe('--permissions and --runtime', () => {
  it('merges the template rules once, keeps the user\'s rules and other permission keys, and saves a backup', async () => {
    const m = machine({ project: false, limit: 5 });
    const file = path.join(m.home, '.claude', 'settings.json');
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = await run(m, ['--permissions']);
    assert.strictEqual(r.code, 0, r.err);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(after.permissions.allow, ['Bash(ls)']);
    assert.strictEqual(after.permissions.ask[0], 'Read(**/.env)');
    assert.strictEqual(new Set(after.permissions.ask).size, after.permissions.ask.length, 'no duplicates');
    assert.ok(after.permissions.deny.includes('Read(**/node_modules/**)'));
    assert.deepStrictEqual(after.hooks, before.hooks);
    assert.match(r.out, /Backup: .*user-settings/);
    const backup = /Backup: (.+)$/m.exec(r.out)[1];
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(backup, 'settings.json'), 'utf8')), before);
    const again = await run(m, ['--permissions']);
    assert.match(again.out, /already include every rule/);
    assert.strictEqual(missingRules(after).ask.length + missingRules(after).deny.length, 0);
  });

  it('creates settings.json when there is none, and refuses to overwrite one it cannot parse', async () => {
    const m = machine({ global: false, project: false });
    fs.mkdirSync(path.join(m.home, '.claude'), { recursive: true });
    assert.ok(applyPermissions({ home: m.home }).added > 10);
    fs.writeFileSync(path.join(m.home, '.claude', 'settings.json'), '{ broken');
    assert.throws(() => planPermissions({ home: m.home }), /cannot parse/);
    const r = await run(m, ['--permissions']);
    assert.strictEqual(r.code, 1);
    assert.strictEqual(fs.readFileSync(path.join(m.home, '.claude', 'settings.json'), 'utf8'), '{ broken');
  });

  it('writes the runtime copy and the statusLine, keeps a statusline the user chose, and replaces a 1.x Rig one', async () => {
    const m = machine({ project: false, limit: 5 });
    const file = path.join(m.home, '.claude', 'settings.json');
    // the fixture has the 1.x Rig statusLine: replaceable
    const r = await run(m, ['--runtime']);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /Runtime copied \(.*statusLine: set/);
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(settings.statusLine.command, 'node "$HOME/.claude/rig/runtime/statusline.cjs"');
    assert.ok(fs.existsSync(path.join(m.home, '.claude', 'rig', 'runtime', 'VERSION')));
    assert.ok(fs.existsSync(path.join(m.home, '.claude', 'rig', 'runtime', 'remote', 'worker.cjs')));
    // a second run changes nothing
    const again = applyRuntime({ home: m.home, pluginRoot: PLUGIN_ROOT });
    assert.strictEqual(again.statusLine, 'kept');
    assert.strictEqual(again.runtime.status, 'current');
    // the user's own statusline stays
    settings.statusLine = { type: 'command', command: 'node /me/line.js' };
    fs.writeFileSync(file, JSON.stringify(settings));
    const own = applyRuntime({ home: m.home, pluginRoot: PLUGIN_ROOT });
    assert.strictEqual(own.statusLine, 'user-statusline-kept');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine.command, 'node /me/line.js');
  });
});

describe('--deps and the version check', () => {
  it('asks first, runs the installer once, and reports a failing installer', async () => {
    const m = machine({ global: false, project: false });
    const calls = [];
    const ok = await run(m, ['--deps'], { runInstaller: (o) => { calls.push(o.pluginRoot); return 0; } });
    assert.strictEqual(ok.code, 0);
    assert.strictEqual(calls.length, 1);
    assert.match(ok.out, /run `rig-init --deps` again after every plugin update/);
    const declined = await run(m, ['--deps'], { answer: false, runInstaller: () => assert.fail('must not run') });
    assert.strictEqual(declined.code, 0);
    const bad = await run(m, ['--deps'], { runInstaller: () => 7 });
    assert.strictEqual(bad.code, 1);
    assert.match(bad.err, /status 7/);
  });

  it('builds the installer command per platform without -y or --with-sudo, and fails clearly when it is missing', () => {
    const win = installerCommand('win32', 'C:\\p\\skills');
    assert.strictEqual(win.cmd, 'powershell');
    assert.ok(win.args.some((a) => a.endsWith('install.ps1')) && !win.args.includes('-Y'));
    const nix = installerCommand('linux', '/p/skills');
    assert.deepStrictEqual(nix, { cmd: 'bash', args: [path.join('/p/skills', 'install.sh')] });
    assert.throws(() => runSkillsInstaller({ pluginRoot: tmpDir(), run: () => assert.fail('not started') }), /installer not found/);
    const calls = [];
    assert.strictEqual(runSkillsInstaller({ pluginRoot: PLUGIN_ROOT, platform: 'linux', run: (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; } }), 0);
    assert.strictEqual(calls[0][0], 'bash');
    assert.ok(!calls[0][1].includes('-y') && !calls[0][1].includes('--with-sudo'));
  });

  it('warns below 2.1.292 and notes an unreadable version', () => {
    const stub = (stdout, status = 0) => () => ({ stdout, status });
    assert.strictEqual(checkClaudeCodeVersion({ run: stub('2.1.291 (Claude Code)') }).status, 'old');
    assert.match(describeVersionCheck(checkClaudeCodeVersion({ run: stub('2.1.291 (Claude Code)') })), /older than 2\.1\.292/);
    assert.strictEqual(checkClaudeCodeVersion({ run: stub('2.1.292') }).status, 'ok');
    assert.strictEqual(checkClaudeCodeVersion({ run: stub('3.0.0') }).status, 'ok');
    assert.strictEqual(checkClaudeCodeVersion({ run: stub('garbage') }).status, 'unknown');
    assert.strictEqual(checkClaudeCodeVersion({ run: () => ({ error: new Error('ENOENT') }) }).status, 'unknown');
    assert.strictEqual(describeVersionCheck({ status: 'ok' }), null);
  });

  it('on Windows runs `claude --version` as one shell string with no args array (Node DEP0190 seen live on waso-vm)', () => {
    const calls = [];
    const run = (cmd, args, opts) => { calls.push({ cmd, args, shell: opts.shell }); return { status: 0, stdout: '2.1.318 (Claude Code)' }; };
    assert.strictEqual(checkClaudeCodeVersion({ run, platform: 'win32' }).status, 'ok');
    assert.strictEqual(checkClaudeCodeVersion({ run, platform: 'linux' }).status, 'ok');
    assert.deepStrictEqual(calls, [
      { cmd: 'claude --version', args: [], shell: true },
      { cmd: 'claude', args: ['--version'], shell: false },
    ]);
  });
});
