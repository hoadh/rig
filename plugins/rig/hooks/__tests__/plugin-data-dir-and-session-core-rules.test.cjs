#!/usr/bin/env node
/**
 * Plugin-mode behavior of the hooks:
 *  - hook state (log, counters, caches) goes under CLAUDE_PLUGIN_DATA and nothing is written into the
 *    plugin install dir; with the variable unset it falls back to the temp dir / legacy .logs dir;
 *  - session-init injects rules/core-rules.md as additionalContext, capped at 10,000 characters, and only
 *    when it runs from a plugin install (file installs load .claude/rules natively).
 * Run: node --test plugins/rig/hooks/__tests__/plugin-data-dir-and-session-core-rules.test.cjs
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const tmpRoots = [];
after(() => tmpRoots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const mkTmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
};

/** Copies the plugin (hooks without tests, manifest, rules) to a temp install dir. */
function installPluginCopy({ coreRules, withManifest = true } = {}) {
  const root = path.join(mkTmp('rig-plugin-copy-'), 'rig');
  const skip = (src) => !/[\\/](__tests__|tests|\.logs)$/.test(src);
  fs.cpSync(path.join(PLUGIN_ROOT, 'hooks'), path.join(root, 'hooks'), { recursive: true, filter: skip });
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rules', 'core-rules.md'), coreRules ?? fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', 'core-rules.md')));
  if (withManifest) fs.cpSync(path.join(PLUGIN_ROOT, '.claude-plugin'), path.join(root, '.claude-plugin'), { recursive: true });
  return root;
}

function runSessionInit(root, env = {}) {
  const project = mkTmp('rig-plugin-project-');
  const home = mkTmp('rig-plugin-home-'); // a real ~/.claude with 1.x hooks would make the plugin copy yield
  const res = spawnSync(process.execPath, [path.join(root, 'hooks', 'session-init.cjs')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: `t-${Date.now()}` }),
    cwd: project,
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_ENV_FILE: '', CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: '', ...env },
    encoding: 'utf8',
  });
  return { ...res, project };
}

describe('plugin data dir', () => {
  const lib = path.join(PLUGIN_ROOT, 'hooks', 'lib', 'plugin-data-dir.cjs');
  const probe = (env, code) => spawnSync(process.execPath, ['-e', code], { env: { ...process.env, ...env }, encoding: 'utf8' }).stdout.trim();

  it('uses CLAUDE_PLUGIN_DATA for state and logs when it is an absolute path', () => {
    const data = mkTmp('rig-data-');
    const out = JSON.parse(probe({ CLAUDE_PLUGIN_DATA: data }, `const m=require(${JSON.stringify(lib)});console.log(JSON.stringify({s:m.stateDir(),l:m.logDir('/legacy')}))`));
    assert.strictEqual(out.s, path.join(data, 'state'));
    assert.strictEqual(out.l, path.join(data, 'logs'));
    assert.ok(fs.statSync(out.s).isDirectory(), 'state dir is created');
  });

  it('falls back to the temp dir and the legacy log dir when unset, empty or relative', () => {
    for (const value of ['', 'relative/dir']) {
      const out = JSON.parse(probe({ CLAUDE_PLUGIN_DATA: value }, `const m=require(${JSON.stringify(lib)});console.log(JSON.stringify({s:m.stateDir(),l:m.logDir('/legacy')}))`));
      assert.strictEqual(out.s, os.tmpdir(), `state for "${value}"`);
      assert.strictEqual(out.l, '/legacy', `log for "${value}"`);
    }
  });

  it('a hook run writes its log under CLAUDE_PLUGIN_DATA and leaves the plugin dir untouched', () => {
    const root = installPluginCopy();
    const data = mkTmp('rig-data-');
    const before = fs.readdirSync(path.join(root, 'hooks')).sort();
    const res = runSessionInit(root, { CLAUDE_PLUGIN_DATA: data });
    assert.strictEqual(res.status, 0, res.stderr);
    const log = path.join(data, 'logs', 'hook-log.jsonl');
    assert.ok(fs.existsSync(log), 'log written to the data dir');
    assert.match(fs.readFileSync(log, 'utf8'), /"hook":"session-init"/);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'hooks')).sort(), before, 'no .logs dir inside the plugin');
  });
});

describe('session-init core rules injection', () => {
  const additionalContext = (res) => {
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
    return out.hookSpecificOutput.additionalContext;
  };

  it('injects rules/core-rules.md when running from a plugin install', () => {
    const root = installPluginCopy({ coreRules: '# Core\n\nMARKER-CORE-RULES\n' });
    const res = runSessionInit(root);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(additionalContext(res).includes('MARKER-CORE-RULES'));
  });

  it('the shipped core-rules.md is injected whole (it fits the cap)', () => {
    const shipped = fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', 'core-rules.md'), 'utf8').trim();
    assert.ok(shipped.length < 10000);
    const res = runSessionInit(PLUGIN_ROOT);
    assert.ok(additionalContext(res).includes(shipped));
  });

  it('caps the injected rules at 10,000 characters', () => {
    const root = installPluginCopy({ coreRules: `START\n${'x'.repeat(30000)}\nEND-OF-FILE` });
    const ctx = additionalContext(runSessionInit(root));
    assert.ok(ctx.includes('START'));
    assert.ok(!ctx.includes('END-OF-FILE'), 'tail beyond the cap is dropped');
    assert.ok(ctx.length <= 10000, `whole additionalContext stays within the 10,000 cap (${ctx.length})`);
  });

  it('does not inject when the hook is not part of a plugin (no manifest): file installs load rules natively', () => {
    const root = installPluginCopy({ coreRules: 'MARKER-CORE-RULES', withManifest: false });
    const res = runSessionInit(root);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(!additionalContext(res).includes('MARKER-CORE-RULES'));
  });

  it('still starts when core-rules.md is missing', () => {
    const root = installPluginCopy();
    fs.rmSync(path.join(root, 'rules'), { recursive: true });
    const res = runSessionInit(root);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(additionalContext(res).length > 0);
  });
});

