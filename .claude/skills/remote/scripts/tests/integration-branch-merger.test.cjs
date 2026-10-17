'use strict';
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const { mergeIntoIntegration } = require('../lib/integration-branch-merger.cjs');
const { preflightMachine } = require('../lib/collect-preflight-checks.cjs');

/** main + worker branches rig/<m>/s each adding one file (or `edits` map) */
function fixture(branchFiles) {
  const env = makeRepoWithBareRemote({ clones: ['main'], files: { 'README.md': '# t\n', 'shared.txt': 'base\n' } });
  const repo = env.clone('main');
  const planSha = env.git(repo, 'rev-parse', 'HEAD');
  const shas = {};
  for (const [m, files] of Object.entries(branchFiles)) {
    env.git(repo, 'checkout', '-q', '-B', `rig/${m}/s`, planSha);
    for (const [f, c] of Object.entries(files)) env.commitFile('main', f, c);
    shas[m] = env.git(repo, 'rev-parse', 'HEAD');
  }
  env.git(repo, 'checkout', '-q', 'main');
  return { env, repo, planSha, shas };
}
const remoteSha = (env, repo, ref) => env.git(repo, 'ls-remote', 'origin', ref).split(/\s+/)[0];

t.test('merges in order, pushes, rerun is idempotent', () => {
  const { env, repo, planSha, shas } = fixture({ a: { 'a.txt': '1\n' }, b: { 'b.txt': '2\n' } });
  try {
    const br = [{ machine: 'a', sha: shas.a }, { machine: 'b', sha: shas.b }];
    const r1 = mergeIntoIntegration({ repo, slug: 's', planSha, branches: br });
    t.eq(r1.merged, ['a', 'b']);
    t.eq(remoteSha(env, repo, 'refs/heads/rig-int/s'), r1.intSha);
    const r2 = mergeIntoIntegration({ repo, slug: 's', planSha, branches: br });
    t.eq(r2.merged, []); t.eq(r2.skipped, ['a', 'b']); t.eq(r2.intSha, r1.intSha); t.eq(r2.pushed, false);
  } finally { env.cleanup(); }
});

t.test('conflict exits 4 and lists files', () => {
  const { env, repo, planSha, shas } = fixture({ a: { 'shared.txt': 'A\n' }, b: { 'shared.txt': 'B\n' } });
  try {
    t.throwsRemote(() => mergeIntoIntegration({ repo, slug: 's', planSha, branches: [{ machine: 'a', sha: shas.a }, { machine: 'b', sha: shas.b }] }), { exitCode: 4, cls: 'merge-conflict' });
  } finally { env.cleanup(); }
});

t.test('preflight: unreviewed head blocks; reviewed + owned passes; out-of-owns blocks', () => {
  const { env, repo, planSha, shas } = fixture({ a: { 'src/a.txt': '1\n' } });
  try {
    const mk = (reviewedSha, owns) => [{ phase: '01', machine: 'a', owns, reviewedSha }];
    t.throwsRemote(() => preflightMachine({ repo, map: mk(null, ['src/**']), machine: 'a', headSha: shas.a, baseCandidateSha: planSha }), { exitCode: 1, cls: 'unreviewed-commits' });
    try { preflightMachine({ repo, map: mk(null, ['src/**']), machine: 'a', headSha: shas.a, baseCandidateSha: planSha }); } catch (e) { t.ok(String(e.hint).includes(`review <plan-dir> <phase 01 file> --sha ${shas.a}`), e.hint); }
    t.eq(preflightMachine({ repo, map: mk(shas.a, ['src/**']), machine: 'a', headSha: shas.a, baseCandidateSha: planSha }), shas.a);
    t.throwsRemote(() => preflightMachine({ repo, map: mk(shas.a, ['docs/**']), machine: 'a', headSha: shas.a, baseCandidateSha: planSha }), { exitCode: 1, cls: 'owns-violation' });
  } finally { env.cleanup(); }
});
t.done();
