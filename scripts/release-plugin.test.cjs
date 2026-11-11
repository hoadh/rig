#!/usr/bin/env node
/**
 * Tests for release-plugin.cjs against a temp git repo: dry run, every refusal, apply through an injected fake TTY,
 * prerelease ordering, the marketplace JSON written, and the CI ref check.
 * Run: node --test scripts/release-plugin.test.cjs
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { release, latestTag, tagArgs, pinnedEntry, checkMarketplaceRef, changelogProblem } = require('./release-plugin.cjs');
const { compareSemver } = require('./check-plugin-version-bump.cjs');

// Isolate from the developer's git config (signing, hooks, identity). GIT_CONFIG_GLOBAL must be a real file: git cannot open
// Windows' os.devNull (\\.\nul).
const EMPTY_GLOBAL_CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-release-gitcfg-')), 'gitconfig');
fs.writeFileSync(EMPTY_GLOBAL_CONFIG, '');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: EMPTY_GLOBAL_CONFIG, GIT_CONFIG_NOSYSTEM: '1' };
delete GIT_ENV.CLAUDECODE;
const URL = 'https://github.com/example/rig.git';
const tmpDirs = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (cwd, rel, text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };

/** Temp repo on `main` with a plugin manifest, a marketplace entry without a ref and a passing `npm test`. */
function fixture({ version = '2.0.0-beta.1', test = 'node -e 0' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-release-'));
  tmpDirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  write(dir, 'plugins/rig/.claude-plugin/plugin.json', JSON.stringify({ name: 'rig', version }));
  write(dir, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'm', plugins: [{ name: 'rig', version, source: { source: 'git-subdir', url: URL, path: 'plugins/rig' } }] }));
  write(dir, 'package.json', JSON.stringify({ name: 'f', version, scripts: { test } }));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/** Collecting io; `tty` fakes a terminal, `answer` is the y/N reply. */
function makeIo(cwd, { tty = true, answer = true, env = GIT_ENV, ancestors = [] } = {}) {
  const out = [];
  const errs = [];
  return {
    io: { cwd, env, stdinIsTTY: tty, stdoutIsTTY: tty, ancestors, log: (m) => out.push(m), err: (m) => errs.push(m), confirm: async () => answer },
    out, errs,
  };
}
const flags = (o = {}) => ({ apply: false, allowBranch: false, skipTests: false, ...o });
const marketplace = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/marketplace.json'), 'utf8'));

describe('changelogProblem', () => {
  it('needs a dated section for a stable version only', () => {
    assert.strictEqual(changelogProblem('## 2.0.7 (2026-11-11)\n', '2.0.7'), null);
    assert.match(changelogProblem('## 2.0.7 (unreleased)\n', '2.0.7'), /unreleased/);
    assert.match(changelogProblem('## 2.0.70 (2026-11-11)\n', '2.0.7'), /has no/);
    assert.match(changelogProblem('## 2x0x7 (2026-11-11)\n', '2.0.7'), /has no/, 'dots are literal');
    assert.strictEqual(changelogProblem('', '2.1.0-beta.1'), null, 'betas have no section of their own');
  });
});

describe('version ordering', () => {
  it('orders betas before the release', () => {
    assert.strictEqual(compareSemver('2.0.0-beta.1', '2.0.0-beta.2'), -1);
    assert.strictEqual(compareSemver('2.0.0-beta.2', '2.0.0'), -1);
    assert.strictEqual(compareSemver('2.0.0-beta.10', '2.0.0-beta.9'), 1);
  });
  it('latestTag picks the highest semver and ignores junk tags', () => {
    assert.strictEqual(latestTag(['v1.1.0', 'v2.0.0-beta.2', 'v2.0.0-beta.1', 'v2.0.0', 'vnext', 'v2.0']), 'v2.0.0');
    assert.strictEqual(latestTag(['v2.0.0-beta.1', 'v2.0.0-beta.2']), 'v2.0.0-beta.2');
    assert.strictEqual(latestTag([]), null);
  });
  it('tagArgs signs only when signing is configured', () => {
    assert.deepStrictEqual(tagArgs({ version: '2.0.0', sha: 'abc', signingConfigured: false }).slice(0, 2), ['tag', '-a']);
    assert.deepStrictEqual(tagArgs({ version: '2.0.0', sha: 'abc', signingConfigured: true }).slice(0, 2), ['tag', '-s']);
  });
  it('pinnedEntry writes ref and sha, keeps url/path, and drops a version copy (plugin.json is the only version)', () => {
    const e = pinnedEntry({ name: 'rig', version: '1.9.0', source: { source: 'git-subdir', url: URL, path: 'plugins/rig' } }, { version: '2.0.0', sha: 'abc' });
    assert.deepStrictEqual(e.source, { source: 'git-subdir', url: URL, path: 'plugins/rig', ref: 'v2.0.0', sha: 'abc' });
    assert.strictEqual(e.version, undefined);
    assert.strictEqual(e.name, 'rig');
  });
});

