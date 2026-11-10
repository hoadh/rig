/**
 * Runs the exact push-proof and commit-proof command text documented in the
 * git skill against a temp bare remote, so docs and behaviour cannot drift.
 *
 * Source of truth: the <!-- push-proof --> fenced block in
 * plugins/rig/skills/git/references/workflow-push.md (copies in workflow-commit.md
 * and pr/SKILL.md must be byte-identical) and the <!-- commit-proof --> block
 * in workflow-commit.md.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DOCS = {
  push: 'plugins/rig/skills/git/references/workflow-push.md',
  commit: 'plugins/rig/skills/git/references/workflow-commit.md',
  pr: 'plugins/rig/skills/pr/SKILL.md',
};

function extractBlock(file, tag) {
  // Windows checkouts may convert to CRLF
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const re = new RegExp(`<!-- ${tag} -->\\s*\`\`\`bash\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- /${tag} -->`);
  const m = text.match(re);
  assert.ok(m, `${tag} block not found in ${file}`);
  return m[1].trim();
}

const PUSH_PROOF = extractBlock(DOCS.push, 'push-proof');
const COMMIT_PROOF = extractBlock(DOCS.commit, 'commit-proof');
assert.strictEqual(extractBlock(DOCS.commit, 'push-proof'), PUSH_PROOF, 'workflow-commit.md push-proof drifted');
assert.strictEqual(extractBlock(DOCS.pr, 'push-proof'), PUSH_PROOF, 'pr/SKILL.md push-proof drifted');
// The agent states the exact result lines itself (live 2.0.1: a haiku git-operator dropped the leading mark)
const OPERATOR = fs.readFileSync(path.join(ROOT, 'plugins/rig/agents/git-operator.md'), 'utf8');
for (const line of ['nothing to commit (working tree clean)', 'nothing committed', '✓ pushed: <short-hash> -> origin/<branch>', '✗ push NOT confirmed']) {
  assert.ok(OPERATOR.includes(line), `git-operator.md must state the exact result line: ${line}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'push-proof-'));
fs.writeFileSync(path.join(tmp, 'empty-gitconfig'), '');
const ENV = {
  ...process.env,
  HOME: tmp,
  USERPROFILE: tmp,
  XDG_CONFIG_HOME: path.join(tmp, 'xdg'),
  // empty file, not os.devNull: git for Windows cannot open \\.\nul as a config file
  GIT_CONFIG_GLOBAL: path.join(tmp, 'empty-gitconfig'),
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
    sh('echo x > x.txt && git add -A', work);
    // the doc block runs as-is in ONE shell: it must capture PRE itself
    const r = run(COMMIT_PROOF, work);
    assert.match(r.out, /nothing committed/);
    assert.doesNotMatch(r.out, /^committed /m);
    assert.doesNotMatch(r.out, /pushed/i);
  },

  'successful commit: commit proof reports committed (block run as-is)'() {
    const { work } = setup();
    sh('echo x > x.txt && git add -A', work);
    const r = run(COMMIT_PROOF, work);
    assert.match(r.out, /^committed \w+/m);
  },

  'unset PRE (separate Bash call): proof never prints "committed"'() {
    const { work } = setup();
    // the check part of the block alone, in a fresh shell without PRE (the old doc's real-world situation)
    const check = COMMIT_PROOF.slice(COMMIT_PROOF.indexOf('[ "$(git rev-parse HEAD)"'));
    assert.ok(check.includes('PRE'), 'check part not found');
    const r = run(check, work);
    assert.doesNotMatch(r.out, /^committed /m);
    assert.match(r.out, /PRE unset/);
    assert.notStrictEqual(r.code, 0);
  },

  'commit-proof block is self-contained and mirrored in git SKILL.md / git-operator'() {
    assert.ok(COMMIT_PROOF.startsWith('PRE=$(git rev-parse HEAD);'), 'PRE capture must be inside the block');
    assert.ok(COMMIT_PROOF.includes('git commit'), 'commit must be inside the block');
    const skill = fs.readFileSync(path.join(ROOT, 'plugins/rig/skills/git/SKILL.md'), 'utf8');
    assert.ok(skill.includes(COMMIT_PROOF), 'git/SKILL.md commit step drifted from the commit-proof block');
    const agent = fs.readFileSync(path.join(ROOT, 'plugins/rig/agents/git-operator.md'), 'utf8');
    assert.match(agent, /ONE Bash call/);
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
