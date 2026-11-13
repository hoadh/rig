'use strict';
/** refresh-runtime-copy.cjs: fresh home, current, newer runtime kept (exit 3), settings.json untouched, bad args. */
const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'refresh-runtime-copy.cjs');
const PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
const roots = [];
const freshHome = () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-refresh-rt-'));
  roots.push(h);
  return h;
};
const run = (home, args = ['--json']) => cp.spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
});
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

try {
  // fresh home: copied, runtime stamped, settings.json byte-identical, nothing written outside ~/.claude/rig
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const settings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(settings, '{"statusLine":{"type":"command","command":"keep"}}\n');
  const before = sha(settings);
  let r = run(home);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual([out.status, out.version], ['copied', PLUGIN_VERSION]);
  assert.strictEqual(fs.readFileSync(path.join(out.dir, 'VERSION'), 'utf8').trim(), PLUGIN_VERSION);
  assert.ok(fs.existsSync(path.join(out.dir, 'remote', 'worker.cjs')));
  assert.strictEqual(sha(settings), before, 'settings.json untouched');
  assert.deepStrictEqual(fs.readdirSync(path.join(home, '.claude')).sort(), ['rig', 'settings.json']);

  // second run: current, plain text without --json
  r = run(home, []);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^runtime current: /);

  // a newer runtime is kept: exit 3, status newer-present, VERSION unchanged
  fs.writeFileSync(path.join(home, '.claude', 'rig', 'runtime', 'VERSION'), '99.0.0\n');
  r = run(home);
  assert.strictEqual(r.status, 3);
  assert.deepStrictEqual([JSON.parse(r.stdout).status, JSON.parse(r.stdout).version], ['newer-present', '99.0.0']);
  assert.strictEqual(fs.readFileSync(path.join(home, '.claude', 'rig', 'runtime', 'VERSION'), 'utf8').trim(), '99.0.0');

  // an older runtime is upgraded
  fs.writeFileSync(path.join(home, '.claude', 'rig', 'runtime', 'VERSION'), '0.0.1\n');
  r = run(home);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(JSON.parse(r.stdout).status, 'copied');

  // unknown argument: usage error, nothing written
  const empty = freshHome();
  r = run(empty, ['--force']);
  assert.strictEqual(r.status, 2);
  assert.ok(!fs.existsSync(path.join(empty, '.claude')));
  console.log('refresh-runtime-copy: 5/5 passed');
} finally {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
}
