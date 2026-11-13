#!/usr/bin/env node
/** Tests for the rig-init CLI: removed 1.x verbs, consent gate, --plan, permissions, runtime, deps, the real bin. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { _mainWithIo: main, parseArgs, pendingMigrations, HELP } = require('../cli.cjs');
const { applyPermissions, applyRuntime, planPermissions, missingRules } = require('../user-settings-permissions-and-runtime.cjs');
const { checkClaudeCodeVersion, describeVersionCheck } = require('../cc-version-check.cjs');
const { isRig1xStatusLineCommand } = require('../rig-statusline-command.cjs');
const { installerCommand, runSkillsInstaller } = require('../skills-dependency-installer-runner.cjs');
const { makeMachine, snapshot, tmpDir, write } = require('./rig-init-fixtures.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(PLUGIN_ROOT, 'bin', 'rig-init');
const machines = [];
const machine = (opts) => { const m = makeMachine(opts); machines.push(m); return m; };
after(() => machines.forEach((m) => m.cleanup()));

/** Drives main() with captured output; defaults to a real terminal outside Claude Code that answers `answer`. */
async function run(m, argv, { env = {}, tty = true, answer = true, runInstaller } = {}) {
  const out = [];
  const err = [];
  const asked = [];
  const code = await main({
    argv, env, home: m.home, ancestors: [], stdinIsTTY: tty, stdoutIsTTY: tty, pluginRoot: PLUGIN_ROOT, runInstaller,
    stdout: (s) => out.push(s), stderr: (s) => err.push(s),
    ask: async (q) => { asked.push(q); return answer; },
    checkVersion: () => ({ status: 'ok', version: '2.1.318', min: '2.1.292' }),
  });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}

describe('argument parsing', () => {
  it('has no --yes or any other skip-consent option', () => {
    for (const bad of [['--yes'], ['-y'], ['--runtime', '--yes'], ['--permissions', '--force'], ['--i-reviewed', 'x']]) assert.throws(() => parseArgs(bad), /unknown option/, bad.join(' '));
  });
  it('accepts the kept verbs and rejects mixed or misplaced flags', () => {
    for (const verb of ['--plan', '--permissions', '--runtime', '--deps']) assert.strictEqual(parseArgs([verb]).verb, verb);
    assert.strictEqual(parseArgs(['--plan', '--json']).json, true);
    assert.throws(() => parseArgs(['--permissions', '--runtime']), /one verb/);
    assert.throws(() => parseArgs(['--json', '--runtime']), /goes with --plan/);
  });
});

describe('removed 1.x migration verbs', () => {
  it('each exits 2 with the 2.0.10 route, before the consent gate, and changes nothing', async () => {
    const m = machine();
    const state = snapshot(m.root);
    for (const argv of [['--migrate'], ['--migrate', '--global'], ['--resume'], ['--restore', '/x'], ['--project', '/p'], ['--global']]) {
      for (const env of [{}, { CLAUDECODE: '1' }]) {
        const r = await run(m, argv, { env });
        assert.strictEqual(r.code, 2, argv.join(' '));
        assert.match(r.err, /1\.x migration was removed in 2\.1\.0[\s\S]*Rig 2\.0\.10: https:\/\/github\.com\/hoadh\/rig\/blob\/main\/docs\/how-to\/migrate-from-rig-1x\.md/);
        assert.doesNotMatch(r.err, /Usage:/);
        assert.deepStrictEqual(r.asked, []);
      }
    }
    assert.deepStrictEqual(snapshot(m.root), state);
  });
  it('--help lists only --plan, --permissions, --runtime, --deps', () => {
    for (const gone of ['--migrate', '--resume', '--restore', '--global', '--project']) assert.ok(!HELP.includes(gone), gone);
    for (const kept of ['--plan', '--permissions', '--runtime', '--deps']) assert.ok(HELP.includes(kept), kept);
  });
});

