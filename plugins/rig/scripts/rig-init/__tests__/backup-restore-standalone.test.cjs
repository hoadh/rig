#!/usr/bin/env node
/** Tests for restore: round trip keeping later user changes, plugin-enabled refusal, containment, standalone copy. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { planTarget } = require('../migration-planner.cjs');
const { applyMigration } = require('../migration-journal-applier.cjs');
const { restoreBackup, readJsonFile, writeJsonAtomic } = require('../backup-restore-standalone.cjs');
const { makeMachine, snapshot, write, danglingCommands, USER_HOOK_COMMAND, globalCmd } = require('./rig-init-fixtures.cjs');

const machines = [];
after(() => machines.forEach((m) => m.cleanup()));

/** A machine with a migrated global install; returns helpers. */
function migrated(opts = {}) {
  const m = makeMachine({ project: false, limit: opts.limit || Infinity });
  machines.push(m);
  const before = snapshot(path.join(m.home, '.claude'));
  const result = applyMigration({ plan: planTarget({ kind: 'global', root: m.home, home: m.home }), home: m.home, rigVersion: '2.0.0' });
  const claude = path.join(m.home, '.claude');
  return { m, before, backup: result.backupDir, claude, settingsFile: path.join(claude, 'settings.json') };
}

const stripBackups = (snap) => Object.fromEntries(Object.entries(snap).filter(([k]) => !k.startsWith('rig-backups')));

describe('restore round trip', () => {
  it('restores when HOME is reached through a symlink (macOS /tmp -> /private/tmp): the backup records the real path', (t) => {
    const m = makeMachine({ project: false });
    machines.push(m);
    const linkHome = path.join(m.root, 'home-link');
    try { fs.symlinkSync(m.home, linkHome, 'dir'); } catch (err) { t.skip(`cannot create a symlink here (${err.code})`); return; }
    const claude = path.join(linkHome, '.claude');
    const before = snapshot(claude);
    const result = applyMigration({ plan: planTarget({ kind: 'global', root: linkHome, home: linkHome }), home: linkHome, rigVersion: '2.0.0' });
    assert.notDeepStrictEqual(stripBackups(snapshot(claude)), stripBackups(before), 'the migration moved files');
    const report = restoreBackup({ backupDir: result.backupDir, home: linkHome });
    assert.ok(report.moved > 0);
    assert.strictEqual(report.hooksRestored, 6);
    assert.ok(report.statusLineRestored);
    const after = stripBackups(snapshot(claude));
    for (const [key, value] of Object.entries(stripBackups(before))) if (key !== 'settings.json') assert.strictEqual(after[key], value, key);
  });

  it('puts every file and the Rig hooks back and keeps the user\'s settings changes made after the migration', () => {
    const { m, before, backup, claude, settingsFile } = migrated();
    // user changes after migration: new key, changed key, a new own hook, removed their old hook
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    s.theme = 'light';
    s.env = { FOO: '1' };
    s.hooks = { Notification: [{ hooks: [{ type: 'command', command: 'node /opt/notify.js' }] }] };
    fs.writeFileSync(settingsFile, JSON.stringify(s));

    const report = restoreBackup({ backupDir: backup, home: m.home });
    assert.strictEqual(report.conflicts.length, 0);
    assert.strictEqual(report.hooksRestored, 6);
    assert.ok(report.statusLineRestored);

    // files: identical to the original install
    const after = stripBackups(snapshot(claude));
    for (const [key, value] of Object.entries(stripBackups(before))) if (key !== 'settings.json') assert.strictEqual(after[key], value, key);
    // settings: Rig back, the user's later changes intact, the hook they removed stays removed
    const restored = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.strictEqual(restored.theme, 'light');
    assert.deepStrictEqual(restored.env, { FOO: '1' });
    assert.strictEqual(restored.model, 'sonnet');
    assert.ok(restored.hooks.Notification[0].hooks.some((h) => h.command === 'node /opt/notify.js'));
    const commands = Object.values(restored.hooks).flatMap((es) => es.flatMap((e) => e.hooks.map((h) => h.command)));
    assert.ok(commands.includes(globalCmd('hooks/session-init.cjs')) && commands.includes(globalCmd('hooks/verify-completion-guard.cjs')));
    assert.ok(!commands.includes(USER_HOOK_COMMAND), 'the user hook removed after the migration is not resurrected');
    assert.strictEqual(restored.statusLine.command, globalCmd('statusline.cjs'));
    assert.deepStrictEqual(danglingCommands(claude, m.home), []);
    assert.ok(fs.existsSync(path.join(backup, 'restored.json')));
  });

  it('keeps a statusLine the user chose after the migration, and replaces the plugin runtime statusline', () => {
    const a = migrated({ limit: 12 });
    const sa = JSON.parse(fs.readFileSync(a.settingsFile, 'utf8'));
    sa.statusLine = { type: 'command', command: 'node /me/line.js' };
    fs.writeFileSync(a.settingsFile, JSON.stringify(sa));
    assert.ok(restoreBackup({ backupDir: a.backup, home: a.m.home }).statusLineKept);
    assert.strictEqual(JSON.parse(fs.readFileSync(a.settingsFile, 'utf8')).statusLine.command, 'node /me/line.js');

    const b = migrated({ limit: 12 });
    const sb = JSON.parse(fs.readFileSync(b.settingsFile, 'utf8'));
    sb.statusLine = { type: 'command', command: 'node "$HOME/.claude/rig/runtime/statusline.cjs"' };
    fs.writeFileSync(b.settingsFile, JSON.stringify(sb));
    assert.ok(restoreBackup({ backupDir: b.backup, home: b.m.home }).statusLineRestored);
  });

  it('never overwrites a file that exists at the destination now (conflict, stays in the backup)', () => {
    const { m, backup, claude } = migrated({ limit: 12 });
    write(path.join(claude, 'agents', 'debugger.md'), 'my new debugger');
    const report = restoreBackup({ backupDir: backup, home: m.home });
    assert.deepStrictEqual(report.conflicts, ['agents/debugger.md']);
    assert.strictEqual(fs.readFileSync(path.join(claude, 'agents', 'debugger.md'), 'utf8'), 'my new debugger');
    assert.ok(fs.existsSync(path.join(backup, 'files', 'agents', 'debugger.md')));
  });

  it('is repeatable: a second restore moves nothing and changes nothing', () => {
    const { m, backup, claude } = migrated({ limit: 12 });
    restoreBackup({ backupDir: backup, home: m.home });
    const state = stripBackups(snapshot(claude));
    const again = restoreBackup({ backupDir: backup, home: m.home });
    assert.strictEqual(again.moved, 0);
    assert.strictEqual(again.hooksRestored, 0);
    assert.deepStrictEqual(stripBackups(snapshot(claude)), state);
  });
});