describe('shared session state across the hook / Bash boundary', () => {
  const setActivePlan = path.join(PLUGIN_ROOT, 'scripts', 'set-active-plan.cjs');
  const readPlan = path.join(PLUGIN_ROOT, 'hooks', 'lib', 'rig-config-utils.cjs');

  it('set-active-plan (no CLAUDE_PLUGIN_DATA, like the Bash tool) is visible to a hook that has it', () => {
    const data = mkTmp('rig-data-');
    const project = mkTmp('rig-proj-');
    const sid = `h1-${process.pid}-${Date.now()}`;
    const env = { ...process.env, RIG_SESSION_ID: sid, CLAUDE_PROJECT_DIR: project };
    delete env.CLAUDE_PLUGIN_DATA;
    const set = spawnSync(process.execPath, [setActivePlan, path.join(project, 'plans', 'x')], { cwd: project, env, encoding: 'utf8' });
    assert.strictEqual(set.status, 0, set.stderr);
    try {
      const read = spawnSync(process.execPath, ['-e',
        `const {readSessionState}=require(${JSON.stringify(readPlan)});console.log(JSON.stringify(readSessionState(${JSON.stringify(sid)})))`],
      { cwd: project, env: { ...env, CLAUDE_PLUGIN_DATA: data }, encoding: 'utf8' });
      const state = JSON.parse(read.stdout.trim());
      assert.ok(state && state.activePlan && state.activePlan.endsWith(path.join('plans', 'x')), read.stdout + read.stderr);
      assert.ok(!fs.existsSync(path.join(data, 'state', `rig-session-${sid}.json`)), 'session state is not split into the data dir');
    } finally {
      fs.rmSync(path.join(os.tmpdir(), `rig-session-${sid}.json`), { force: true });
    }
  });
});

describe('state pruning', () => {
  const lib = path.join(PLUGIN_ROOT, 'hooks', 'lib', 'plugin-data-dir.cjs');
  const guardLib = path.join(PLUGIN_ROOT, 'hooks', 'lib', 'verify-guard-turn-counter.cjs');
  const old = (file, days) => {
    const t = new Date(Date.now() - days * 86400000);
    fs.utimesSync(file, t, t);
  };

  it('pruneStaleState deletes rig-* files older than 7 days in the data dir and keeps fresh and foreign ones', () => {
    const data = mkTmp('rig-data-');
    const state = path.join(data, 'state');
    fs.mkdirSync(state, { recursive: true });
    for (const n of ['rig-reminder-old.json', 'rig-git-cache-old.json', 'rig-reminder-new.json', 'foreign-old.json']) fs.writeFileSync(path.join(state, n), '{}');
    for (const n of ['rig-reminder-old.json', 'rig-git-cache-old.json', 'foreign-old.json']) old(path.join(state, n), 8);
    const out = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(lib)}).pruneStaleState())`], { env: { ...process.env, CLAUDE_PLUGIN_DATA: data }, encoding: 'utf8' });
    assert.strictEqual(out.stdout.trim(), '2');
    assert.deepStrictEqual(fs.readdirSync(state).sort(), ['foreign-old.json', 'rig-reminder-new.json']);
  });

  it('session-init triggers the prune', () => {
    const root = installPluginCopy();
    const data = mkTmp('rig-data-');
    const state = path.join(data, 'state');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'rig-session-stale.json'), '{}');
    old(path.join(state, 'rig-session-stale.json'), 30);
    fs.writeFileSync(path.join(state, 'rig-reminder-stale.json'), '{}');
    old(path.join(state, 'rig-reminder-stale.json'), 30);
    assert.strictEqual(runSessionInit(root, { CLAUDE_PLUGIN_DATA: data }).status, 0);
    assert.ok(!fs.existsSync(path.join(state, 'rig-reminder-stale.json')));
  });

  it('the verify-guard prune filters by prefix before capping (600 foreign files do not hide stale counters)', () => {
    const data = mkTmp('rig-data-');
    const state = path.join(data, 'state');
    fs.mkdirSync(state, { recursive: true });
    // aaa-* sorts before rig-verify-guard-* and used to fill the 500-entry scan window
    for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(state, `aaa-${i}`), '');
    const stale = path.join(state, 'rig-verify-guard-stale.json');
    fs.writeFileSync(stale, '{}');
    old(stale, 3);
    spawnSync(process.execPath, ['-e', `require(${JSON.stringify(guardLib)}).pruneStaleStateFiles()`], { env: { ...process.env, CLAUDE_PLUGIN_DATA: data }, encoding: 'utf8' });
    assert.ok(!fs.existsSync(stale), 'stale verify-guard file pruned');
  });
});

describe('session-init whole-context cap', () => {
  it('truncates additionalContext to 10,000 chars when assertions are huge', () => {
    const root = installPluginCopy();
    const project = mkTmp('rig-plugin-project-');
    fs.mkdirSync(path.join(project, '.claude'));
    fs.writeFileSync(path.join(project, '.claude', '.rig.json'), JSON.stringify({ assertions: ['y'.repeat(20000)] }));
    const res = spawnSync(process.execPath, [path.join(root, 'hooks', 'session-init.cjs')], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'cap-test' }),
      cwd: project, env: { ...process.env, HOME: project, USERPROFILE: project, CLAUDE_ENV_FILE: '', CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: '' }, encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(JSON.parse(res.stdout).hookSpecificOutput.additionalContext.length <= 10000);
  });
});
