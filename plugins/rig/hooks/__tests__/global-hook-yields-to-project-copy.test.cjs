#!/usr/bin/env node
/**
 * Tests for lib/global-hook-yields-to-project-copy.cjs: the global copy of a hook exits only when
 * the project install registers the same hook for the same event and matcher.
 * Run: node --test .claude/hooks/__tests__/global-hook-yields-to-project-copy.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { yieldsToProjectCopy } = require('../lib/global-hook-yields-to-project-copy.cjs');

const HOOKS_DIR = path.resolve(__dirname, '..');
const PROJECT_CMD = (file) => `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}`;

const roots = [];
test.after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

/** Fake HOME with a global hooks dir and a fake project; returns paths and a settings writer. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-yield-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  for (const dir of [path.join(home, '.claude', 'hooks'), path.join(project, '.claude', 'hooks')]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'x.cjs'), '');
  }
  const writeSettings = (hooks, name = 'settings.json') =>
    fs.writeFileSync(path.join(project, '.claude', name), JSON.stringify({ hooks }));
  return { root, home, project, globalHook: path.join(home, '.claude', 'hooks', 'x.cjs'), writeSettings };
}

function withEnv(env, fn) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR };
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function check(t, input, hookPath = t.globalHook, projectDir = t.project) {
  return withEnv({ HOME: t.home, USERPROFILE: t.home, CLAUDE_PROJECT_DIR: projectDir }, () => yieldsToProjectCopy(hookPath, input));
}

const preWrite = { hook_event_name: 'PreToolUse', tool_name: 'Write' };

test('global copy yields when the project registers the same hook, event and matcher', () => {
  const t = setup();
  t.writeSettings({ PreToolUse: [{ matcher: 'Bash|Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite), true);
});

test('registration in settings.local.json counts too', () => {
  const t = setup();
  t.writeSettings({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] }, 'settings.local.json');
  assert.strictEqual(check(t, { hook_event_name: 'UserPromptSubmit' }), true);
});

test('global-only hook keeps running', () => {
  const t = setup();
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('other.cjs') }] }] });
  assert.strictEqual(check(t, preWrite), false);
});

test('same hook under another event or a non-matching matcher keeps running', () => {
  const t = setup();
  t.writeSettings({
    PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }],
  });
  assert.strictEqual(check(t, preWrite), false);
});

test('project copy itself never yields (project-only hooks are untouched)', () => {
  const t = setup();
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, path.join(t.project, '.claude', 'hooks', 'x.cjs')), false);
});

test('no yield when the project points at the global copy, lacks the file, or is $HOME', () => {
  const t = setup();
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/x.cjs"' }] }] });
  assert.strictEqual(check(t, preWrite), false);

  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  fs.unlinkSync(path.join(t.project, '.claude', 'hooks', 'x.cjs'));
  assert.strictEqual(check(t, preWrite), false);

  assert.strictEqual(check(t, preWrite, t.globalHook, t.home), false);
});

test('missing event, bad JSON or bad matcher regex falls back to running', () => {
  const t = setup();
  assert.strictEqual(check(t, {}), false);
  fs.writeFileSync(path.join(t.project, '.claude', 'settings.json'), '{ broken');
  assert.strictEqual(check(t, preWrite), false);
  t.writeSettings({ PreToolUse: [{ matcher: '(', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite), false);
});

test('absolute path to the project copy counts; absolute path to the global copy does not', () => {
  const t = setup();
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: `node "${t.project}/.claude/hooks/x.cjs"` }] }] });
  assert.strictEqual(check(t, preWrite), true);
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: `node "${t.globalHook}"` }] }] });
  assert.strictEqual(check(t, preWrite), false);
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: `node ${PROJECT_CMD('x.cjs').slice(5)}.bak` }] }] });
  assert.strictEqual(check(t, preWrite), false, 'only the exact file counts');
});

test('no yield when the project hook is a symlink to the global copy', () => {
  const t = setup();
  const projectHooks = path.join(t.project, '.claude', 'hooks');
  fs.rmSync(projectHooks, { recursive: true });
  fs.symlinkSync(path.join(t.home, '.claude', 'hooks'), projectHooks, 'dir');
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite), false);
});

test('no yield for handler `if` conditions, disableAllHooks, or a matcher on an unknown event', () => {
  const t = setup();
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', if: 'Write(*.md)', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite), false);

  fs.writeFileSync(path.join(t.project, '.claude', 'settings.local.json'), JSON.stringify({ disableAllHooks: true }));
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite), false);
  fs.unlinkSync(path.join(t.project, '.claude', 'settings.local.json'));

  t.writeSettings({ FutureEvent: [{ matcher: 'foo', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, { hook_event_name: 'FutureEvent' }), false);
  t.writeSettings({ FutureEvent: [{ hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, { hook_event_name: 'FutureEvent' }), true);
});

test('end to end: installed global hook stays silent only when the project runs it', () => {
  const t = setup();
  const globalHooks = path.join(t.home, '.claude', 'hooks');
  fs.cpSync(HOOKS_DIR, globalHooks, { recursive: true, filter: (src) => !/[\\/](__tests__|tests|\.logs)$/.test(src) });
  fs.cpSync(HOOKS_DIR, path.join(t.project, '.claude', 'hooks'), { recursive: true, filter: (src) => !/[\\/](__tests__|tests|\.logs)$/.test(src) });
  const run = () => spawnSync(process.execPath, [path.join(globalHooks, 'dev-rules-reminder.cjs')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }),
    cwd: t.project,
    env: { ...process.env, HOME: t.home, USERPROFILE: t.home, CLAUDE_PROJECT_DIR: t.project },
    encoding: 'utf8',
  }).stdout;

  assert.match(run(), /## Rig Session/, 'runs when the project does not register it');
  t.writeSettings({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: PROJECT_CMD('dev-rules-reminder.cjs') }] }] });
  assert.strictEqual(run(), '', 'silent when the project copy runs');
});
