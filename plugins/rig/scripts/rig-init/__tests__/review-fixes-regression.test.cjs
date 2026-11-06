#!/usr/bin/env node
/** Regression tests for the P3 code-review findings (C1, H1-H5, M1-M3, lows). Fixture HOMEs only. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { spawnSync, execFileSync } = require('child_process');
const standalone = require('../backup-restore-standalone.cjs');
const { askYesNo, applyRefusal, isClaudeCodeProcess, readAncestry, movePath, restoreBackup, writeJsonAtomic } = standalone;
const cli = require('../cli.cjs');
const { planTarget, describeTarget, groupMoves, findIncompleteBackup, projectRootFor, planAll } = require('../migration-planner.cjs');
const { applyMigration, resumeMigration } = require('../migration-journal-applier.cjs');
const { applyPermissions } = require('../user-settings-permissions-and-runtime.cjs');
const { stripRigSettings } = require('../settings-rig-entries-stripper.cjs');
const { referencedRels } = require('../rig-1x-owned-paths.cjs');
const { makeMachine, snapshot, write, tmpDir, globalCmd, projectCmd } = require('./rig-init-fixtures.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(PLUGIN_ROOT, 'bin', 'rig-init');
const CLI = path.join(PLUGIN_ROOT, 'scripts', 'rig-init', 'cli.cjs');
const machines = [];
const machine = (opts) => { const m = makeMachine(opts); machines.push(m); return m; };
after(() => machines.forEach((m) => m.cleanup()));
const claude = (m) => path.join(m.home, '.claude');
const planG = (m) => planTarget({ kind: 'global', root: m.home, home: m.home });
const apply = (m, extra = {}) => applyMigration({ plan: planG(m), home: m.home, rigVersion: '2.0.0', ...extra });
const readSettings = (m) => JSON.parse(fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8'));
const writeSettings = (m, mutate) => { const s = readSettings(m); mutate(s); fs.writeFileSync(path.join(claude(m), 'settings.json'), JSON.stringify(s, null, 2)); };
const withoutBackups = (snap) => Object.fromEntries(Object.entries(snap).filter(([k]) => !k.startsWith('rig-backups')));
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

  it('the restore.cjs copy inside a backup accepts an answer as well', async () => {
    const m = machine({ project: false, limit: 12 });
    const result = apply(m);
    const copy = require(path.join(result.backupDir, 'restore.cjs'));
    const input = new PassThrough();
    const p = copy.askYesNo('Restore?', { input, output: new PassThrough() });
    input.write('y\n');
    assert.strictEqual(await p, true);
  });

  it('works on a real pty: rig-init --permissions answered y writes the rules (skipped without `script`)', (t) => {
    if (process.platform !== 'linux') return t.skip('pty check uses util-linux script');
    if (spawnSync('script', ['--version'], { encoding: 'utf8' }).error) return t.skip('`script` not installed');
    const m = machine({ project: false, limit: 5 });
    // The wrapper uses the REAL prompt on the pty; only the ancestry is injected (a test run inside Claude Code has Claude as ancestor)
    const wrapper = path.join(m.root, 'pty-main.cjs');
    fs.writeFileSync(wrapper, `require(${JSON.stringify(CLI)})._mainWithIo({ argv: ['--permissions'], home: ${JSON.stringify(m.home)}, env: {}, ancestors: [], checkVersion: () => ({ status: 'ok' }) }).then((c) => process.exit(c));\n`);
    const res = spawnSync('sh', ['-c', `(sleep 2; printf 'y\\r'; sleep 1) | script -qec "${process.execPath} ${wrapper}" /dev/null`], { encoding: 'utf8', timeout: 30000 });
    assert.match(res.stdout, /Added \d+ rule/, res.stdout);
    assert.ok(readSettings(m).permissions.deny.includes('Read(**/node_modules/**)'));
  });

  it('every apply verb of the real bin refuses piped input instead of prompting (stdin is not a TTY)', () => {
    const m = machine({ limit: 12 });
    const state = snapshot(m.root);
    for (const argv of [['--migrate'], ['--migrate', '--global'], ['--resume'], ['--restore', m.root], ['--permissions'], ['--runtime'], ['--deps']]) {
      const res = spawnSync(process.execPath, [BIN, ...argv], { env: cleanEnv(m), input: 'y\ny\ny\n', encoding: 'utf8', cwd: m.project });
      assert.strictEqual(res.status, 2, argv.join(' '));
      assert.match(res.stderr, /interactive terminal|outside Claude Code/, argv.join(' '));
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
    const tty = { env: {}, stdinIsTTY: true, stdoutIsTTY: true, command: 'rig-init --migrate' };
    const viaAncestor = applyRefusal({ ...tty, ancestors: [{ pid: 7, name: 'bash', args: [] }, { pid: 6, name: 'claude', args: [] }] });
    assert.match(viaAncestor, /parent process, pid 6, is Claude Code/);
    assert.strictEqual(applyRefusal({ ...tty, ancestors: [{ pid: 7, name: 'bash', args: [] }] }), null);
    assert.match(applyRefusal({ ...tty, ancestors: () => { throw new Error('no /proc'); } }), /could not check[\s\S]*no \/proc[\s\S]*refuses/);
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
    const win = readAncestry({ platform: 'win32', startPid: 100, run: () => ({ status: 0, stdout: JSON.stringify(rows) }) });
    assert.ok(win.some(isClaudeCodeProcess));
    assert.throws(() => readAncestry({ platform: 'win32', startPid: 1, run: () => ({ status: 1, stdout: '' }) }), /process query failed/);
  });

  it('end to end: `env -u CLAUDECODE` under a claude parent process is refused by the real bin (Linux)', (t) => {
    if (process.platform !== 'linux') return t.skip('needs /proc and a symlink named claude');
    const m = machine({ project: false, limit: 12 });
    const fakeClaude = path.join(m.root, 'claude');
    fs.symlinkSync(process.execPath, fakeClaude); // comm of this process is `claude`, like the real binary
    const state = snapshot(m.root);
    const code = `const r = require('child_process').spawnSync(process.execPath, [${JSON.stringify(BIN)}, '--runtime'], { env: process.env, encoding: 'utf8' }); process.stdout.write(JSON.stringify({ status: r.status, err: r.stderr }));`;
    const res = spawnSync(fakeClaude, ['-e', code], { env: cleanEnv(m), encoding: 'utf8' });
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.status, 2);
    assert.match(out.err, /parent process, pid \d+, is Claude Code/);
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('main() reads the real env, TTY and prompt: injected values are ignored; the injectable entry is separate', () => {
    const m = machine({ project: false, limit: 12 });
    const state = snapshot(m.root);
    const code = `require(${JSON.stringify(CLI)}).main({ argv: ['--runtime'], env: {}, stdinIsTTY: true, stdoutIsTTY: true, ask: async () => true, ancestors: [] }).then((c) => process.exit(c));`;
    const res = spawnSync(process.execPath, ['-e', code], { env: cleanEnv(m), encoding: 'utf8', input: '' });
    assert.strictEqual(res.status, 2, 'no verb in the real argv: usage, nothing applied');
    assert.deepStrictEqual(snapshot(m.root), state);
    assert.strictEqual(cli.main.length, 0);
    assert.strictEqual(typeof cli._mainWithIo, 'function');
  });
});

// ---------------------------------------------------------------- H2
describe('H2: a cross-device move never deletes the only complete copy', () => {
  const EXDEV = Object.assign(new Error('cross-device'), { code: 'EXDEV' });
  const files = (dir) => { try { return fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).length; } catch { return 0; } };

  /** Patches fs so renaming a node_modules dir into the backup fails with EXDEV, and removing it fails part-way until `release`. */
  function patchFs(state) {
    const rename = fs.renameSync;
    const rm = fs.rmSync;
    fs.renameSync = (from, to) => { if (/node_modules$/.test(from) && /rig-backups/.test(to)) throw EXDEV; return rename(from, to); };
    fs.rmSync = (p, opts) => {
      if (/node_modules$/.test(String(p)) && !/rig-backups/.test(String(p)) && !state.release) {
        const all = fs.readdirSync(p, { recursive: true }).map((f) => path.join(p, f)).filter((f) => fs.statSync(f).isFile());
        for (const f of all.slice(0, all.length - 1)) fs.unlinkSync(f); // 20 of 21 gone, one file "in use"
        throw Object.assign(new Error('file in use'), { code: 'EBUSY' });
      }
      return rm(p, opts);
    };
    return () => { fs.renameSync = rename; fs.rmSync = rm; };
  }

  it('reproduces the 20-of-21 loss scenario: the backup keeps all 21 files and resume only finishes removing the source', () => {
    const m = machine({ project: false, limit: 12 });
    const nm = path.join(claude(m), 'skills', 'browser', 'scripts', 'node_modules');
    for (let i = 0; i < 20; i++) write(path.join(nm, 'pkg', `f${i}.js`), `module.exports = ${i};\n`); // + dep/index.js = 21
    assert.strictEqual(files(nm), 21);
    const state = { release: false };
    const restoreFs = patchFs(state);
    let first;
    try {
      first = apply(m);
      assert.strictEqual(first.status, 'in-progress');
      assert.deepStrictEqual(first.blocked.map((b) => b.rel), ['skills/browser/scripts/node_modules']);
      const backupNm = path.join(first.backupDir, 'files', 'skills', 'browser', 'scripts', 'node_modules');
      assert.strictEqual(files(backupNm), 21, 'complete copy in the backup');
      assert.strictEqual(files(nm), 1, 'source is partial');
      const journal = JSON.parse(fs.readFileSync(path.join(first.backupDir, 'journal.json'), 'utf8'));
      assert.strictEqual(journal.moves.find((x) => x.rel.endsWith('node_modules')).copied, true, 'the journal records copy complete');
      state.release = true; // the file is no longer in use
      const resumed = resumeMigration({ backupDir: first.backupDir, home: m.home });
      assert.strictEqual(resumed.status, 'done');
      assert.strictEqual(files(backupNm), 21, 'resume did not delete or recopy the complete copy');
      assert.ok(!fs.existsSync(nm), 'source finally removed');
    } finally {
      restoreFs();
    }
  });

  it('a destination that already exists (crash between rename-in and the journal mark) is set aside, not deleted', () => {
    const root = tmpDir();
    const src = path.join(root, 'src');
    const dest = path.join(root, 'dest');
    for (const d of [src, dest]) for (let i = 0; i < 3; i++) write(path.join(d, `f${i}`), `${d}-${i}`);
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (from === src) throw EXDEV; return rename(from, to); };
    try {
      movePath(src, dest);
    } finally {
      fs.renameSync = rename;
    }
    assert.strictEqual(files(dest), 3);
    assert.strictEqual(files(`${dest}.prev`), 3, 'the earlier complete copy is kept');
    assert.ok(!fs.existsSync(src));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------- H3
describe('H3: symlinked owned directories are blockers, and a failing move never wedges the journal', () => {
  function symlinkDir(m, rel) {
    const dir = path.join(claude(m), rel);
    const outside = path.join(m.root, 'dotfiles', rel.replace(/\//g, '-'));
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.renameSync(dir, outside);
    fs.symlinkSync(outside, dir);
    return outside;
  }

  it('--plan reports a symlinked skills/ dir as a blocker and --migrate writes nothing', (t) => {
    if (process.platform === 'win32') return t.skip('symlink privileges');
    const m = machine({ project: false, limit: 12 });
    const outside = symlinkDir(m, 'skills');
    const before = snapshot(m.root);
    const plan = planG(m);
    assert.ok(plan.blockers.some((b) => /\.claude\/skills is a symlink/.test(b)), plan.blockers.join('|'));
    assert.match(describeTarget(plan), /BLOCKED: .*skills/);
    assert.throws(() => apply(m), /cannot migrate[\s\S]*skills/);
    assert.deepStrictEqual(snapshot(m.root), before, 'nothing written, no backup dir');
    assert.ok(fs.readdirSync(outside).length > 0, 'the link target is untouched');
  });

  it('a symlinked .claude/agents (or the .claude dir itself) is a blocker too', (t) => {
    if (process.platform === 'win32') return t.skip('symlink privileges');
    const m = machine({ project: false, limit: 12 });
    symlinkDir(m, 'agents');
    assert.ok(planG(m).blockers.some((b) => /agents/.test(b)));
    const n = machine({ project: false, limit: 12 });
    fs.renameSync(claude(n), path.join(n.root, 'real-claude'));
    fs.symlinkSync(path.join(n.root, 'real-claude'), claude(n));
    assert.ok(planG(n).blockers.some((b) => /\.claude is a symlink/.test(b)));
  });

  it('a path that turns into an escaping link mid-run is marked pending (not an abort) and resume finishes once it is fixed', (t) => {
    if (process.platform === 'win32') return t.skip('symlink privileges');
    const m = machine({ project: false, limit: 12 });
    const skillsFix = path.join(claude(m), 'skills', 'rig-plan');
    const outside = path.join(m.root, 'elsewhere');
    let parked;
    const result = apply(m, { hooks: { afterStep: (name) => {
      if (name !== 'write-settings:settings.json') return;
      parked = path.join(m.root, 'parked-fix');
      fs.renameSync(skillsFix, parked); // the dotfiles manager swaps the dir for a link after the plan
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, skillsFix);
    } } });
    assert.strictEqual(result.status, 'in-progress');
    assert.ok(result.blocked.some((b) => b.rel === 'skills/rig-plan/SKILL.md'), JSON.stringify(result.blocked));
    assert.ok(!fs.existsSync(path.join(claude(m), 'hooks', 'session-init.cjs')), 'the other paths moved');
    assert.ok(findIncompleteBackup({ kind: 'global', home: m.home, root: m.home }), 'resume stays possible');
    fs.rmSync(skillsFix); // user removes the link and puts the dir back
    fs.renameSync(parked, skillsFix);
    assert.strictEqual(resumeMigration({ backupDir: result.backupDir, home: m.home }).status, 'done');
  });
});

// ---------------------------------------------------------------- H4
describe('H4: Rig identity check and a prompt that names what moves', () => {
  it('generic Rig-looking names without a Rig marker are not migrated: plan says why, apply refuses, nothing changes', async () => {
    const m = machine({ project: false, limit: 12, marker: false });
    fs.writeFileSync(path.join(claude(m), 'metadata.json'), '{"name":"claudekit-engineer"}');
    const plan = planG(m);
    assert.strictEqual(plan.detected, false);
    assert.strictEqual(plan.identified, false);
    assert.ok(plan.unmarkedMatches > 5);
    assert.match(describeTarget(plan), /no Rig 1\.x install marker[\s\S]*another kit/);
    assert.throws(() => apply(m), /nothing to migrate/);
    const state = snapshot(m.root);
    const out = [];
    const code = await cli._mainWithIo({ argv: ['--migrate', '--global'], env: {}, home: m.home, cwd: m.root, stdinIsTTY: true, stdoutIsTTY: true, ancestors: [], ask: async () => assert.fail('no prompt for a foreign install'), stdout: (x) => out.push(x), stderr: () => {}, checkVersion: () => ({ status: 'ok' }) });
    assert.strictEqual(code, 0);
    assert.match(out.join('\n'), /no Rig 1\.x install marker/);
    assert.deepStrictEqual(snapshot(m.root), state);
  });

  it('either marker identifies a Rig 1.x install: metadata.json named rig, or hooks/lib/rig-config-utils.cjs', () => {
    const a = machine({ project: false, limit: 12, marker: false });
    fs.writeFileSync(path.join(claude(a), 'metadata.json'), '{"name":"rig"}');
    assert.strictEqual(planG(a).identified, true);
    const b = machine({ project: false, limit: 12, marker: false });
    write(path.join(claude(b), 'hooks', 'lib', 'rig-config-utils.cjs'), '//');
    assert.strictEqual(planG(b).identified, true);
  });

  it('the prompt text groups the moved paths by directory with counts, and the full list lands in the backup', () => {
    const m = machine({ project: false });
    const plan = planG(m);
    const text = describeTarget(plan);
    assert.match(text, /paths by directory:[\s\S]*\n {4}hooks +\d+/);
    assert.match(text, /\n {4}skills\/fix +\d+/);
    assert.match(text, /moved-paths\.txt/);
    assert.deepStrictEqual(groupMoves([{ rel: 'hooks/a' }, { rel: 'hooks/b' }, { rel: 'skills/x/SKILL.md' }, { rel: 'metadata.json' }]), [['(top level files)', 1], ['hooks', 2], ['skills/x', 1]]);
    const result = apply(m);
    const listed = fs.readFileSync(result.listFile, 'utf8').trim().split('\n');
    assert.strictEqual(listed.length, plan.moves.length);
    assert.ok(path.dirname(result.listFile) === result.backupDir);
  });
});

// ---------------------------------------------------------------- H5
describe('H5: every command form is recognized, and leftover references block the migration', () => {
  const G = { kind: 'global', root: '/home/u' };

  it('removes a Rig hook written with flags, absolute node, node.exe, NODE_OPTIONS, USERPROFILE, CLAUDE_CONFIG_DIR, ~ or separators', () => {
    const forms = [
      'node --no-warnings "$HOME/.claude/hooks/session-init.cjs"', '/usr/bin/node "$HOME/.claude/hooks/session-init.cjs"',
      'node.exe "%USERPROFILE%\\.claude\\hooks\\session-init.cjs"', 'NODE_OPTIONS=--max-old-space-size=512 node ~/.claude/hooks/session-init.cjs',
      'node $USERPROFILE/.claude/hooks/session-init.cjs', 'node $CLAUDE_CONFIG_DIR/hooks/session-init.cjs', 'node "${HOME}/.claude/hooks/session-init.cjs" --flag',
      'node /home/u/.claude/hooks/session-init.cjs', 'cd /tmp && node "$HOME/.claude/hooks/session-init.cjs"',
    ];
    for (const command of forms) {
      const { removedHooks } = stripRigSettings({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }, G);
      assert.strictEqual(removedHooks.length, 1, command);
    }
    for (const command of ['node /mnt/home/u/.claude/hooks/session-init.cjs', 'node /opt/mine.js', 'node "$HOME/.claude/hooks/my-own-hook.cjs"']) {
      assert.strictEqual(stripRigSettings({ hooks: { Stop: [{ hooks: [{ command }] }] } }, G).removedHooks.length, 0, command);
    }
    assert.deepStrictEqual(referencedRels('x "$HOME"/.claude/scripts/worktree.cjs;y', G), ['scripts/worktree.cjs']);
  });

  it('a home reached through a symlinked path is matched in its real and its lexical spelling', (t) => {
    if (process.platform === 'win32') return t.skip('symlink privileges');
    const m = machine({ project: false, limit: 12 });
    const link = path.join(m.root, 'home-link');
    fs.symlinkSync(m.home, link);
    const target = { kind: 'global', root: link };
    for (const base of [m.home, link]) assert.strictEqual(referencedRels(`node ${base}/.claude/hooks/session-init.cjs`, target).length, 1, base);
  });

  it('settings that still run a moved file (mcpServers, env, a notification hook script) are blockers naming the reference; plan and apply refuse', () => {
    const m = machine({ project: false, limit: 12 });
    writeSettings(m, (s) => {
      s.mcpServers = { wt: { command: 'node', args: ['~/.claude/hooks/lib/rig-config-utils.cjs'] } };
      s.env = { LINE: '$HOME/.claude/statusline.cjs' };
      s.permissions.ask.push('Read(~/.claude/hooks/**)'); // permission patterns are not commands: no blocker
    });
    const plan = planG(m);
    const joined = plan.blockers.join('\n');
    assert.match(joined, /settings\.json mcpServers\.wt\.args\[0\] runs or reads \.claude\/hooks\/lib\/rig-config-utils\.cjs/);
    assert.match(joined, /settings\.json env\.LINE .*statusline\.cjs/);
    assert.ok(!/permissions/.test(joined));
    const before = snapshot(m.root);
    assert.throws(() => apply(m), /cannot migrate/);
    assert.deepStrictEqual(snapshot(m.root), before);
    writeSettings(m, (s) => { delete s.mcpServers; delete s.env; });
    assert.deepStrictEqual(planG(m).blockers, []);
    assert.strictEqual(apply(m).status, 'done');
  });

  it('a project .mcp.json and the global ~/.claude.json mcpServers are scanned as well', () => {
    const m = machine({ limit: 12 });
    fs.writeFileSync(path.join(m.project, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'node', args: ['.claude/hooks/lib/rig-config-utils.cjs'] } } }));
    const project = planTarget({ kind: 'project', root: m.project, home: m.home });
    assert.ok(project.blockers.some((b) => /^\.mcp\.json /.test(b)), project.blockers.join('|'));
    fs.writeFileSync(path.join(m.home, '.claude.json'), JSON.stringify({ mcpServers: { a: { command: '$HOME/.claude/hooks/lib/rig-config-utils.cjs' } }, history: ['~/.claude/scripts/not-scanned.cjs'] }));
    assert.ok(planG(m).blockers.some((b) => /^\.claude\.json mcpServers\.user\.a\.command/.test(b)));
    assert.ok(!planG(m).blockers.some((b) => /not-scanned/.test(b)), 'only mcpServers of .claude.json');
  });

  it('references to what stays (the shared venv, the user\'s own skill) are not blockers', () => {
    const m = machine({ project: false, limit: 12 });
    writeSettings(m, (s) => { s.hooks.Notification = [{ hooks: [{ type: 'command', command: '"$HOME/.claude/skills/.venv/bin/python3" "$HOME/.claude/skills/my-skill/notify.py"' }] }]; });
    assert.deepStrictEqual(planG(m).blockers, []);
  });
});

