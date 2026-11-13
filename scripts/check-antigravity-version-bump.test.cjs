// Run: node --test scripts/check-antigravity-version-bump.test.cjs
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { decide, parseManifestVersion, check, UnreadableBaseError } = require('./check-antigravity-version-bump.cjs');

const v = (rig, n) => ({ rig, n });
const F = 'antigravity/rig/skills/plan/SKILL.md';

describe('decide', () => {
  it('passes when nothing shipped changed (tests and fixtures do not count)', () => {
    assert.strictEqual(decide({ changedFiles: [], baseVersion: v('2.0.9', 1), headVersion: v('2.0.9', 1) }).ok, true);
    assert.strictEqual(decide({ changedFiles: ['scripts/antigravity/a.test.cjs', 'scripts/antigravity/hooks/__fixtures__/x.json', 'docs/a.md'], baseVersion: v('2.0.9', 1), headVersion: v('2.0.9', 1) }).ok, true);
  });
  it('test helpers under scripts/antigravity/**/__tests__/ do not count; shipped __tests__ inside antigravity/rig/ do (L9)', () => {
    const same = { baseVersion: v('2.0.9', 1), headVersion: v('2.0.9', 1) };
    assert.strictEqual(decide({ changedFiles: ['scripts/antigravity/hooks/__tests__/agy-test-layout.cjs', 'scripts/antigravity/hooks/__tests__/transcript-builder.cjs'], ...same }).ok, true);
    assert.strictEqual(decide({ changedFiles: ['antigravity/rig/skills/browser/scripts/__tests__/x.test.js'], ...same }).ok, false);
    assert.strictEqual(decide({ changedFiles: ['scripts/antigravity/hooks/antigravity-hook-adapter.cjs'], ...same }).ok, false);
  });
  it('fails on a change without a bump', () => {
    const r = decide({ changedFiles: [F], baseVersion: v('2.0.9', 1), headVersion: v('2.0.9', 1) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /agy-version\.json/);
    assert.strictEqual(decide({ changedFiles: ['scripts/antigravity/build-antigravity-plugin.cjs'], baseVersion: v('2.0.9', 2), headVersion: v('2.0.9', 1) }).ok, false);
  });
  it('passes with a greater n or a greater Rig version (n may restart)', () => {
    assert.strictEqual(decide({ changedFiles: [F], baseVersion: v('2.0.9', 1), headVersion: v('2.0.9', 2) }).ok, true);
    assert.strictEqual(decide({ changedFiles: [F], baseVersion: v('2.0.9', 4), headVersion: v('2.0.10', 1) }).ok, true);
    assert.strictEqual(decide({ changedFiles: [F], baseVersion: v('2.0.10', 1), headVersion: v('2.0.9', 5) }).ok, false);
  });
  it('first release and unreadable head version', () => {
    assert.strictEqual(decide({ changedFiles: [F], baseVersion: null, headVersion: v('2.0.9', 1) }).ok, true);
    assert.strictEqual(decide({ changedFiles: [F], baseVersion: v('2.0.9', 1), headVersion: null }).ok, false);
  });
});

describe('parseManifestVersion', () => {
  it('reads <rig>-agy.<n> only', () => {
    assert.deepStrictEqual(parseManifestVersion('{"version":"2.0.10-agy.3"}'), { rig: '2.0.10', n: 3 });
    assert.deepStrictEqual(parseManifestVersion('{"version":"2.1.0-beta.1-agy.2"}'), { rig: '2.1.0-beta.1', n: 2 });
    assert.strictEqual(parseManifestVersion('{"version":"2.0.10"}'), null);
    assert.strictEqual(parseManifestVersion('not json'), null);
  });
});

describe('check against a temp git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-agy-bump-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const manifest = (version) => JSON.stringify({ name: 'rig', version });

  it('detects missing and present bumps', () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    git('config', 'commit.gpgsign', 'false');
    write('antigravity/rig/.antigravity-plugin/plugin.json', manifest('2.0.9-agy.1'));
    write(F, 'a');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'topic');
    write(F, 'b');
    git('commit', '-qam', 'change');
    assert.strictEqual(check(dir, 'main').ok, false);
    write('antigravity/rig/.antigravity-plugin/plugin.json', manifest('2.0.9-agy.2'));
    git('commit', '-qam', 'bump');
    assert.strictEqual(check(dir, 'main').ok, true);
  });

  it('a base manifest without a readable version cannot be compared (not a first release, L9)', () => {
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'broken-base');
    write('antigravity/rig/.antigravity-plugin/plugin.json', manifest('garbage'));
    git('commit', '-qam', 'broken base');
    git('checkout', '-q', '-b', 'topic2');
    write('antigravity/rig/.antigravity-plugin/plugin.json', manifest('2.0.9-agy.1'));
    write(F, 'c');
    git('commit', '-qam', 'change on a broken base');
    assert.throws(() => check(dir, 'broken-base'), UnreadableBaseError);
  });
});