describe('restore requires the plugin to be disabled', () => {
  it('refuses while rig@... is enabled in user settings, and tells how to disable it; nothing changes', () => {
    const { m, backup, claude, settingsFile } = migrated({ limit: 12 });
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    s.enabledPlugins = { 'rig@rig-marketplace': true };
    fs.writeFileSync(settingsFile, JSON.stringify(s));
    const state = snapshot(claude);
    assert.throws(() => restoreBackup({ backupDir: backup, home: m.home }), /still enabled[\s\S]*claude plugin disable/);
    assert.deepStrictEqual(snapshot(claude), state);
    s.enabledPlugins['rig@rig-marketplace'] = false;
    fs.writeFileSync(settingsFile, JSON.stringify(s));
    assert.ok(restoreBackup({ backupDir: backup, home: m.home }).moved > 0);
  });

  it('also looks at the project settings of a project backup', () => {
    const m = makeMachine({ global: false, limit: 12 });
    machines.push(m);
    const result = applyMigration({ plan: planTarget({ kind: 'project', root: m.project, home: m.home }), home: m.home, rigVersion: '2.0.0' });
    const file = path.join(m.project, '.claude', 'settings.local.json');
    writeJsonAtomic(file, { enabledPlugins: { 'rig@rig-marketplace': true } });
    assert.throws(() => restoreBackup({ backupDir: result.backupDir, home: m.home }), /still enabled/);
  });
});