// ---------------------------------------------------------------- M1 / M2 / M3
describe('M1: only Rig-generated dirs move; the shared venv stays', () => {
  it('leaves the user\'s node_modules and __pycache__ in non-Rig dirs, and the venv, and moves Rig\'s own beside owned files', () => {
    const m = machine({ project: false, limit: Infinity });
    write(path.join(claude(m), 'hooks', 'my-hooks', 'node_modules', 'x', 'index.js'), '1');
    write(path.join(claude(m), 'hooks', 'my-hooks', 'index.js'), '1');
    write(path.join(claude(m), 'skills', 'my-skill', '__pycache__', 'a.pyc'), '1');
    write(path.join(claude(m), 'scripts', '__pycache__', 'resolve_env.cpython-312.pyc'), '1'); // beside the owned resolve_env.py
    const plan = planG(m);
    const moved = new Set(plan.moves.map((x) => x.rel));
    assert.ok(!moved.has('hooks/my-hooks/node_modules') && !moved.has('skills/my-skill/__pycache__') && !moved.has('skills/.venv'));
    assert.ok(moved.has('scripts/__pycache__') && moved.has('skills/browser/scripts/node_modules'));
    assert.ok(plan.leftInPlace[0].includes('shared venv'));
    apply(m);
    for (const keep of ['hooks/my-hooks/node_modules/x/index.js', 'hooks/my-hooks/index.js', 'skills/my-skill/__pycache__/a.pyc', 'skills/.venv/pyvenv.cfg']) assert.ok(fs.existsSync(path.join(claude(m), keep)), keep);
  });
});

