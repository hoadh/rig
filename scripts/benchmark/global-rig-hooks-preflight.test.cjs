#!/usr/bin/env node
/** Tests for the benchmark rig-arm preflight (fixture HOMEs only). */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findGlobalRigHooks, assertNoGlobalRigHooks } = require('./global-rig-hooks-preflight.cjs');

const dirs = [];
const homeWith = (settings) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-bench-home-'));
  dirs.push(home);
  if (settings !== undefined) { fs.mkdirSync(path.join(home, '.claude')); fs.writeFileSync(path.join(home, '.claude', 'settings.json'), settings); }
  return home;
};
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const rig1x = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/session-init.cjs"' }] }] } });

describe('rig arm preflight', () => {
  it('finds registered Rig 1.x hooks and ignores user hooks and bad json', () => {
    assert.strictEqual(findGlobalRigHooks(rig1x).length, 1);
    assert.deepStrictEqual(findGlobalRigHooks(JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node /opt/mine.js' }] }] } })), []);
    assert.deepStrictEqual(findGlobalRigHooks('{ nope'), []);
  });
  it('refuses when the real HOME has 1.x Rig hooks, and passes without them', () => {
    assert.throws(() => assertNoGlobalRigHooks(homeWith(rig1x)), /every hook twice/);
    assert.doesNotThrow(() => assertNoGlobalRigHooks(homeWith('{}')));
    assert.doesNotThrow(() => assertNoGlobalRigHooks(homeWith()));
  });
});
