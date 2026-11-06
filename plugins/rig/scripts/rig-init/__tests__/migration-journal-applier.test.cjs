#!/usr/bin/env node
/** Tests for the journaled migration: result, interruption at every step, resume, files in use, concurrency, backup placement. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { planTarget, findIncompleteBackup } = require('../migration-planner.cjs');
const { applyMigration, resumeMigration } = require('../migration-journal-applier.cjs');
const { withRetry, readJsonFile } = require('../backup-restore-standalone.cjs');
const { acquireLock } = require('../../../hooks/lib/dir-lock-with-owner-token.cjs');
const { makeMachine, snapshot, danglingCommands, USER_HOOK_COMMAND } = require('./rig-init-fixtures.cjs');

const machines = [];
const machine = (opts) => { const m = makeMachine(opts); machines.push(m); return m; };
after(() => machines.forEach((m) => m.cleanup()));

const planGlobal = (m) => planTarget({ kind: 'global', root: m.home, home: m.home });
const planProject = (m) => planTarget({ kind: 'project', root: m.project, home: m.home });
const claude = (m) => path.join(m.home, '.claude');
const CRASH = new Error('simulated crash');

/** Runs fn and expects the simulated crash from `afterStep`. */
function crashAt(index, fn) {
  let n = 0;
  const afterStep = () => { if (n++ === index) throw CRASH; };
  try { fn({ afterStep }); } catch (err) { if (err === CRASH) return true; throw err; }
  return false;
}

describe('applyMigration', () => {
  it('moves the owned paths into a private backup outside any repo and rewrites settings without the Rig entries', () => {
    const m = machine({ project: false });
    const original = fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8');
    const edited = path.join(claude(m), 'skills', 'fix', 'SKILL.md');
    fs.appendFileSync(edited, 'my own change\n');
    const result = applyMigration({ plan: planGlobal(m), home: m.home, rigVersion: '2.0.0' });
    assert.strictEqual(result.status, 'done');
    assert.deepStrictEqual(result.blocked, []);

    // owned paths gone, user files kept
    for (const rel of m.rels) assert.ok(!fs.existsSync(path.join(claude(m), ...rel.split('/'))), `${rel} moved`);
    assert.ok(!fs.existsSync(path.join(claude(m), 'skills', '.venv')));
    for (const keep of ['hooks/my-own-hook.sh', 'skills/my-skill/SKILL.md', '.rig.json', 'skills/.env']) assert.ok(fs.existsSync(path.join(claude(m), keep)), keep);
    // settings: user hook and keys stay, Rig entries gone
    const settings = JSON.parse(fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(settings.hooks), ['SessionStart']);
    assert.strictEqual(settings.hooks.SessionStart[0].hooks[0].command, USER_HOOK_COMMAND);
    assert.strictEqual(settings.statusLine, undefined);
    assert.strictEqual(settings.model, 'sonnet');
    assert.deepStrictEqual(settings.permissions.allow, ['Bash(ls)']);
    // backup: location, marker, standalone restore, original settings bytes, moved content incl. the user's edit
    const backup = result.backupDir;
    assert.ok(backup.startsWith(path.join(m.home, '.claude', 'rig-backups', 'global') + path.sep));
    assert.ok(fs.existsSync(path.join(backup, 'restore.cjs')) && fs.existsSync(path.join(backup, 'rig-backup.json')));
    assert.strictEqual(fs.readFileSync(path.join(backup, 'settings', 'settings.json'), 'utf8'), original);
    assert.match(fs.readFileSync(path.join(backup, 'files', 'skills', 'fix', 'SKILL.md'), 'utf8'), /my own change/);
    assert.ok(fs.existsSync(path.join(backup, 'files', 'skills', '.venv', 'pyvenv.cfg')));
    if (process.platform !== 'win32') {
      for (const dir of [backup, path.dirname(backup), path.join(m.home, '.claude', 'rig-backups')]) assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700, dir);
    }
    assert.strictEqual(readJsonFile(path.join(backup, 'journal.json')).value.status, 'done');
    assert.deepStrictEqual(danglingCommands(claude(m), m.home), []);
  });

  it('a project backup lives under the home dir, never inside the project', () => {
    const m = machine();
    const result = applyMigration({ plan: planProject(m), home: m.home, rigVersion: '2.0.0' });
    assert.ok(result.backupDir.startsWith(path.join(m.home, '.claude', 'rig-backups') + path.sep));
    assert.ok(!result.backupDir.startsWith(m.project));
    assert.ok(!fs.existsSync(path.join(m.project, '.claude', 'hooks', 'session-init.cjs')));
    assert.ok(fs.existsSync(path.join(m.home, '.claude', 'hooks', 'session-init.cjs')), 'global install untouched by the project migration');
  });

  it('refuses a second migration while an interrupted one is open, and when another run holds the lock', () => {
    const m = machine({ project: false, limit: 10 });
    assert.ok(crashAt(2, (hooks) => applyMigration({ plan: planGlobal(m), home: m.home, rigVersion: '2.0.0', hooks })));
    assert.throws(() => applyMigration({ plan: planGlobal(m), home: m.home, rigVersion: '2.0.0' }), /--resume/);
    const m2 = machine({ project: false, limit: 10 });
    const group = planGlobal(m2).backupGroup;
    fs.mkdirSync(path.dirname(group), { recursive: true });
    assert.ok(acquireLock(`${group}.lock`, 60000));
    assert.throws(() => applyMigration({ plan: planGlobal(m2), home: m2.home, rigVersion: '2.0.0' }), /another rig-init/);
  });
});