describe('M2: stale plans, the moved count and the lock heartbeat', () => {
  it('a plan made before another run crashed cannot start a second backup, and `moved` counts only real moves', () => {
    const m = machine({ project: false, limit: 12 });
    const stale = planG(m);
    let n = 0;
    assert.throws(() => apply(m, { hooks: { afterStep: () => { if (n++ === 7) throw new Error('crash'); } } }), /crash/);
    assert.throws(() => applyMigration({ plan: stale, home: m.home, rigVersion: '2.0.0' }), /--resume/);
    const group = stale.backupGroup;
    assert.strictEqual(fs.readdirSync(group).length, 1, 'still one backup');
    const journal = JSON.parse(fs.readFileSync(path.join(group, fs.readdirSync(group)[0], 'journal.json'), 'utf8'));
    const left = journal.moves.filter((x) => fs.existsSync(path.join(claude(m), ...x.rel.split('/')))).length;
    const resumed = resumeMigration({ backupDir: path.join(group, fs.readdirSync(group)[0]), home: m.home });
    assert.strictEqual(resumed.moved, left, 'skipped (already moved) paths are not counted');
    assert.ok(left < journal.moves.length);
  });

  it('refreshes the lock dir while moving, so a long run does not look stale', () => {
    const m = machine({ project: false, limit: 12 });
    const lock = `${planG(m).backupGroup}.lock`;
    let seen = null;
    apply(m, { hooks: { afterStep: (name) => {
      if (name === 'journal') { const old = new Date(Date.now() - 3600 * 1000); fs.utimesSync(lock, old, old); }
      if (name === 'finish') seen = Date.now() - fs.statSync(lock).mtimeMs;
    } } });
    assert.ok(seen < 60 * 1000, `lock age ${seen} ms after the moves`);
  });
});