describe('restore containment', () => {
  it('refuses a directory that is not inside ~/.claude/rig-backups, even a perfect copy of a backup', () => {
    const { m, backup } = migrated({ limit: 12 });
    const outside = path.join(m.root, 'elsewhere');
    fs.cpSync(backup, outside, { recursive: true });
    assert.throws(() => restoreBackup({ backupDir: outside, home: m.home }), /not inside .*rig-backups/);
  });

  it('refuses a directory inside rig-backups that has no marker, or whose journal belongs to another backup', () => {
    const { m, backup } = migrated({ limit: 12 });
    const fake = path.join(path.dirname(backup), 'fake');
    fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, 'journal.json'), fs.readFileSync(path.join(backup, 'journal.json')));
    assert.throws(() => restoreBackup({ backupDir: fake, home: m.home }), /marker/);
    fs.copyFileSync(path.join(backup, 'rig-backup.json'), path.join(fake, 'rig-backup.json'));
    const j = readJsonFile(path.join(fake, 'journal.json')).value;
    j.id = 'other';
    writeJsonAtomic(path.join(fake, 'journal.json'), j);
    assert.throws(() => restoreBackup({ backupDir: fake, home: m.home }), /journal does not belong/);
  });

  it('refuses journal paths that leave the target: ../, absolute and drive forms', () => {
    for (const rel of ['../../escape.txt', '/etc/passwd-copy', 'hooks/../../x', 'C:\\Windows\\x', '', 'a//b']) {
      const { m, backup } = migrated({ limit: 12 });
      const j = readJsonFile(path.join(backup, 'journal.json')).value;
      j.moves.push({ rel, type: 'file' });
      writeJsonAtomic(path.join(backup, 'journal.json'), j);
      assert.throws(() => restoreBackup({ backupDir: backup, home: m.home }), /unsafe path/, `rel ${JSON.stringify(rel)}`);
      assert.ok(!fs.existsSync(path.join(m.root, 'escape.txt')));
    }
  });

  it('refuses a recorded target that is not this home\'s .claude', () => {
    const { m, backup } = migrated({ limit: 12 });
    const victim = path.join(m.root, 'victim', '.claude');
    fs.mkdirSync(victim, { recursive: true });
    const marker = readJsonFile(path.join(backup, 'rig-backup.json')).value;
    marker.claudeDir = victim;
    writeJsonAtomic(path.join(backup, 'rig-backup.json'), marker);
    assert.throws(() => restoreBackup({ backupDir: backup, home: m.home }), /recorded target/);
  });

  it('refuses to write through a symlink planted inside the target that points outside it', (t) => {
    if (process.platform === 'win32') return t.skip('symlinks need privileges on Windows');
    const { m, backup, claude } = migrated({ limit: 12 });
    const outside = path.join(m.root, 'outside');
    fs.mkdirSync(outside);
    fs.rmSync(path.join(claude, 'hooks'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(claude, 'hooks'));
    assert.throws(() => restoreBackup({ backupDir: backup, home: m.home }), /resolves outside/);
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'nothing written outside the target');
  });
});

describe('standalone restore.cjs', () => {
  it('uses only Node built-ins, so a backup restores without the plugin', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'backup-restore-standalone.cjs'), 'utf8');
    const requires = [...text.matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]);
    assert.deepStrictEqual(requires.filter((r) => r.startsWith('.')), []);
    assert.ok(requires.every((r) => require('module').builtinModules.includes(r)), requires.join());
  });

  it('the copy in the backup restores the backup when loaded on its own', () => {
    const { m, backup, claude } = migrated({ limit: 12 });
    const copy = require(path.join(backup, 'restore.cjs'));
    const report = copy.restoreBackup({ backupDir: backup, home: m.home });
    assert.ok(report.moved > 0);
    assert.ok(fs.existsSync(path.join(claude, 'hooks', 'session-init.cjs')));
  });

  it('run as a script it refuses without a terminal and inside Claude Code, and changes nothing', () => {
    const { m, backup, claude } = migrated({ limit: 12 });
    const state = snapshot(claude);
    const env = { ...process.env, HOME: m.home, USERPROFILE: m.home };
    delete env.CLAUDECODE;
    const noTty = spawnSync(process.execPath, [path.join(backup, 'restore.cjs')], { env, input: 'y\n', encoding: 'utf8' });
    assert.strictEqual(noTty.status, 2);
    assert.match(noTty.stderr, /interactive terminal/); // no TTY is refused before the ancestry is read
    const inside = spawnSync(process.execPath, [path.join(backup, 'restore.cjs')], { env: { ...env, CLAUDECODE: '1' }, input: 'y\n', encoding: 'utf8' });
    assert.strictEqual(inside.status, 2);
    assert.match(inside.stderr, /outside Claude Code/);
    assert.deepStrictEqual(snapshot(claude), state);
  });
});
