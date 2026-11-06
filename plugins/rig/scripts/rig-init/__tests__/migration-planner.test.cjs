#!/usr/bin/env node
/** Tests for the read-only migration planner, on fixture HOMEs (never the real ~/.claude). */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { planTarget, planAll, describeTarget } = require('../migration-planner.cjs');
const { makeMachine, snapshot, write, tmpDir } = require('./rig-init-fixtures.cjs');

const machines = [];
const machine = (opts) => { const m = makeMachine(opts); machines.push(m); return m; };
after(() => machines.forEach((m) => m.cleanup()));

describe('planTarget', () => {
  it('plans a global 1.x install: settings removals, owned moves, generated dirs; user files are kept and nothing is written', () => {
    const m = machine({ project: false });
    const before = snapshot(m.root);
    const plan = planTarget({ kind: 'global', root: m.home, home: m.home });
    assert.deepStrictEqual(snapshot(m.root), before, 'plan is read-only');
    assert.ok(plan.detected);
    assert.strictEqual(plan.settings.length, 1);
    assert.strictEqual(plan.settings[0].removeHooks.length, 6);
    assert.ok(plan.settings[0].removeStatusLine.includes('statusline.cjs'));
    const rels = new Set(plan.moves.map((x) => x.rel));
    for (const rel of m.rels) assert.ok(rels.has(rel), `owned ${rel} planned`);
    assert.ok(!rels.has('skills/.venv'), 'the shared venv is never moved');
    assert.ok(plan.leftInPlace.some((x) => x.startsWith('skills/.venv')));
    assert.ok(rels.has('skills/browser/scripts/node_modules') && rels.has('skills/browser/scripts/package-lock.json'), 'generated state');
    for (const keep of ['hooks/my-own-hook.sh', 'skills/my-skill/SKILL.md', '.rig.json', 'settings.json', 'skills/.env']) assert.ok(!rels.has(keep), `${keep} is not moved`);
    assert.deepStrictEqual(plan.kept, ['hooks/my-own-hook.sh']);
    assert.ok(plan.backupGroup.endsWith(path.join('rig-backups', 'global')));
    assert.ok(plan.bytes > 0);
  });

  it('plans a project install in project command form only', () => {
    const m = machine();
    const plan = planTarget({ kind: 'project', root: m.project, home: m.home });
    assert.strictEqual(plan.settings[0].removeHooks.length, 6);
    assert.match(path.basename(plan.backupGroup), /^[0-9a-f]{12}$/);
    assert.notStrictEqual(plan.backupGroup, planTarget({ kind: 'global', root: m.home, home: m.home }).backupGroup);
  });

  it('reports a user-modified Rig skill as a move (the backup keeps the edit)', () => {
    const m = machine({ project: false });
    const file = path.join(m.home, '.claude', 'skills', 'fix', 'SKILL.md');
    fs.appendFileSync(file, 'my own change\n');
    const plan = planTarget({ kind: 'global', root: m.home, home: m.home });
    assert.ok(plan.moves.some((x) => x.rel === 'skills/fix/SKILL.md'));
  });

  it('finds nothing in a .claude dir with only the user\'s own files, and null without a .claude dir', () => {
    const root = tmpDir();
    try {
      write(path.join(root, 'home', '.claude', 'settings.json'), '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node /opt/mine.js"}]}]}}');
      write(path.join(root, 'home', '.claude', 'skills', 'mine', 'SKILL.md'), 'x');
      const plan = planTarget({ kind: 'global', root: path.join(root, 'home'), home: path.join(root, 'home') });
      assert.strictEqual(plan.detected, false);
      assert.strictEqual(planTarget({ kind: 'project', root: path.join(root, 'none'), home: path.join(root, 'home') }), null);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('blocks on an unparsable settings.json instead of guessing', () => {
    const m = machine({ project: false });
    fs.writeFileSync(path.join(m.home, '.claude', 'settings.json'), '{ not json');
    const plan = planTarget({ kind: 'global', root: m.home, home: m.home });
    assert.strictEqual(plan.blockers.length, 1);
    assert.match(plan.blockers[0], /cannot parse/);
  });

  it('flags a team project whose 1.x files are committed in git, with a commit hint', () => {
    const m = machine({ global: false, limit: 20 });
    const git = (...args) => execFileSync('git', ['-C', m.project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('add', '.claude');
    git('commit', '-q', '-m', 'add 1.x kit');
    const plan = planTarget({ kind: 'project', root: m.project, home: m.home });
    assert.ok(plan.committed.files > 10);
    assert.strictEqual(plan.committed.settings, true);
    assert.match(plan.hint, /commit the removal/);
    assert.match(describeTarget(plan), /note: .*committed/);
  });
});

describe('planAll', () => {
  it('lists global plus the project at cwd, and skips the project when cwd is the home dir', () => {
    const m = machine();
    assert.deepStrictEqual(planAll({ home: m.home, cwd: m.project }).map((p) => p.kind), ['global', 'project']);
    assert.deepStrictEqual(planAll({ home: m.home, cwd: m.home }).map((p) => p.kind), ['global']);
  });
});