describe('M3: a symlinked settings.json stays a symlink in every writer', () => {
  function linkSettings(m) {
    const real = path.join(m.root, 'dotfiles', 'settings.json');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.renameSync(path.join(claude(m), 'settings.json'), real);
    fs.symlinkSync(real, path.join(claude(m), 'settings.json'));
    return real;
  }
  it('--permissions, migrate and restore write the link target', (t) => {
    if (process.platform === 'win32') return t.skip('symlink privileges');
    const m = machine({ project: false, limit: 12 });
    const real = linkSettings(m);
    const link = path.join(claude(m), 'settings.json');
    applyPermissions({ home: m.home });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'link survived --permissions');
    assert.ok(JSON.parse(fs.readFileSync(real, 'utf8')).permissions.deny.includes('Read(**/node_modules/**)'));
    const result = apply(m);
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'link survived the migration');
    assert.strictEqual(JSON.parse(fs.readFileSync(real, 'utf8')).hooks && Object.keys(JSON.parse(fs.readFileSync(real, 'utf8')).hooks).includes('Stop'), false);
    restoreBackup({ backupDir: result.backupDir, home: m.home });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'link survived the restore');
    assert.ok(JSON.parse(fs.readFileSync(real, 'utf8')).hooks.Stop);
    writeJsonAtomic(link, { a: 1 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { a: 1 });
  });
});

