'use strict';
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const P = require('../lib/worker-branch-pusher.cjs');

const failing = (stderr) => () => { const e = new Error('git failed'); e.stderr = stderr; throw e; };
const H = 'a'.repeat(40);
const noSleep = (log) => async (ms) => { log.push(ms); };

t.test('classifyPushError: auth, ratelimit, other', () => {
  t.eq(P.classifyPushError('git@github.com: Permission denied (publickey).'), 'auth');
  t.eq(P.classifyPushError("fatal: Authentication failed for 'https://x'"), 'auth');
  t.eq(P.classifyPushError('fatal: could not read Username for https://github.com'), 'auth');
  t.eq(P.classifyPushError('remote: error: HTTP 429 Too Many Requests'), 'ratelimit');
  t.eq(P.classifyPushError('remote: You have exceeded a secondary rate limit'), 'ratelimit');
  t.eq(P.classifyPushError('fatal: unable to access: Could not resolve host'), 'push');
});

t.test('retries transient failure then succeeds, with backoff schedule', async () => {
  let n = 0; const sleeps = [];
  const git = (repo, args) => { if (args[0] === 'rev-parse' || args[0] === 'ls-remote') return H; if (args[0] === 'push' && ++n < 3) failing('Could not resolve host')(); return ''; };
  const r = await P.pushWithRetry('/r', 'rig/m/s', { backoffMs: [5, 15, 45], git, sleep: noSleep(sleeps) });
  t.eq([r.ok, r.attempts, sleeps], [true, 3, [5, 15]]);
});

t.test('exhausts 1 + 3 attempts then reports class', async () => {
  const sleeps = [];
  const r = await P.pushWithRetry('/r', 'rig/m/s', { head: H, backoffMs: [5, 15, 45], git: failing('429 too many requests'), sleep: noSleep(sleeps) });
  t.eq([r.ok, r.attempts, r.failure, sleeps], [false, 4, 'ratelimit', [5, 15, 45]]);
});

t.test('auth and non-fast-forward fail fast (no retry)', async () => {
  const sleeps = [];
  const a = await P.pushWithRetry('/r', 'rig/m/s', { head: H, git: failing('Permission denied (publickey)'), sleep: noSleep(sleeps) });
  t.eq([a.ok, a.attempts, a.failure], [false, 1, 'auth']);
  const b = await P.pushWithRetry('/r', 'rig/m/s', { head: H, git: failing(' ! [rejected] x -> x (non-fast-forward)'), sleep: noSleep(sleeps) });
  t.eq([b.ok, b.attempts, b.failure], [false, 1, 'push']);
  t.eq(sleeps, []);
});

t.test('uses an explicit non-force refspec', async () => {
  const seen = [];
  await P.pushWithRetry('/r', 'rig/m/s', { head: H, git: (repo, args) => { seen.push(args); return args[0] === 'ls-remote' ? `${H}\trefs/heads/rig/m/s` : ''; } });
  t.eq(seen[0], ['push', '--quiet', 'origin', `${H}:refs/heads/rig/m/s`]);
  t.ok(!seen[0].some((a) => a.startsWith('+') || a === '--force'));
});

t.test('defaults head to HEAD; fails when origin does not hold the pushed sha', async () => {
  const git = (repo, args) => (args[0] === 'rev-parse' ? H : args[0] === 'ls-remote' ? `${'b'.repeat(40)}\trefs/heads/x` : '');
  const r = await P.pushWithRetry('/r', 'x', { git });
  t.eq([r.ok, r.failure], [false, 'push']);
  t.ok(/verify failed/.test(r.detail));
  const bad = await P.pushWithRetry('/r', 'x', { git: () => 'not-a-sha' });
  t.eq(bad.ok, false);
});

t.test('real push to bare origin; second divergent push is rejected, never forced', async () => {
  const env = makeRepoWithBareRemote({ clones: ['a', 'b'] });
  try {
    const A = env.clone('a'), B = env.clone('b');
    env.git(A, 'checkout', '-q', '-b', 'rig/m/s');
    env.commitFile('a', 'f.txt', '1');
    t.eq((await P.pushWithRetry(A, 'rig/m/s', { backoffMs: [] })).ok, true);
    t.ok(env.git(env.origin, 'rev-parse', 'refs/heads/rig/m/s'));
    env.git(B, 'checkout', '-q', '-b', 'rig/m/s', 'origin/main');
    env.commitFile('b', 'g.txt', '2');
    const r = await P.pushWithRetry(B, 'rig/m/s', { backoffMs: [] });
    t.eq([r.ok, r.attempts], [false, 1]);
    t.eq(env.git(env.origin, 'rev-parse', 'refs/heads/rig/m/s'), env.git(A, 'rev-parse', 'HEAD')); // untouched
  } finally { env.cleanup(); }
});

t.done();
