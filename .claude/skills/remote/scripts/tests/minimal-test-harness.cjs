'use strict';
/**
 * Minimal plain-node test harness (no deps). Usage:
 *   const t = require('./minimal-test-harness.cjs');
 *   t.test('name', () => { t.eq(a, b); });  // sync or async
 *   t.done();   // prints summary, exit code 1 on any failure
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Never read the developer's real ~/.gitconfig (the known-good baseline hashes it, review M-B): run every
// test under a throwaway HOME. Opt-in real-tool scenarios (real claude/ssh) need the real HOME for auth.
if (!process.env.RIG_E2E_CLAUDE && !process.env.RIG_E2E_SSH && !process.env.RIG_TEST_REAL_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-test-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.XDG_CONFIG_HOME;
  process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ } });
}

const queue = [];
const test = (name, fn) => queue.push({ name, fn });

async function done() {
  let failed = 0;
  for (const { name, fn } of queue) {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${name}\n       ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n       ')}`);
    }
  }
  console.log(`${queue.length - failed}/${queue.length} passed`);
  if (failed) process.exitCode = 1;
}

/** Assert fn throws RemoteError-like with optional exitCode/class. */
function throwsRemote(fn, { exitCode, cls } = {}) {
  try { fn(); } catch (e) {
    if (exitCode !== undefined) assert.strictEqual(e.exitCode, exitCode, `exitCode ${e.exitCode} != ${exitCode} (${e.message})`);
    if (cls !== undefined) assert.strictEqual(e.class, cls);
    return e;
  }
  throw new assert.AssertionError({ message: 'expected function to throw' });
}

async function rejectsRemote(promise, { exitCode, cls } = {}) {
  try { await promise; } catch (e) {
    if (exitCode !== undefined) assert.strictEqual(e.exitCode, exitCode, `exitCode ${e.exitCode} != ${exitCode} (${e.message})`);
    if (cls !== undefined) assert.strictEqual(e.class, cls, `class ${e.class} != ${cls}`);
    return e;
  }
  throw new assert.AssertionError({ message: 'expected promise to reject' });
}

module.exports = { test, done, throwsRemote, rejectsRemote, eq: assert.deepStrictEqual, ok: assert.ok, assert };
