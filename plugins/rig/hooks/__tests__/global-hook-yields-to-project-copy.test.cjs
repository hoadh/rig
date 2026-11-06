#!/usr/bin/env node
/**
 * Tests for lib/global-hook-yields-to-project-copy.cjs: the global copy of a hook exits only when
 * the project install registers the same hook for the same event and matcher.
 * Run: node --test plugins/rig/hooks/__tests__/global-hook-yields-to-project-copy.test.cjs
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
    // RIG_SESSION_ID cleared: a leaked id from the outer Claude session would trip the reminder's delta mode
    env: { ...process.env, HOME: t.home, USERPROFILE: t.home, CLAUDE_PROJECT_DIR: t.project, RIG_SESSION_ID: '' },
    encoding: 'utf8',
  }).stdout;

  assert.match(run(), /## Rig Session/, 'runs when the project does not register it');
  t.writeSettings({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: PROJECT_CMD('dev-rules-reminder.cjs') }] }] });
  assert.strictEqual(run(), '', 'silent when the project copy runs');
});

// --- plugin mode: the plugin copy (<root>/hooks/x.cjs + <root>/.claude-plugin/plugin.json) yields like the global copy ---

/** A fake plugin install next to the fake project; the hook file is `<plugin>/hooks/x.cjs`. */
function setupPlugin() {
  const t = setup();
  const pluginRoot = path.join(t.root, 'plugin-cache', 'rig');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'rig', version: '0.0.0' }));
  fs.writeFileSync(path.join(pluginRoot, 'hooks', 'x.cjs'), '');
  return { ...t, pluginRoot, pluginHook: path.join(pluginRoot, 'hooks', 'x.cjs') };
}

test('plugin copy yields when the project still registers its own 1.x copy of the hook', () => {
  const t = setupPlugin();
  t.writeSettings({ PreToolUse: [{ matcher: 'Bash|Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, t.pluginHook), true);
});

test('plugin copy keeps running when the project registers nothing, another event or another matcher', () => {
  const t = setupPlugin();
  assert.strictEqual(check(t, preWrite, t.pluginHook), false, 'no settings');
  t.writeSettings({ PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, t.pluginHook), false, 'other event');
  t.writeSettings({ PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, t.pluginHook), false, 'other matcher');
});

test('a hooks directory without a plugin manifest is not a plugin copy and never yields', () => {
  const t = setupPlugin();
  fs.rmSync(path.join(t.pluginRoot, '.claude-plugin'), { recursive: true });
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, t.pluginHook), false);
});

test('plugin copy keeps running when the project has no copy of that hook file', () => {
  const t = setupPlugin();
  fs.unlinkSync(path.join(t.project, '.claude', 'hooks', 'x.cjs'));
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, t.pluginHook), false);
});

test('end to end: the plugin hooks yield to a project copy and run without one', () => {
  const t = setup();
  const pluginRoot = path.join(t.root, 'plugin-cache', 'rig');
  fs.cpSync(HOOKS_DIR, path.join(pluginRoot, 'hooks'), { recursive: true, filter: (src) => !/[\\/](__tests__|tests|\.logs)$/.test(src) });
  fs.cpSync(path.join(HOOKS_DIR, '..', '.claude-plugin'), path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.cpSync(path.join(HOOKS_DIR, '..', 'rules'), path.join(pluginRoot, 'rules'), { recursive: true });
  fs.cpSync(HOOKS_DIR, path.join(t.project, '.claude', 'hooks'), { recursive: true, filter: (src) => !/[\\/](__tests__|tests|\.logs)$/.test(src) });
  const run = () => spawnSync(process.execPath, [path.join(pluginRoot, 'hooks', 'dev-rules-reminder.cjs')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }),
    cwd: t.project,
    env: { ...process.env, HOME: t.home, USERPROFILE: t.home, CLAUDE_PROJECT_DIR: t.project, RIG_SESSION_ID: '',
      CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: path.join(t.root, 'plugin-data') },
    encoding: 'utf8',
  }).stdout;

  assert.match(run(), /## Rig Session/, 'runs when the project does not register it');
  t.writeSettings({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: PROJECT_CMD('dev-rules-reminder.cjs') }] }] });
  assert.strictEqual(run(), '', 'silent when the project copy runs');
});

// --- plugin copy vs a global 1.x install (~/.claude/settings.json -> ~/.claude/hooks/x.cjs) ---

const GLOBAL_CMD = (file) => `node "$HOME/.claude/hooks/${file}"`;
const writeHomeSettings = (t, hooks, name = 'settings.json') =>
  fs.writeFileSync(path.join(t.home, '.claude', name), JSON.stringify({ hooks }));
const { yieldTarget } = require('../lib/global-hook-yields-to-project-copy.cjs');
const target = (t, input, hookPath) => withEnv({ HOME: t.home, USERPROFILE: t.home, CLAUDE_PROJECT_DIR: t.project }, () => yieldTarget(hookPath, input));

