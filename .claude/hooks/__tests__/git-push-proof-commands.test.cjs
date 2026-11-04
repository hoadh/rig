/**
 * Runs the exact push-proof and commit-proof command text documented in the
 * git skill against a temp bare remote, so docs and behaviour cannot drift.
 *
 * Source of truth: the <!-- push-proof --> fenced block in
 * .claude/skills/git/references/workflow-push.md (copies in workflow-commit.md
 * and pr/SKILL.md must be byte-identical) and the <!-- commit-proof --> block
 * in workflow-commit.md.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DOCS = {
  push: '.claude/skills/git/references/workflow-push.md',
  commit: '.claude/skills/git/references/workflow-commit.md',
  pr: '.claude/skills/pr/SKILL.md',
};

function extractBlock(file, tag) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = new RegExp(`<!-- ${tag} -->\\s*\`\`\`bash\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- /${tag} -->`);
  const m = text.match(re);
  assert.ok(m, `${tag} block not found in ${file}`);
  return m[1].trim();
}

const PUSH_PROOF = extractBlock(DOCS.push, 'push-proof');
const COMMIT_PROOF = extractBlock(DOCS.commit, 'commit-proof');
assert.strictEqual(extractBlock(DOCS.commit, 'push-proof'), PUSH_PROOF, 'workflow-commit.md push-proof drifted');
assert.strictEqual(extractBlock(DOCS.pr, 'push-proof'), PUSH_PROOF, 'pr/SKILL.md push-proof drifted');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'push-proof-'));
const ENV = {
  ...process.env,
  HOME: tmp,
  USERPROFILE: tmp,
  XDG_CONFIG_HOME: path.join(tmp, 'xdg'),
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
};

function run(cmd, cwd) {
  const r = spawnSync('bash', ['-c', cmd], { cwd, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
function sh(cmd, cwd) {
  const r = run(cmd, cwd);
  assert.strictEqual(r.code, 0, `command failed: ${cmd}\n${r.out}`);
  return r.stdout.trim();
}

let n = 0;
/** Fresh bare remote + clone with one pushed commit on main. */
function setup() {
  const dir = path.join(tmp, `s${n++}`);
  fs.mkdirSync(dir);
  const bare = path.join(dir, 'remote.git');
  const work = path.join(dir, 'work');
  sh(`git init -q --bare -b main "${bare}"`, dir);
  sh(`git init -q -b main "${work}"`, dir);
  sh(`git remote add origin "${bare}"`, work);
  sh('echo a > a.txt && git add -A && git commit -q -m init && git push -q -u origin main', work);
  return { dir, bare, work };
}
function proofLines(out) {
  const head = (out.match(/^HEAD (\w+)$/m) || [])[1];
  const remote = (out.match(/^REMOTE (\w*)$/m) || [])[1];
  return { head, remote };
}

const scenarios = {
  'normal push: HEAD == REMOTE'() {
    const { work, bare } = setup();
    sh('git checkout -q -b feat/x && echo b > b.txt && git add -A && git commit -q -m b', work);
    const r = run(PUSH_PROOF.replace('git push origin HEAD', 'git push -u origin HEAD'), work);
    const { head, remote } = proofLines(r.out);
    assert.ok(head && head === remote, `expected equal, got ${head} vs ${remote}\n${r.out}`);
    assert.strictEqual(head, sh('git rev-parse feat/x', bare));
  },

  'branch created from origin/main (upstream = origin/main): HEAD == REMOTE'() {
    const { work } = setup();
    sh('git checkout -q -b feat/y origin/main && echo c > c.txt && git add -A && git commit -q -m c', work);
    assert.strictEqual(sh('git rev-parse --abbrev-ref @{u}', work), 'origin/main');
    const r = run(PUSH_PROOF, work);
    const { head, remote } = proofLines(r.out);
    assert.ok(head && head === remote, `expected equal, got ${head} vs ${remote}\n${r.out}`);
    // main on the remote must not have moved: proof compared the real branch ref
    assert.strictEqual(sh('git ls-remote origin refs/heads/main | cut -f1', work), sh('git rev-parse origin/main', work));
  },

  'rejected push: both lines printed, HEAD != REMOTE'() {
    const { work, dir } = setup();
    const other = path.join(dir, 'other');
    sh(`git clone -q "${path.join(dir, 'remote.git')}" "${other}"`, dir);
    sh('echo r > r.txt && git add -A && git commit -q -m remote-ahead && git push -q origin main', other);
    sh('echo l > l.txt && git add -A && git commit -q -m local', work);
    const r = run(PUSH_PROOF, work);
    const { head, remote } = proofLines(r.out);
    assert.ok(head, `HEAD line missing\n${r.out}`);
    assert.ok(remote, `REMOTE line missing\n${r.out}`);
    assert.notStrictEqual(head, remote, 'push should have been rejected');
  },

  'failing pre-commit hook: HEAD unchanged -> "nothing committed", no pushed line'() {
    const { work } = setup();
    const hook = path.join(work, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho blocked >&2\nexit 1\n', { mode: 0o755 });
    // PRE is recorded before committing, exactly as workflow-commit.md instructs
    const r = run(`PRE=$(git rev-parse HEAD); echo x > x.txt; git add -A; git commit -q -m x; ${COMMIT_PROOF}`, work);
    assert.match(r.out, /nothing committed/);
    assert.doesNotMatch(r.out, /^committed /m);
    assert.doesNotMatch(r.out, /pushed/i);
  },

  'successful commit: commit proof reports committed'() {
    const { work } = setup();
    const r = run(`PRE=$(git rev-parse HEAD); echo x > x.txt; git add -A; git commit -q -m x; ${COMMIT_PROOF}`, work);
    assert.match(r.out, /^committed \w+/m);
  },
};

let failed = 0;
try {
  for (const [name, fn] of Object.entries(scenarios)) {
    try {
      fn();
      console.log(`ok - ${name}`);
    } catch (e) {
      failed++;
      console.error(`not ok - ${name}\n${e.message}`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