describe('interruption', () => {
  // The fixture is small so that EVERY step can be interrupted: journal, 1 settings backup, 1 settings write, each move, finish.
  it('is consistent after a crash at every step: settings never point at a missing file, and --resume reaches the uninterrupted result', () => {
    const baseline = machine({ project: false, limit: 12 });
    applyMigration({ plan: planGlobal(baseline), home: baseline.home, rigVersion: '2.0.0' });
    const expectedClaude = snapshot(claude(baseline));
    delete expectedClaude['rig-backups/'];
    const stripBackups = (snap) => Object.fromEntries(Object.entries(snap).filter(([k]) => !k.startsWith('rig-backups')));

    let steps;
    for (let index = 0; ; index++) {
      const m = machine({ project: false, limit: 12 });
      const crashed = crashAt(index, (hooks) => applyMigration({ plan: planGlobal(m), home: m.home, rigVersion: '2.0.0', hooks }));
      if (!crashed) { steps = index; break; }
      // consistent right after the crash
      assert.deepStrictEqual(danglingCommands(claude(m), m.home), [], `dangling hook after crash at step ${index}`);
      const pending = findIncompleteBackup({ kind: 'global', home: m.home, root: m.home });
      // Only a crash after the final journal save (the `finish` step) has nothing left to resume
      if (pending) {
        // resume completes to the same machine state as an uninterrupted run
        const resumed = resumeMigration({ backupDir: pending, home: m.home });
        assert.strictEqual(resumed.status, 'done', `resume after step ${index}`);
      } else {
        const group = planGlobal(m).backupGroup;
        const [only] = fs.readdirSync(group);
        assert.strictEqual(readJsonFile(path.join(group, only, 'journal.json')).value.status, 'done', `step ${index} left no open journal, so it must be complete`);
      }
      assert.deepStrictEqual(danglingCommands(claude(m), m.home), []);
      assert.deepStrictEqual(stripBackups(snapshot(claude(m))), stripBackups(expectedClaude), `state after resume from step ${index}`);
      assert.strictEqual(findIncompleteBackup({ kind: 'global', home: m.home, root: m.home }), null);
    }
    assert.ok(steps >= 15, `expected a journal, settings steps and one step per move, got ${steps}`);
  });

  it('a crash after the settings rewrite but before any move leaves settings without Rig hooks while every file is still there', () => {
    const m = machine({ project: false, limit: 12 });
    assert.ok(crashAt(2, (hooks) => applyMigration({ plan: planGlobal(m), home: m.home, rigVersion: '2.0.0', hooks })));
    const settings = JSON.parse(fs.readFileSync(path.join(claude(m), 'settings.json'), 'utf8'));
    assert.strictEqual(JSON.stringify(settings).includes('session-init'), false);
    assert.ok(fs.existsSync(path.join(claude(m), 'hooks', 'session-init.cjs')));
  });
});

describe('files in use (Windows EBUSY on an open statusline)', () => {
  it('retries a busy path, then leaves it in place, reports it, keeps the journal open, and --resume finishes it', () => {
    const m = machine({ project: false, limit: 12 });
    const busy = Object.assign(new Error('resource busy'), { code: 'EBUSY' });
    const movePath = (src, dest) => { if (src.endsWith('statusline.cjs')) throw busy; return require('../backup-restore-standalone.cjs').movePath(src, dest); };
    const result = applyMigration({ plan: planGlobal(m), home: m.home, rigVersion: '2.0.0', hooks: { movePath } });
    assert.strictEqual(result.status, 'in-progress');
    assert.deepStrictEqual(result.blocked.map((b) => [b.rel, b.code]), [['statusline.cjs', 'EBUSY']]);
    assert.ok(fs.existsSync(path.join(claude(m), 'statusline.cjs')));
    assert.deepStrictEqual(danglingCommands(claude(m), m.home), [], 'settings no longer reference the busy file');
    const resumed = resumeMigration({ backupDir: result.backupDir, home: m.home });
    assert.strictEqual(resumed.status, 'done');
    assert.ok(!fs.existsSync(path.join(claude(m), 'statusline.cjs')));
  });

  it('withRetry retries transient codes and gives up on a persistent one', () => {
    let calls = 0;
    assert.strictEqual(withRetry(() => { if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return 'ok'; }), 'ok');
    assert.strictEqual(calls, 3);
    assert.throws(() => withRetry(() => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); }), /no/);
  });
});
