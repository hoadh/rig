#!/usr/bin/env node
/** Tests for verify-guard-config: source ladder, project-can-only-raise, anchored paths, pattern vetting. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadVerifyGuardConfig, vetPatterns } = require('../verify-guard-config.cjs');

const roots = [];
test.after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function world(globalCfg, projectCfg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-vgc-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  if (globalCfg) fs.writeFileSync(path.join(home, '.claude', '.rig.json'), JSON.stringify(globalCfg));
  if (projectCfg) fs.writeFileSync(path.join(proj, '.claude', '.rig.json'), JSON.stringify(projectCfg));
  return { home, proj };
}
const load = (w, projectDir = w.proj) => loadVerifyGuardConfig({ homeDir: w.home, projectDir });

test('default is remind from source default', () => {
  const c = load(world());
  assert.strictEqual(c.mode, 'remind');
  assert.strictEqual(c.source, 'default');
});

test('global mode applies; invalid mode ignored', () => {
  assert.deepStrictEqual([load(world({ verifyGuard: { mode: 'block' } })).mode, load(world({ verifyGuard: { mode: 'block' } })).source], ['block', 'global']);
  assert.strictEqual(load(world({ verifyGuard: { mode: 'loud' } })).mode, 'remind');
});

test('project may raise but never lower the mode', () => {
  const raise = load(world({ verifyGuard: { mode: 'remind' } }, { verifyGuard: { mode: 'block' } }));
  assert.deepStrictEqual([raise.mode, raise.source], ['block', 'project']);
  const lower = load(world({ verifyGuard: { mode: 'block' } }, { verifyGuard: { mode: 'off' } }));
  assert.deepStrictEqual([lower.mode, lower.source], ['block', 'global']);
  const fromOff = load(world({ verifyGuard: { mode: 'off' } }, { verifyGuard: { mode: 'block' } }));
  assert.strictEqual(fromOff.mode, 'block');
});

test('global toggle false is final; project cannot re-enable or disable', () => {
  assert.strictEqual(load(world({ hooks: { 'verify-completion-guard': false } }, { verifyGuard: { mode: 'block' } })).mode, 'off');
  assert.strictEqual(load(world(null, { hooks: { 'verify-completion-guard': false } })).mode, 'remind');
});

test('project config is read from projectDir only (a sub directory has none)', () => {
  const w = world(null, { verifyGuard: { mode: 'block' } });
  const sub = path.join(w.proj, 'sub');
  fs.mkdirSync(sub);
  assert.strictEqual(load(w, sub).mode, 'remind');
  assert.strictEqual(load(w, '').mode, 'remind');
});

test('extraCommandPatterns: global only, vetted', () => {
  const c = load(world({ verifyGuard: { extraCommandPatterns: ['^make e2e$', '(a+)+', '['] } }, { verifyGuard: { extraCommandPatterns: ['^evil$'] } }));
  assert.strictEqual(c.extraPatterns.length, 1);
  assert.ok(c.extraPatterns[0].test('make e2e'));
  assert.strictEqual(c.rejected.length, 2);
});

test('vetPatterns caps count and length', () => {
  const many = Array.from({ length: 25 }, (_, i) => `^x${i}$`);
  assert.strictEqual(vetPatterns(many).patterns.length, 20);
  assert.strictEqual(vetPatterns(['a'.repeat(201)]).patterns.length, 0);
  assert.strictEqual(vetPatterns('nope').patterns.length, 0);
});

test('corrupt config files fall back to defaults', () => {
  const w = world();
  fs.writeFileSync(path.join(w.home, '.claude', '.rig.json'), '{not json');
  assert.strictEqual(load(w).mode, 'remind');
});

test('vetPatterns rejects ReDoS shapes the old single regex missed', () => {
  const { patterns, rejected } = vetPatterns(['((a+))+$', '(a|aa)+$', '(a{1,})+$', '(a+)+$', '^make e2e$']);
  assert.strictEqual(patterns.length, 1);
  assert.strictEqual(rejected.length, 4);
  assert.ok(patterns[0].test('make e2e'));
});
