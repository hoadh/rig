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
  const res = spawnSync(process.execPath, [path.join(root, 'hooks', 'session-init.cjs')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: `t-${Date.now()}` }),
    cwd: project,
    env: { ...process.env, CLAUDE_ENV_FILE: '', CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: '', ...env },
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
    assert.ok(ctx.length < 10000 + 5000, `context stays bounded (${ctx.length})`);
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
