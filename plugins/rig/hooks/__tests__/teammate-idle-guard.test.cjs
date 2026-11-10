#!/usr/bin/env node
/**
 * Tests for teammate-idle-guard.cjs (TeammateIdle): one nudge per in_progress task the teammate owns.
 * Run: node --test plugins/rig/hooks/__tests__/teammate-idle-guard.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'teammate-idle-guard.cjs');
const SID = 'abcdef12-0000-4000-8000-000000000001';
const LIST = 'session-abcdef12';

function setup(tasks = [], { config } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-guard-home-'));
  const dir = path.join(home, '.claude', 'tasks', LIST);
  fs.mkdirSync(dir, { recursive: true });
  for (const t of tasks) fs.writeFileSync(path.join(dir, `${t.id}.json`), JSON.stringify(t));
  if (config) fs.writeFileSync(path.join(home, '.claude', '.rig.json'), JSON.stringify(config));
  const data = path.join(home, 'plugin-data');
  fs.mkdirSync(data);
  return { home, data, dir };
}

function run(ctx, payload) {
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, CLAUDE_PLUGIN_DATA: ctx.data };
  delete env.CLAUDE_CODE_TASK_LIST_ID;
  delete env.HOMEDRIVE;
  delete env.HOMEPATH;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), env, cwd: ctx.home, encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr };
}

const idle = (name = 'dev-1') => ({ hook_event_name: 'TeammateIdle', session_id: SID, teammate_name: name, team_name: LIST });
const task = (id, owner, status, subject = `task ${id}`) => ({ id: String(id), subject, status, owner });

describe('teammate-idle-guard', () => {
  it('nudges once for an in_progress task the teammate owns, then lets it idle', () => {
    const ctx = setup([task(1, 'dev-1', 'in_progress', 'Add parser'), task(2, 'dev-1', 'completed')]);
    try {
      const first = run(ctx, idle());
      assert.strictEqual(first.code, 2);
      assert.match(first.stderr, /#1 "Add parser" is still in_progress/);
      assert.ok(!first.stderr.includes('#2'));
      assert.strictEqual(run(ctx, idle()).code, 0, 'second idle on the same task passes (no loop)');
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
  it('a new in_progress task gets its own nudge', () => {
    const ctx = setup([task(1, 'dev-1', 'in_progress')]);
    try {
      assert.strictEqual(run(ctx, idle()).code, 2);
      fs.writeFileSync(path.join(ctx.dir, '3.json'), JSON.stringify(task(3, 'dev-1', 'in_progress')));
      const r = run(ctx, idle());
      assert.strictEqual(r.code, 2);
      assert.match(r.stderr, /#3/);
      assert.ok(!r.stderr.includes('#1'), 'already nudged task is not repeated');
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
  it('ignores other owners, pending and completed tasks', () => {
    const ctx = setup([task(1, 'dev-2', 'in_progress'), task(2, 'dev-1', 'pending'), task(3, 'dev-1', 'completed')]);
    try {
      assert.strictEqual(run(ctx, idle()).code, 0);
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
  it('a reused task id with a new subject is a new task', () => {
    const ctx = setup([task(1, 'dev-1', 'in_progress', 'old work')]);
    try {
      assert.strictEqual(run(ctx, idle()).code, 2);
      fs.writeFileSync(path.join(ctx.dir, '1.json'), JSON.stringify(task(1, 'dev-1', 'in_progress', 'new work')));
      assert.strictEqual(run(ctx, idle()).code, 2);
      const markers = fs.readdirSync(path.join(ctx.data, 'state')).filter((n) => n.startsWith('rig-teammate-idle-'));
      assert.strictEqual(markers.length, 2, 'markers carry the rig- prefix, so state pruning removes them');
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
  it('reads the list named by CLAUDE_CODE_TASK_LIST_ID', () => {
    const ctx = setup([]);
    const other = path.join(ctx.home, '.claude', 'tasks', 'my-plan');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, '4.json'), JSON.stringify(task(4, 'dev-1', 'in_progress')));
    try {
      const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, CLAUDE_PLUGIN_DATA: ctx.data, CLAUDE_CODE_TASK_LIST_ID: 'my-plan' };
      const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(idle()), env, encoding: 'utf8' });
      assert.strictEqual(r.status, 2);
      assert.match(r.stderr, /#4/);
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
  it('an unwritable state dir exits 0 (no nudge, no loop)', () => {
    const ctx = setup([task(1, 'dev-1', 'in_progress')]);
    fs.writeFileSync(path.join(ctx.data, 'state'), 'not a dir'); // stateDir() cannot be a directory
    try {
      assert.strictEqual(run(ctx, idle()).code, 0);
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
  it('is off through .rig.json hooks', () => {
    const ctx = setup([task(1, 'dev-1', 'in_progress')], { config: { hooks: { 'teammate-idle-guard': false } } });
    try {
      assert.strictEqual(run(ctx, idle()).code, 0);
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
  it('fails open on malformed tasks, bad input and a missing list', () => {
    const ctx = setup([task(2, 'dev-1', 'in_progress')]);
    fs.writeFileSync(path.join(ctx.dir, 'bad.json'), '{not json');
    try {
      assert.strictEqual(run(ctx, idle()).code, 2, 'a malformed file is skipped, the valid task still counts');
      // a task outside the tasks root, reachable only through an unsafe team_name, must not count
      const outside = path.join(ctx.home, '.claude', 'escape');
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, '9.json'), JSON.stringify(task(9, 'dev-1', 'in_progress')));
      for (const p of [{}, { teammate_name: 'dev-1' }, { teammate_name: 'dev-1', session_id: 'short' }, { teammate_name: 'dev-1', team_name: '../escape' }]) {
        assert.strictEqual(run(ctx, p).code, 0, JSON.stringify(p));
      }
      const r = spawnSync(process.execPath, [HOOK], { input: 'not json', env: { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home }, encoding: 'utf8' });
      assert.strictEqual(r.status, 0);
    } finally { fs.rmSync(ctx.home, { recursive: true, force: true }); }
  });
});
