'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
// Fixture git (system config isolated) and product git (safeGit honours system config) must agree: otherwise
// Git for Windows' system core.autocrlf=true makes the fixture's `status` see CRLF files the product wrote.
process.env.GIT_CONFIG_NOSYSTEM = '1';

process.env.RIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-prep-home-'));
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const { prepareAgentClone } = require('../lib/worker-repo-preparer.cjs');
const { tryGit } = require('../lib/safe-git-runner.cjs');
const { prepareTestClone } = require('../lib/worker-test-clone-preparer.cjs');
const { writeKnownGoodBaseline } = require('../lib/hardened-git-config-env.cjs');
const { writeQuarantine } = require('../lib/git-control-files-integrity.cjs');

const SLUG = 'plan-a';

/** origin + 'main' (orchestrator) + 'w' (worker's dedicated clone, never fetched yet). */
function fixture({ coordOwner = 'mac' } = {}) {
  const env = makeRepoWithBareRemote({ clones: ['main', 'w'] });
  const main = env.clone('main');
  env.git(main, 'push', '-q', 'origin', 'main');
  const baseSha = env.git(main, 'rev-parse', 'HEAD');
  if (coordOwner) {
    env.git(main, 'checkout', '-q', '--orphan', `rig-coord/${SLUG}`);
    env.git(main, 'rm', '-rfq', '.');
    fs.writeFileSync(path.join(main, 'plan.md'), `---\ntitle: x\norchestrator: ${coordOwner}\n---\nbody\n`);
    env.git(main, 'add', 'plan.md'); env.git(main, 'commit', '-q', '-m', 'coord');
    env.git(main, 'push', '-q', 'origin', `rig-coord/${SLUG}`);
    env.git(main, 'checkout', '-q', 'main');
  }
  const spec = { orchestrator: 'mac', slug: SLUG, baseSha, startSha: baseSha, branch: `rig/waso/${SLUG}` };
  writeKnownGoodBaseline(env.clone('w')); // fresh dedicated clone, trusted state
  return { env, main, spec, target: { repo: env.clone('w') }, baseSha };
}
const cleanup = (f) => { f.env.cleanup(); };

function failureOf(fn) {
  try { fn(); } catch (e) { return e.failure; }
  return 'no-throw';
}

t.test('happy path: fetches shas + coord, checks out worker branch at startSha', () => {
  const f = fixture();
  try {
    const r = prepareAgentClone(f.spec, f.target);
    t.eq(r.head, f.baseSha);
    t.eq(f.env.git(f.target.repo, 'rev-parse', '--abbrev-ref', 'HEAD'), f.spec.branch);
  } finally { cleanup(f); }
});

t.test('missing sha -> failed:prepare', () => {
  const f = fixture();
  try {
    t.eq(failureOf(() => prepareAgentClone({ ...f.spec, startSha: 'f'.repeat(40) }, f.target)), 'prepare');
  } finally { cleanup(f); }
});

t.test('dirty clone is reset (M7), dirty state reported, then checked out', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.target.repo, 'README.md'), 'dirty\n');
    const prep = prepareAgentClone(f.spec, f.target);
    t.ok(prep.wasDirty.includes('README.md'));
    t.eq(f.env.git(f.target.repo, 'status', '--porcelain'), '');
    t.eq(f.env.git(f.target.repo, 'rev-parse', '--abbrev-ref', 'HEAD'), f.spec.branch);
  } finally { cleanup(f); }
});

t.test('coord orchestrator mismatch or missing coord branch -> failed:lock', () => {
  const f = fixture({ coordOwner: 'someone-else' });
  try {
    t.eq(failureOf(() => prepareAgentClone(f.spec, f.target)), 'lock');
  } finally { cleanup(f); }
  const g = fixture({ coordOwner: null });
  try {
    t.eq(failureOf(() => prepareAgentClone(g.spec, g.target)), 'lock');
  } finally { cleanup(g); }
});

