/**
 * Test helper: builds the generated-plugin layout in a temp dir (real Rig hooks + adapter files + Antigravity
 * scripts) and runs the adapter the way Antigravity does (cwd = plugin dir, payload on stdin, PLUGIN_* env).
 * Not a test file and not copied into the plugin (the generator copies only top-level hooks/*.cjs).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const HOOKS_SRC = path.join(REPO, 'plugins', 'rig', 'hooks');
const AGY_HOOKS = path.resolve(__dirname, '..');
const AGY_SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts');
const FIXTURES = path.join(AGY_HOOKS, '__fixtures__');

const copyCjs = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) if (f.endsWith('.cjs') && !f.endsWith('.test.cjs')) fs.copyFileSync(path.join(from, f), path.join(to, f));
};

function makeLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-layout-'));
  const pluginRoot = path.join(root, 'rig');
  copyCjs(HOOKS_SRC, path.join(pluginRoot, 'hooks'));
  copyCjs(path.join(HOOKS_SRC, 'lib'), path.join(pluginRoot, 'hooks', 'lib'));
  copyCjs(AGY_HOOKS, path.join(pluginRoot, 'hooks'));
  copyCjs(AGY_SCRIPTS, path.join(pluginRoot, 'scripts'));
  const workspace = path.join(root, 'workspace');
  const pluginData = path.join(root, 'plugin-data');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  for (const d of [workspace, pluginData, home, tmp]) fs.mkdirSync(d, { recursive: true });
  return { root, pluginRoot, workspace, pluginData, home, tmp, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function envFor(layout, extra = {}) {
  const env = { ...process.env, HOME: layout.home, USERPROFILE: layout.home, TMPDIR: layout.tmp, TEMP: layout.tmp, TMP: layout.tmp,
    PLUGIN_ROOT: layout.pluginRoot, PLUGIN_DATA: layout.pluginData, ANTIGRAVITY_CONVERSATION_ID: extra.conversationId || '' };
  for (const k of Object.keys(env)) if (/^(CLAUDE_|RIG_)/.test(k)) delete env[k];
  return { ...env, ...extra.env };
}

/** @returns {{status: number, stdout: string, stderr: string, ms: number}} */
function runAdapter(layout, hook, payload, opts = {}) {
  const t0 = process.hrtime.bigint();
  const res = spawnSync(process.execPath, [path.join(layout.pluginRoot, 'hooks', 'antigravity-hook-adapter.cjs'), hook], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    cwd: layout.pluginRoot,
    env: envFor(layout, { conversationId: payload && payload.conversationId, env: opts.env }),
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

const fixture = (name, over = {}, layout) => {
  const raw = fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8');
  // Swap the workspace after parsing: Windows paths have backslashes that would break raw JSON text.
  const swap = (v) => (typeof v === 'string' ? v.split('/home/user/work/project').join(layout.workspace)
    : Array.isArray(v) ? v.map(swap)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
  const j = JSON.parse(raw);
  return { ...(layout ? swap(j) : j), ...over };
};

module.exports = { makeLayout, runAdapter, fixture, envFor, REPO, FIXTURES };