test('plugin copy yields to a global 1.x copy registered in ~/.claude/settings.json', () => {
  const t = setupPlugin();
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Bash|Write', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, t.pluginHook), true);
  assert.strictEqual(target(t, preWrite, t.pluginHook), 'global');
});

test('plugin copy yields to a global copy registered in settings.local.json, via ~ and absolute forms', () => {
  const t = setupPlugin();
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node ~/.claude/hooks/x.cjs' }] }] }, 'settings.local.json');
  assert.strictEqual(check(t, preWrite, t.pluginHook), true, '~ form');
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: `node "${t.home}/.claude/hooks/x.cjs"` }] }] }, 'settings.local.json');
  assert.strictEqual(check(t, preWrite, t.pluginHook), true, 'absolute form');
});

test('plugin copy keeps running when no global 1.x copy is registered (file absent, other event, other matcher)', () => {
  const t = setupPlugin();
  assert.strictEqual(target(t, preWrite, t.pluginHook), null, 'nothing registered');
  writeHomeSettings(t, { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] });
  assert.strictEqual(target(t, preWrite, t.pluginHook), null, 'other event');
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] });
  assert.strictEqual(target(t, preWrite, t.pluginHook), null, 'other matcher');
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] });
  fs.unlinkSync(path.join(t.home, '.claude', 'hooks', 'x.cjs'));
  assert.strictEqual(target(t, preWrite, t.pluginHook), null, 'registered but the global file is gone');
});

test('a global "copy" that is a symlink to the plugin file never makes both sides yield', () => {
  const t = setupPlugin();
  const globalFile = path.join(t.home, '.claude', 'hooks', 'x.cjs');
  fs.unlinkSync(globalFile);
  fs.symlinkSync(t.pluginHook, globalFile);
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] });
  assert.strictEqual(target(t, preWrite, t.pluginHook), null);
});

test('global + plugin + project: the plugin yields to the project copy, not the global one', () => {
  const t = setupPlugin();
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] });
  t.writeSettings({ PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: PROJECT_CMD('x.cjs') }] }] });
  assert.strictEqual(target(t, preWrite, t.pluginHook), 'project');
});

test('disableAllHooks in the home settings stops the plugin from yielding to the global copy', () => {
  const t = setupPlugin();
  fs.writeFileSync(path.join(t.home, '.claude', 'settings.json'), JSON.stringify({
    disableAllHooks: true, hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] },
  }));
  assert.strictEqual(target(t, preWrite, t.pluginHook), null);
});

test('the global 1.x copy itself never yields to the global registration (only plugin copies do)', () => {
  const t = setupPlugin();
  writeHomeSettings(t, { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: GLOBAL_CMD('x.cjs') }] }] });
  assert.strictEqual(check(t, preWrite, t.globalHook), false);
});

test('end to end: with a global 1.x copy registered, the plugin session-init prints one migration notice and the other hooks stay silent', () => {
  const t = setup();
  const pluginRoot = path.join(t.root, 'plugin-cache', 'rig');
  const skip = (src) => !/[\\/](__tests__|tests|\.logs)$/.test(src);
  fs.cpSync(HOOKS_DIR, path.join(pluginRoot, 'hooks'), { recursive: true, filter: skip });
  fs.cpSync(path.join(HOOKS_DIR, '..', '.claude-plugin'), path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.cpSync(path.join(HOOKS_DIR, '..', 'rules'), path.join(pluginRoot, 'rules'), { recursive: true });
  fs.cpSync(HOOKS_DIR, path.join(t.home, '.claude', 'hooks'), { recursive: true, filter: skip });
  const env = { ...process.env, HOME: t.home, USERPROFILE: t.home, CLAUDE_PROJECT_DIR: t.project, RIG_SESSION_ID: '',
    CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: path.join(t.root, 'plugin-data') };
  const run = (hook, input) => spawnSync(process.execPath, [path.join(pluginRoot, 'hooks', hook)], { input: JSON.stringify(input), cwd: t.project, env, encoding: 'utf8' }).stdout;
  const sessionStart = { hook_event_name: 'SessionStart', source: 'startup', session_id: 'g1' };
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'hi' };

  // Not registered globally yet: both hooks run normally.
  assert.match(run('session-init.cjs', sessionStart), /Session startup/);
  assert.match(run('dev-rules-reminder.cjs', prompt), /## Rig Session/);

  writeHomeSettings(t, {
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: GLOBAL_CMD('session-init.cjs') }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: GLOBAL_CMD('dev-rules-reminder.cjs') }] }],
  });
  const notice = JSON.parse(run('session-init.cjs', sessionStart)).hookSpecificOutput.additionalContext;
  assert.match(notice, /1\.x Rig hooks in ~\/\.claude are still registered/);
  assert.match(notice, /Remove the 1\.x global hooks or run the migrator when available/);
  assert.ok(!notice.includes('Session startup'), 'one-line notice only, no duplicated session context');
  assert.strictEqual(run('dev-rules-reminder.cjs', prompt), '', 'other hooks yield silently');
});