describe('consent gate', () => {
  it('refuses every apply verb inside a Claude Code session, prints the terminal command, and changes nothing', async () => {
    const m = machine();
    const state = snapshot(m.root);
    for (const argv of [['--permissions'], ['--runtime'], ['--deps']]) {
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
    const r = await run(m, ['--permissions'], { tty: false });
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /interactive terminal/);
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('answering no cancels and changes nothing', async () => {
    const m = machine();
    const state = snapshot(m.root);
    const r = await run(m, ['--permissions'], { answer: false });
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
    assert.deepStrictEqual(Object.keys(plan).sort(), ['claudeCode', 'home', 'pendingMigrations', 'permissions', 'rigInitVersion', 'runtime']);
    assert.strictEqual(plan.permissions.needed > 0, true);
    assert.strictEqual(plan.runtime.statusLine, 'rig');
    assert.strictEqual(plan.claudeCode.status, 'ok');
    assert.deepStrictEqual(plan.pendingMigrations, []);
    assert.deepStrictEqual(snapshot(m.root), state);
    const text = await run(m, ['--plan'], { tty: false });
    assert.match(text.out, /Permissions \(--permissions\)[\s\S]*Runtime \(--runtime\)/);
    assert.doesNotMatch(text.out, /1\.x Rig install/);
  });

  it('--plan names an unfinished 2.0.x migration with its scope, the 2.0.10 resume and the restore.cjs commands', async () => {
    const m = machine();
    const backups = path.join(m.home, '.claude', 'rig-backups');
    const globalDir = path.join(backups, 'global', '261101-120000');
    const projectDir = path.join(backups, 'a1b2c3d4e5f6', '261101-130000');
    write(path.join(globalDir, 'journal.json'), '{"schema":1,"id":"a","status":"in-progress","kind":"global","root":"/h"}');
    write(path.join(projectDir, 'journal.json'), '{"schema":1,"id":"p","status":"in-progress","kind":"project","root":"/work/my app"}');
    write(path.join(backups, 'global', '261101-110000', 'journal.json'), '{"schema":1,"id":"b","status":"done"}');
    const restored = path.join(backups, 'global', '261101-100000');
    write(path.join(restored, 'journal.json'), '{"schema":1,"id":"r","status":"in-progress","kind":"global"}');
    write(path.join(restored, 'restored.json'), '{}');
    write(path.join(backups, 'user-settings', '261101-100000', 'settings.json'), '{}');
    assert.deepStrictEqual(pendingMigrations(m.home), [
      { dir: projectDir, kind: 'project', root: '/work/my app' },
      { dir: globalDir, kind: 'global', root: '/h' },
    ]);
    const r = await run(m, ['--plan'], { tty: false });
    assert.match(r.out, /migration of ~\/\.claude is unfinished[\s\S]*Install Rig 2\.0\.10 \(https:[^)]+\) and run its `rig-init --migrate --resume --global`[\s\S]*node ".*261101-120000.restore\.cjs"/);
    assert.match(r.out, /migration of the project \/work\/my app is unfinished[\s\S]*--resume --project "\/work\/my app"`/);
    assert.doesNotMatch(r.out, /261101-100000/, 'a restored backup is not pending');
    assert.strictEqual(JSON.parse((await run(m, ['--plan', '--json'], { tty: false })).out).pendingMigrations.length, 2);
  });

  it('the real bin refuses a non-terminal run and prints the command (spawned, HOME is a fixture)', () => {
    const m = machine();
    const state = snapshot(m.root);
    const env = { ...process.env, HOME: m.home, USERPROFILE: m.home };
    delete env.CLAUDECODE;
    const res = spawnSync(process.execPath, [BIN, '--permissions'], { env, input: 'y\n', encoding: 'utf8', cwd: m.root });
    assert.strictEqual(res.status, 2);
    assert.match(res.stderr, /node "[^"]+[/\\\\]bin[/\\\\]rig-init" --permissions/);
    assert.deepStrictEqual(snapshot(m.root), state);
    const inside = spawnSync(process.execPath, [BIN, '--runtime'], { env: { ...env, CLAUDECODE: '1' }, input: 'y\n', encoding: 'utf8', cwd: m.root });
    assert.strictEqual(inside.status, 2);
    const removed = spawnSync(process.execPath, [BIN, '--migrate', '--global'], { env, encoding: 'utf8', cwd: m.root });
    assert.strictEqual(removed.status, 2);
    assert.match(removed.stderr, /removed in 2\.1\.0/);
    const plan = spawnSync(process.execPath, [BIN, '--plan', '--json'], { env, encoding: 'utf8', cwd: m.root });
    assert.strictEqual(plan.status, 0, plan.stderr);
    assert.ok(JSON.parse(plan.stdout).permissions);
  });
});

describe('--permissions and --runtime', () => {
  it('merges the template rules once, keeps the user\'s rules and other permission keys, and saves a backup', async () => {
    const m = machine();
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
    const m = machine({ settings: false });
    fs.mkdirSync(path.join(m.home, '.claude'), { recursive: true });
    assert.ok(applyPermissions({ home: m.home }).added > 10);
    fs.writeFileSync(path.join(m.home, '.claude', 'settings.json'), '{ broken');
    assert.throws(() => planPermissions({ home: m.home }), /cannot parse/);
    const r = await run(m, ['--permissions']);
    assert.strictEqual(r.code, 1);
    assert.strictEqual(fs.readFileSync(path.join(m.home, '.claude', 'settings.json'), 'utf8'), '{ broken');
  });

  it('writes the runtime copy and the statusLine, keeps a statusline the user chose, and replaces a 1.x Rig one', async () => {
    const m = machine();
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

describe('1.x statusLine recognizer', () => {
  it('matches every root spelling of <home>/.claude/statusline.cjs and nothing else', () => {
    const home = '/h';
    for (const c of ['node "$HOME/.claude/statusline.cjs"', 'node ${HOME}/.claude/statusline.cjs', 'node ~/.claude/statusline.cjs', 'node /h/.claude/statusline.cjs',
      'node %USERPROFILE%\\.claude\\statusline.cjs', 'node "$CLAUDE_CONFIG_DIR/statusline.cjs"']) assert.ok(isRig1xStatusLineCommand(c, home), c);
    for (const c of ['node /other/.claude/statusline.cjs', 'node "$HOME/.claude/rig/runtime/statusline.cjs"', 'node /me/line.js', 'node ~/.claude/statusline.cjs.bak', null]) {
      assert.ok(!isRig1xStatusLineCommand(c, home), String(c));
    }
  });

  it('matches a home reached through a symlink in its real and its lexical spelling', (t) => {
    if (process.platform === 'win32') return t.skip('symlink privileges');
    const real = tmpDir();
    const link = path.join(tmpDir(), 'home-link');
    fs.symlinkSync(real, link);
    assert.ok(isRig1xStatusLineCommand(`node ${link}/.claude/statusline.cjs`, link));
    assert.ok(isRig1xStatusLineCommand(`node ${real}/.claude/statusline.cjs`, link));
  });
});

describe('--deps and the version check', () => {
  it('asks first, runs the installer once, and reports a failing installer', async () => {
    const m = machine({ settings: false });
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