t.test('quarantined clone and non-git path are refused', () => {
  const f = fixture();
  try {
    writeQuarantine(f.target.repo, 'test');
    t.eq(failureOf(() => prepareAgentClone(f.spec, f.target)), 'prepare');
    t.eq(failureOf(() => prepareAgentClone(f.spec, { repo: os.tmpdir() })), 'prepare');
  } finally { cleanup(f); }
});

t.test('base not ancestor of start: merged in (clean merge commit)', () => {
  const f = fixture();
  try {
    const { env, main } = f;
    // worker branch start = base + own commit (pushed so the worker can fetch it)
    env.git(main, 'checkout', '-q', '-b', 'w-start');
    const start = env.commitFile('main', 'w.txt', 'worker');
    env.git(main, 'push', '-q', 'origin', 'w-start');
    // base advances on main
    env.git(main, 'checkout', '-q', 'main');
    const newBase = env.commitFile('main', 'm.txt', 'main');
    env.git(main, 'push', '-q', 'origin', 'main');
    const r = prepareAgentClone({ ...f.spec, baseSha: newBase, startSha: start }, f.target);
    t.ok(tryGit(f.target.repo, ['merge-base', '--is-ancestor', newBase, 'HEAD']).ok);
    t.ok(r.head !== start);
    t.ok(fs.existsSync(path.join(f.target.repo, 'w.txt')) && fs.existsSync(path.join(f.target.repo, 'm.txt')));
  } finally { cleanup(f); }
});

t.test('base merge conflict -> failed:prepare and clone left clean', () => {
  const f = fixture();
  try {
    const { env, main } = f;
    env.git(main, 'checkout', '-q', '-b', 'w-start');
    const start = env.commitFile('main', 'README.md', 'worker version\n');
    env.git(main, 'push', '-q', 'origin', 'w-start');
    env.git(main, 'checkout', '-q', 'main');
    const newBase = env.commitFile('main', 'README.md', 'main version\n');
    env.git(main, 'push', '-q', 'origin', 'main');
    t.eq(failureOf(() => prepareAgentClone({ ...f.spec, baseSha: newBase, startSha: start }, f.target)), 'prepare');
    t.eq(f.env.git(f.target.repo, 'status', '--porcelain'), '');
  } finally { cleanup(f); }
});

t.test('repo-local hooks never run during prepare (hooksPath disabled)', () => {
  const f = fixture();
  try {
    const marker = path.join(f.env.root, 'hook-ran');
    const hook = path.join(f.target.repo, '.git', 'hooks', 'post-checkout');
    fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    writeKnownGoodBaseline(f.target.repo); // user-planted hook, accepted into the baseline: still must never run
    prepareAgentClone(f.spec, f.target);
    t.ok(!fs.existsSync(marker));
  } finally { cleanup(f); }
});

t.test('test clone: created next to the repo, re-pointed on reuse, missing ref fails', () => {
  const f = fixture();
  try {
    writeKnownGoodBaseline(f.target.repo); // test runs need the baseline gate too (M-A)
    const wt = `${f.target.repo}-rig-test`;
    const r1 = prepareTestClone({ ref: f.baseSha }, f.target);
    t.eq(r1.cwd, wt);
    t.eq(f.env.git(wt, 'rev-parse', 'HEAD'), f.baseSha);
    f.env.git(f.main, 'checkout', '-q', 'main');
    const next = f.env.commitFile('main', 'n.txt', 'n');
    f.env.git(f.main, 'push', '-q', 'origin', 'main');
    fs.writeFileSync(path.join(wt, 'junk.txt'), 'stale');
    prepareTestClone({ ref: next }, f.target);
    t.eq(f.env.git(wt, 'rev-parse', 'HEAD'), next);
    t.ok(!fs.existsSync(path.join(wt, 'junk.txt')));
    t.eq(failureOf(() => prepareTestClone({ ref: 'e'.repeat(40) }, f.target)), 'prepare');
  } finally { cleanup(f); }
});

t.done().then(() => fs.rmSync(process.env.RIG_HOME, { recursive: true, force: true }));