// ---------------------------------------------------------------- Lows
describe('lows', () => {
  it('L1: restore does not re-register a hook whose path now holds a different user file', () => {
    const m = machine({ project: false, limit: 12 });
    const result = apply(m);
    write(path.join(claude(m), 'hooks', 'session-init.cjs'), '// the user\'s own file');
    const report = restoreBackup({ backupDir: result.backupDir, home: m.home });
    assert.ok(report.conflicts.includes('hooks/session-init.cjs'));
    const commands = Object.values(readSettings(m).hooks).flatMap((es) => es.flatMap((e) => e.hooks.map((h) => h.command)));
    assert.ok(!commands.includes(globalCmd('hooks/session-init.cjs')));
    assert.ok(commands.includes(globalCmd('hooks/verify-completion-guard.cjs')));
  });

  it('L2: an unparsable settings file stops restore before any file moves', () => {
    const m = machine({ project: false, limit: 12 });
    const result = apply(m);
    fs.writeFileSync(path.join(claude(m), 'settings.json'), '{ broken');
    const state = withoutBackups(snapshot(claude(m)));
    assert.throws(() => restoreBackup({ backupDir: result.backupDir, home: m.home }), /cannot parse/);
    assert.deepStrictEqual(withoutBackups(snapshot(claude(m))), state);
  });

  it('L3: a settings file that disappears between plan and apply does not crash apply or leave an empty backup', () => {
    const m = machine({ project: false, limit: 12 });
    const stale = planG(m);
    fs.rmSync(path.join(claude(m), 'settings.json'));
    const result = applyMigration({ plan: stale, home: m.home, rigVersion: '2.0.0' });
    assert.strictEqual(result.status, 'done');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(result.backupDir, 'journal.json'), 'utf8')).settings, []);
  });

  it('L4: run from a subdirectory, the project root is the git top-level', () => {
    const m = machine({ global: false, limit: 12 });
    execFileSync('git', ['-C', m.project, 'init', '-q']);
    const sub = path.join(m.project, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    // .native: git reports the long form of a Windows 8.3 temp path; plain realpathSync keeps the short one
    assert.strictEqual(projectRootFor(fs.realpathSync.native(sub)), fs.realpathSync.native(m.project));
    assert.deepStrictEqual(planAll({ home: m.home, cwd: sub }).map((p) => p.kind), ['project']);
  });

  it('L5: restore into a project that no longer exists refuses and does not recreate it', () => {
    const m = machine({ global: false, limit: 12 });
    const result = applyMigration({ plan: planTarget({ kind: 'project', root: m.project, home: m.home }), home: m.home, rigVersion: '2.0.0' });
    fs.rmSync(m.project, { recursive: true, force: true });
    assert.throws(() => restoreBackup({ backupDir: result.backupDir, home: m.home }), /no longer exists/);
    assert.ok(!fs.existsSync(m.project));
  });

  it('L6: --permissions refuses a malformed permissions.ask instead of replacing it', () => {
    const m = machine({ project: false, limit: 12 });
    writeSettings(m, (s) => { s.permissions.ask = 'Read(**/.env)'; });
    const before = fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8');
    assert.throws(() => applyPermissions({ home: m.home }), /permissions\.ask .* not an array/);
    assert.strictEqual(fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8'), before);
  });

  it('projects: project command forms still strip with the widened matcher', () => {
    const { removedHooks } = stripRigSettings({ hooks: { Stop: [{ hooks: [{ command: projectCmd('hooks/verify-completion-guard.cjs') }] }] } }, { kind: 'project', root: '/work/app' });
    assert.strictEqual(removedHooks.length, 1);
    assert.ok(os.platform());
  });
});