describe('dry run', () => {
  it('prints the plan and writes nothing', async () => {
    const dir = fixture();
    const before = git(dir, 'rev-parse', 'HEAD');
    const { io, out, errs } = makeIo(dir);
    assert.strictEqual(await release(flags(), io), 0, errs.join('\n'));
    assert.match(out.join('\n'), /Dry run: Rig 2\.0\.0-beta\.1/);
    assert.match(out.join('\n'), new RegExp(before));
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), before);
    assert.strictEqual(git(dir, 'tag', '--list'), '');
    assert.strictEqual(marketplace(dir).plugins[0].source.ref, undefined);
  });
  it('runs npm test for real and reports a failure', async () => {
    const dir = fixture({ test: 'node -e "process.exit(1)"' });
    const { io, errs } = makeIo(dir);
    assert.strictEqual(await release(flags(), io), 1);
    assert.match(errs.join('\n'), /npm test failed/);
  });
  it('--skip-tests skips a failing suite and says so', async () => {
    const dir = fixture({ test: 'node -e "process.exit(1)"' });
    const { io, out } = makeIo(dir);
    assert.strictEqual(await release(flags({ skipTests: true }), io), 0);
    assert.match(out.join('\n'), /tests skipped/);
  });
});

describe('refusals', () => {
  const refused = async (dir, opts, ioOpts, pattern) => {
    const before = git(dir, 'rev-parse', 'HEAD');
    const tagsBefore = git(dir, 'tag', '--list');
    const { io, errs } = makeIo(dir, ioOpts);
    assert.strictEqual(await release(flags(opts), io), 1);
    assert.match(errs.join('\n'), pattern);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), before, 'HEAD must not move');
    assert.strictEqual(git(dir, 'tag', '--list'), tagsBefore, 'no tag may be created');
  };
  it('dirty tree', async () => {
    const dir = fixture();
    write(dir, 'scratch.txt', 'x');
    await refused(dir, { skipTests: true }, {}, /not clean/);
  });
  it('not on main without --allow-branch', async () => {
    const dir = fixture();
    git(dir, 'checkout', '-q', '-b', 'feat/x');
    await refused(dir, { skipTests: true }, {}, /not main/);
  });
  it('allows a branch with --allow-branch', async () => {
    const dir = fixture();
    git(dir, 'checkout', '-q', '-b', 'feat/x');
    const { io, out } = makeIo(dir);
    assert.strictEqual(await release(flags({ skipTests: true, allowBranch: true }), io), 0);
    assert.doesNotMatch(out.join('\n'), /install:/, 'dry run prints no next steps');
  });
  it('a branch release tells testers to add the marketplace from the branch that carries the pin', async () => {
    const dir = fixture();
    git(dir, 'checkout', '-q', '-b', 'feat/x');
    const { io, out, errs } = makeIo(dir);
    assert.strictEqual(await release(flags({ apply: true, allowBranch: true }), io), 0, errs.join('\n'));
    assert.match(out.join('\n'), /install: \/plugin marketplace add example\/rig#feat\/x, then \/plugin install rig@rig-marketplace/);
    assert.strictEqual(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/x', 'a beta branch carries the pin itself');
    assert.match(out.join('\n'), /git push origin feat\/x v2\.0\.0-beta\.1/);
    assert.doesNotMatch(out.join('\n'), /gh pr create/);
  });
  it('refuses when the release branch already exists, and changes nothing', async () => {
    const dir = fixture();
    git(dir, 'branch', 'release/v2.0.0-beta.1');
    await refused(dir, { apply: true }, {}, /release\/v2\.0\.0-beta\.1 already exists/);
  });
  it('version already tagged', async () => {
    const dir = fixture();
    git(dir, 'tag', '-a', 'v2.0.0-beta.1', '-m', 'x');
    await refused(dir, { skipTests: true }, {}, /already tagged/);
  });
  it('version not greater than the latest tag', async () => {
    const dir = fixture();
    git(dir, 'tag', '-a', 'v2.0.0', '-m', 'x');
    await refused(dir, { skipTests: true }, {}, /not greater than the latest tag v2\.0\.0/);
  });
  it('invalid manifest version', async () => {
    const dir = fixture({ version: 'v2' });
    await refused(dir, { skipTests: true }, {}, /not strict semver/);
  });
  it('a stable version with an undated CHANGELOG section', async () => {
    const dir = fixture({ version: '2.0.1' });
    write(dir, 'CHANGELOG.md', '# Changelog\n\n## 2.0.1 (unreleased)\n\n* x\n\n## 2.0.0 (2026-11-09)\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'changelog');
    await refused(dir, { skipTests: true }, {}, /change "## 2\.0\.1 \(unreleased\)" to "## 2\.0\.1 \(<YYYY-MM-DD>\)"/);
  });
  it('a stable version without a CHANGELOG section', async () => {
    const dir = fixture({ version: '2.0.1' });
    await refused(dir, { skipTests: true }, {}, /CHANGELOG\.md has no "## 2\.0\.1 \(<YYYY-MM-DD>\)" section/);
  });
  it('a stable version with a dated CHANGELOG section passes the dry run', async () => {
    const dir = fixture({ version: '2.0.1' });
    write(dir, 'CHANGELOG.md', '# Changelog\n\n## 2.0.1 (2026-11-11)\n\n* x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'changelog');
    const { io, errs } = makeIo(dir);
    assert.strictEqual(await release(flags({ skipTests: true }), io), 0, errs.join('\n'));
  });
  it('--apply with --skip-tests', async () => {
    const dir = fixture();
    await refused(dir, { apply: true, skipTests: true }, {}, /only allowed in a dry run/);
  });
  it('--apply with CLAUDECODE set', async () => {
    const dir = fixture();
    await refused(dir, { apply: true }, { env: { ...GIT_ENV, CLAUDECODE: '1' } }, /CLAUDECODE is set/);
  });
  it('--apply without a TTY', async () => {
    const dir = fixture();
    await refused(dir, { apply: true }, { tty: false }, /not a TTY/);
  });
  it('--apply without a TTY never reads the ancestry (no Windows PowerShell query)', async () => {
    const dir = fixture();
    await refused(dir, { apply: true }, { tty: false, ancestors: () => { throw new Error('must not be read'); } }, /not a TTY/);
  });
  it('--apply under a Claude Code ancestor', async () => {
    const dir = fixture();
    await refused(dir, { apply: true }, { ancestors: [{ pid: 42, name: 'claude', args: ['claude'] }] }, /is Claude Code/);
  });
  it('--apply fails closed when the ancestry is unreadable', async () => {
    const dir = fixture();
    await refused(dir, { apply: true }, { ancestors: () => { throw new Error('no ps'); } }, /could not check/);
  });
  it('--apply declined at the prompt', async () => {
    const dir = fixture();
    await refused(dir, { apply: true }, { answer: false }, /not confirmed/);
  });
  it('failing tests block --apply', async () => {
    const dir = fixture({ test: 'node -e "process.exit(1)"' });
    await refused(dir, { apply: true }, {}, /npm test failed/);
  });
});

describe('apply', () => {
  it('on main: commits the pin on a new release branch on top of the content commit and tags the content commit', async () => {
    const dir = fixture();
    const content = git(dir, 'rev-parse', 'HEAD');
    const { io, out, errs } = makeIo(dir);
    assert.strictEqual(await release(flags({ apply: true }), io), 0, errs.join('\n'));

    const entry = marketplace(dir).plugins[0];
    assert.deepStrictEqual(entry.source, { source: 'git-subdir', url: URL, path: 'plugins/rig', ref: 'v2.0.0-beta.1', sha: content });
    assert.strictEqual(entry.version, undefined, 'plugin.json is the only version; the entry carries none');
    assert.strictEqual(git(dir, 'rev-parse', 'v2.0.0-beta.1^{commit}'), content, 'tag points at the content commit');
    assert.strictEqual(git(dir, 'cat-file', '-t', 'v2.0.0-beta.1'), 'tag', 'annotated');
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD~1'), content);
    assert.strictEqual(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'release/v2.0.0-beta.1', 'checkout moves to the release branch');
    assert.strictEqual(git(dir, 'rev-parse', 'main'), content, 'main does not move: it takes the pin by pull request');
    assert.match(git(dir, 'log', '-1', '--format=%s'), /^release: pin marketplace to v2\.0\.0-beta\.1$/);
    assert.strictEqual(git(dir, 'status', '--porcelain'), '');
    const text = out.join('\n');
    assert.match(text, /git push -u origin release\/v2\.0\.0-beta\.1/);
    assert.match(text, /gh pr create --base main --head release\/v2\.0\.0-beta\.1/);
    assert.match(text, /git merge --ff-only release\/v2\.0\.0-beta\.1 && git push origin main v2\.0\.0-beta\.1/, 'the tag is pushed with main, after the merge');
    assert.doesNotMatch(text, /^\s*git push origin main/m, 'no direct push of the pin to main before the merge');
    assert.match(text, /install: \/plugin marketplace add example\/rig, then/);
    assert.match(text, /claude plugin tag/);
    assert.match(text, /gh release create v2\.0\.0-beta\.1 --title "Rig 2\.0\.0-beta\.1" --notes-file <CHANGELOG section> --prerelease/, "a beta is a prerelease");
    assert.match(text, /Nothing was pushed/);
  });
  it('the CI ref check passes right after apply and fails when the sha drifts', async () => {
    const dir = fixture();
    const { io } = makeIo(dir);
    await release(flags({ apply: true }), io);
    assert.strictEqual(checkMarketplaceRef(dir, GIT_ENV).ok, true);

    const m = marketplace(dir);
    m.plugins[0].source.sha = '0'.repeat(40);
    write(dir, '.claude-plugin/marketplace.json', JSON.stringify(m));
    const r = checkMarketplaceRef(dir, GIT_ENV);
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /sha .* is not the commit/);
  });
  it('a second release orders after the first and moves the pin', async () => {
    const dir = fixture();
    await release(flags({ apply: true }), makeIo(dir).io);
    git(dir, 'checkout', '-q', 'main'); // the pull request merge
    git(dir, 'merge', '-q', '--ff-only', 'release/v2.0.0-beta.1');
    write(dir, 'plugins/rig/.claude-plugin/plugin.json', JSON.stringify({ name: 'rig', version: '2.0.0-beta.2' }));
    const m = marketplace(dir);
    m.plugins[0].version = '2.0.0-beta.2';
    write(dir, '.claude-plugin/marketplace.json', JSON.stringify(m));
    git(dir, 'commit', '-qam', 'bump');
    const content = git(dir, 'rev-parse', 'HEAD');
    const { io, errs } = makeIo(dir);
    assert.strictEqual(await release(flags({ apply: true }), io), 0, errs.join('\n'));
    assert.strictEqual(marketplace(dir).plugins[0].source.ref, 'v2.0.0-beta.2');
    assert.strictEqual(marketplace(dir).plugins[0].source.sha, content);
    assert.strictEqual(checkMarketplaceRef(dir, GIT_ENV).ok, true);
  });
});

describe('checkMarketplaceRef', () => {
  it('skips while the marketplace has no ref', () => {
    const r = checkMarketplaceRef(fixture(), GIT_ENV);
    assert.deepStrictEqual([r.ok, r.skipped], [true, true]);
  });
  it('fails when the ref is not the latest reachable tag', () => {
    const dir = fixture();
    const sha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'tag', '-a', 'v2.0.0-beta.1', '-m', 'x');
    git(dir, 'tag', '-a', 'v2.0.0-beta.2', '-m', 'x');
    const m = marketplace(dir);
    m.plugins[0].source = { ...m.plugins[0].source, ref: 'v2.0.0-beta.1', sha };
    write(dir, '.claude-plugin/marketplace.json', JSON.stringify(m));
    const r = checkMarketplaceRef(dir, GIT_ENV);
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /not the latest reachable tag v2\.0\.0-beta\.2/);
  });
  it('fails when a ref is set but no tag is reachable', () => {
    const dir = fixture();
    const m = marketplace(dir);
    m.plugins[0].source = { ...m.plugins[0].source, ref: 'v2.0.0-beta.1', sha: 'a'.repeat(40) };
    write(dir, '.claude-plugin/marketplace.json', JSON.stringify(m));
    assert.match(checkMarketplaceRef(dir, GIT_ENV).message, /no v\* tag is reachable/);
  });
});
