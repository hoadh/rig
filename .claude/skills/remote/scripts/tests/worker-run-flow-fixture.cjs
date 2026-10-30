'use strict';
/**
 * Shared fixture for worker run flow tests (phase 03): isolated RIG_HOME /
 * RIG_RUNS_DIR, a bare origin with an orchestrator clone + the worker's own
 * clone, a coord branch owned by 'mac', and a stub `claude` whose behaviour
 * is selected by the `mode` file next to it (child env is allowlisted, so
 * env vars cannot steer it). Self machine id is 'tester'.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const { makeFakeExecutable, fakeRanCount } = require('./fake-executable-for-tests.cjs');
const { hostOs, hostShell, installFakeScheduledTasks, removeDirRetrying } = require('./platform-test-fixtures.cjs');

const SLUG = 'plan-a';
const BRANCH = `rig/tester/${SLUG}`;
const UUID = '123e4567-e89b-42d3-a456-426614174000';

const STUB = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), cp = require('child_process');
const mode = fs.readFileSync(path.join(__dirname, 'mode'), 'utf8').trim();
const git = (...a) => cp.execFileSync('git', a, { stdio: 'ignore' });
const commit = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); git('add', '-A'); git('commit', '-q', '-m', 'agent ' + file); };
process.stdin.resume(); process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  const ok = JSON.stringify({ subtype: 'success', is_error: false, result: 'done', num_turns: 1, session_id: 'x' });
  if (mode === 'sleep') return setTimeout(() => {}, 60000);
  if (mode === 'commit') commit('src/a.js', '1');
  if (mode === 'github') commit('.github/workflows/x.yml', 'on: push');
  if (mode === 'tamper') { git('config', 'core.sshCommand', 'evil'); commit('src/a.js', '1'); }
  if (mode === 'failcommit') { commit('src/a.js', '1'); console.error('boom'); process.exit(1); }
  console.log(ok);
});
`;

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-flow-'));
  Object.assign(process.env, { RIG_HOME: path.join(home, 'home'), RIG_RUNS_DIR: path.join(home, 'runs'), RIG_MACHINE: 'tester', RIG_REMOTE_NO_TMUX: '1', RIG_HEARTBEAT_MS: '200' });
  const env = makeRepoWithBareRemote({ clones: ['main', 'w'] });
  const main = env.clone('main');
  env.git(main, 'push', '-q', 'origin', 'main');
  const baseSha = env.git(main, 'rev-parse', 'HEAD');
  env.git(main, 'checkout', '-q', '--orphan', `rig-coord/${SLUG}`);
  env.git(main, 'rm', '-rfq', '.');
  fs.writeFileSync(path.join(main, 'plan.md'), '---\ntitle: x\norchestrator: mac\n---\n');
  env.git(main, 'add', 'plan.md'); env.git(main, 'commit', '-q', '-m', 'coord');
  env.git(main, 'push', '-q', 'origin', `rig-coord/${SLUG}`);
  env.git(main, 'checkout', '-q', 'main');
  require('../lib/hardened-git-config-env.cjs').writeKnownGoodBaseline(env.clone('w')); // fresh dedicated clone, trusted state
  const stub = makeFakeExecutable(home, 'claude', STUB); // <home>/claude.exe on win32; the mode file stays next to it
  // win32: the product launches runs via schtasks; a fake scheduler (real XML + runner) stands in for the Task Scheduler service
  const savedPath = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() === 'PATH'));
  installFakeScheduledTasks(path.join(home, 'fakebin'), process.env);
  const target = { ssh: 'u@h', os: hostOs(), shell: hostShell(), repo: env.clone('w'), pathPrepend: [], node: process.execPath, claude: stub };
  let n = 0;
  const runId = () => `r2601010000${String(10 + n++).padStart(2, '0')}-abcde${n}`;
  const agentSpec = (over = {}) => ({
    v: 1, runId: runId(), orchestrator: 'mac', slug: SLUG, kind: 'agent', baseSha, startSha: baseSha, branch: BRANCH,
    owns: ['src/**'], timeoutSec: 30, maxTurns: 5, agent: { sessionId: UUID, resume: false, allowedTools: ['Read'], disallowedTools: [] }, ...over,
  });
  const commandSpec = (command, over = {}) => ({ v: 1, runId: runId(), orchestrator: 'mac', kind: 'command', ref: baseSha, command, timeoutSec: 30, ...over });
  return {
    env, target, baseSha, agentSpec, commandSpec,
    stubRan: () => fakeRanCount(home, 'claude'), // times the stub claude was started (kills vacuous passes)
    setMode: (m) => fs.writeFileSync(path.join(home, 'mode'), m),
    onOrigin: (b = BRANCH) => { try { env.git(env.origin, 'rev-parse', '--verify', `refs/heads/${b}`); return true; } catch { return false; } },
    cleanup: () => { Object.assign(process.env, savedPath); env.cleanup(); removeDirRetrying(home); }, // win32: a just-finished runner may still hold its cwd
  };
}

module.exports = { setup, BRANCH, SLUG };
