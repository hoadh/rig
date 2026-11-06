#!/usr/bin/env node
/**
 * Tests for check-plugin-version-bump.cjs: the pure decision and the git-backed check in a temp repo.
 * Run: node --test scripts/check-plugin-version-bump.test.cjs
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { decide, parseVersion, compareSemver, check } = require('./check-plugin-version-bump.cjs');

describe('decide', () => {
  const f = 'plugins/rig/hooks/session-init.cjs';
  it('passes when nothing under plugins/rig changed', () => {
    assert.strictEqual(decide({ changedFiles: ['README.md', 'scripts/x.cjs'], baseVersion: '1.0.0', headVersion: '1.0.0' }).ok, true);
  });
  it('fails when plugins/rig changed and the version is the same', () => {
    const r = decide({ changedFiles: [f], baseVersion: '2.0.0', headVersion: '2.0.0' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /must be greater/);
    assert.match(r.reason, /session-init\.cjs/);
  });
  it('passes when the version changed', () => {
    assert.strictEqual(decide({ changedFiles: [f], baseVersion: '2.0.0-beta.1', headVersion: '2.0.0-beta.2' }).ok, true);
  });
  it('passes on the first manifest (base has none)', () => {
    assert.strictEqual(decide({ changedFiles: [f], baseVersion: null, headVersion: '2.0.0-beta.1' }).ok, true);
  });
  it('fails when the head manifest has no readable version', () => {
    assert.strictEqual(decide({ changedFiles: [f], baseVersion: '1.0.0', headVersion: null }).ok, false);
  });
  it('ignores look-alike paths outside plugins/rig/', () => {
    assert.strictEqual(decide({ changedFiles: ['plugins/rig-other/x', 'docs/plugins/rig/x'], baseVersion: '1', headVersion: '1' }).ok, true);
  });
});

describe('semver rule', () => {
  const f = 'plugins/rig/x.cjs';
  const ok = (base, head) => decide({ changedFiles: [f], baseVersion: base, headVersion: head }).ok;
  it('rejects a downgrade and a whitespace-only change', () => {
    assert.strictEqual(ok('2.0.0', '1.0.0'), false);
    assert.strictEqual(ok('2.0.0', '2.0.0 '), false);
    assert.strictEqual(ok('2.0.0', 'v2.0.1'), false);
  });
  it('orders prereleases per semver (beta.2 < beta.10 < release)', () => {
    assert.strictEqual(ok('2.0.0-beta.2', '2.0.0-beta.10'), true);
    assert.strictEqual(ok('2.0.0-beta.10', '2.0.0-beta.2'), false);
    assert.strictEqual(ok('2.0.0-beta.1', '2.0.0'), true);
    assert.strictEqual(ok('2.0.0', '2.0.1-alpha'), true);
    assert.strictEqual(ok('2.0.0', '2.0.0-rc.1'), false);
    assert.strictEqual(compareSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
    assert.strictEqual(compareSemver('1.0.0-1', '1.0.0-alpha'), -1);
  });
  it('requires the marketplace entry version, when present, to equal plugin.json', () => {
    assert.strictEqual(decide({ changedFiles: [], baseVersion: '1.0.0', headVersion: '1.0.1', marketplaceVersion: '1.0.0' }).ok, false);
    assert.strictEqual(decide({ changedFiles: [], baseVersion: '1.0.0', headVersion: '1.0.1', marketplaceVersion: '1.0.1' }).ok, true);
    assert.strictEqual(decide({ changedFiles: [], baseVersion: '1.0.0', headVersion: '1.0.1' }).ok, true, 'no marketplace version: nothing to compare');
  });
});

describe('parseVersion', () => {
  it('reads version, rejects junk', () => {
    assert.strictEqual(parseVersion('{"version":"1.2.3"}'), '1.2.3');
    assert.strictEqual(parseVersion('{"version":""}'), null);
    assert.strictEqual(parseVersion('{"version":5}'), null);
    assert.strictEqual(parseVersion('not json'), null);
  });
});

describe('check in a git repo', () => {
  const dirs = [];
  after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
  function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-vbump-'));
    dirs.push(dir);
    git(dir, 'init', '-q', '-b', 'main');
    return dir;
  }
  const write = (dir, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const manifest = (v) => JSON.stringify({ name: 'rig', version: v });

  it('fails for a plugin change without a bump, passes after the bump', () => {
    const dir = repo();
    write(dir, 'plugins/rig/.claude-plugin/plugin.json', manifest('1.0.0'));
    write(dir, 'plugins/rig/hooks/a.cjs', '1');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    git(dir, 'checkout', '-qb', 'feature');
    write(dir, 'plugins/rig/hooks/a.cjs', '2');
    git(dir, 'commit', '-qam', 'change');
    assert.strictEqual(check(dir, 'main').ok, false);
    write(dir, 'plugins/rig/.claude-plugin/plugin.json', manifest('1.0.1'));
    git(dir, 'commit', '-qam', 'bump');
    assert.strictEqual(check(dir, 'main').ok, true);
  });

  it('passes for a branch that only touches other paths', () => {
    const dir = repo();
    write(dir, 'plugins/rig/.claude-plugin/plugin.json', manifest('1.0.0'));
    write(dir, 'README.md', 'a');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    git(dir, 'checkout', '-qb', 'feature');
    write(dir, 'README.md', 'b');
    git(dir, 'commit', '-qam', 'docs only');
    assert.strictEqual(check(dir, 'main').ok, true);
  });

  it('fails when the committed marketplace entry version differs from plugin.json', () => {
    const dir = repo();
    write(dir, 'plugins/rig/.claude-plugin/plugin.json', manifest('1.0.0'));
    write(dir, '.claude-plugin/marketplace.json', JSON.stringify({ plugins: [{ name: 'rig', version: '0.9.0' }] }));
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    const r = check(dir, 'main');
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /marketplace/);
  });

  it('CLI exits 2 when the base ref does not exist', () => {
    const res = spawnSync(process.execPath, [path.join(__dirname, 'check-plugin-version-bump.cjs'), '--base', 'no-such-ref-xyz'], { encoding: 'utf8' });
    assert.strictEqual(res.status, 2);
    assert.match(res.stderr, /Cannot compare/);
  });
});
