#!/usr/bin/env node
/**
 * The release scripts must fail loudly when the kit is not under .claude/ (it moved to plugins/rig in 2.0).
 * Run: node --test scripts/release-kit-source-guard.test.cjs
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { assertKitSourcePresent } = require('./release-kit-source-guard.cjs');

const ROOT = path.resolve(__dirname, '..');
const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-release-guard-'));
  dirs.push(d);
  return d;
};

describe('assertKitSourcePresent', () => {
  it('throws for this repo layout (kit in plugins/rig, .claude is dev-only)', () => {
    assert.throws(() => assertKitSourcePresent(ROOT), /release packaging moves to phase 5/);
  });
  it('passes when .claude holds the kit', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, '.claude', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(d, '.claude', 'skills'));
    fs.mkdirSync(path.join(d, '.claude', 'agents'));
    fs.writeFileSync(path.join(d, '.claude', 'hooks', 'session-init.cjs'), '');
    assert.doesNotThrow(() => assertKitSourcePresent(d));
  });
});

describe('release scripts refuse to build without the kit', () => {
  it('prepare-release-assets exits non-zero and writes no archive', () => {
    const res = spawnSync(process.execPath, [path.join(__dirname, 'prepare-release-assets.cjs'), '0.0.0'], { cwd: ROOT, encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /kit source missing/);
    assert.ok(!fs.existsSync(path.join(ROOT, 'dist', 'rig.zip')));
  });
  it('generate-release-manifest exits non-zero and writes no manifest', () => {
    const before = fs.existsSync(path.join(ROOT, 'release-manifest.json'));
    const res = spawnSync(process.execPath, [path.join(__dirname, 'generate-release-manifest.cjs'), '0.0.0'], { cwd: ROOT, encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /kit source missing/);
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'release-manifest.json')), before);
  });
});
