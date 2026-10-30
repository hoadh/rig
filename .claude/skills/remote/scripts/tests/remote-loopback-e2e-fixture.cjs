'use strict';
/**
 * Loopback E2E fixture: several machine ids on this one host, no ssh.
 * Each machine = its own repo clone (registry `repo`), its own RIG_HOME run
 * root (<root>/lb/<machine>/rig-home, set by ssh-transport via RIG_LOOPBACK_ROOT)
 * and a stub `claude` whose behaviour is steered by a mode file. The CLI is
 * invoked exactly like a user would, with RIG_REMOTE_TRANSPORT=local.
 *   const fx = createFixture(['alpha','beta']); fx.cli('alpha', ['status', ...]);
 *   fx.addWorker('gamma'); fx.setMode('beta', {files:{...}}); fx.cleanup();
 * Sandbox: HOME is a temp dir, global git config disabled, nothing touches the
 * real origin. cleanup() cancels leftover runs, kills our rig-* tmux sessions
 * and removes the temp root.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { makeRepoWithBareRemote, git } = require('./temp-git-repo-with-bare-remote.cjs');
const { makeFakeExecutable } = require('./fake-executable-for-tests.cjs');
const { hostOs, hostShell, GIT_NULL_CONFIG, prependPath, installFakeScheduledTasks } = require('./platform-test-fixtures.cjs');

const REMOTE_CJS = path.join(__dirname, '..', 'remote.cjs');
const WORKER_CJS = path.join(__dirname, '..', 'worker.cjs');
const STUB_CJS = path.join(__dirname, 'fixtures', 'stub-claude-agent.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function createFixture(orchestrators = ['alpha', 'delta']) {
  const base = makeRepoWithBareRemote({ clones: orchestrators });
  const root = base.root;
  const lb = path.join(root, 'lb');
  const home = path.join(root, 'home');
  const registryFile = path.join(root, 'rig-machines.json');
  fs.mkdirSync(home, { recursive: true });
  const machines = {};
  const stubs = {};
  const flagFile = path.join(root, 'reject-push');
  const sessions = new Set();

  const writeRegistry = () => fs.writeFileSync(registryFile, JSON.stringify({ machines }, null, 2));

  /** Registers `name`: the repo clone, stub claude and registry entry. */
  function register(name, repo) {
    const stubDir = path.join(root, 'stubs', name);
    fs.mkdirSync(stubDir, { recursive: true });
    const claude = makeFakeExecutable(stubDir, 'claude', `require(${JSON.stringify(STUB_CJS)});`); // <dir>/claude.exe on win32
    stubs[name] = stubDir;
    // Record the known-good git baseline exactly as a user does after a fresh clone (stored in the machine's own RIG_HOME).
    const b = cp.spawnSync(process.execPath, [WORKER_CJS, 'baseline', '--repo', repo], { env: { ...process.env, HOME: home, USERPROFILE: home, RIG_HOME: path.join(lb, name, 'rig-home') }, // same HOME as envFor: on win32 the pinned hooksPath lives under HOME and is part of the baseline hash
 encoding: 'utf8', input: JSON.stringify({ nonce: 'ab'.repeat(16), protocol: 1, payload: null }) });
    if (b.status !== 0) throw new Error(`baseline for ${name} failed: ${b.stderr}`);
    machines[name] = { ssh: 'rig@loopback', os: hostOs(), shell: hostShell(), repo, pathPrepend: [], node: process.execPath, claude };
    writeRegistry();
  }

  /** Extra worker machine = fresh clone of the shared origin (clean, own identity). */
  function addWorker(name) {
    const dir = path.join(root, name);
    cp.execFileSync('git', ['clone', '-q', base.origin, dir], { stdio: 'ignore' });
    for (const [k, v] of [['user.name', 'Rig Test'], ['user.email', 'rig-test@example.invalid'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v);
    register(name, dir);
    return dir;
  }
  orchestrators.forEach((n) => register(n, base.clone(n)));

  /** Opt-in RIG_E2E_CLAUDE=1: drop the stub so the worker uses the real `claude` on PATH. */
  const useRealClaude = (name) => { delete machines[name].claude; writeRegistry(); };
  const repoOf = (name) => machines[name].repo;
  const setMode = (name, mode) => fs.writeFileSync(path.join(stubs[name], 'mode.json'), JSON.stringify(mode));
  const stubCalls = (name) => {
    try { return fs.readFileSync(path.join(stubs[name], 'argv.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  };

  /** Env of a CLI process acting as machine `as` (cwd = that machine's clone). */
  // win32: the product always launches via schtasks; a fake scheduler (real XML + runner, fake Task Scheduler) is first on PATH
  const fakeBin = path.join(root, 'fakebin');
  fs.mkdirSync(fakeBin, { recursive: true });
  installFakeScheduledTasks(fakeBin, {});
  const envFor = (as, extra = {}) => prependPath({
    ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: GIT_NULL_CONFIG, GIT_TERMINAL_PROMPT: '0', RIG_MACHINE: as,
    RIG_REMOTE_TRANSPORT: 'local', RIG_MACHINES_FILE: registryFile, RIG_REMOTE_WORKER_PATH: WORKER_CJS, RIG_LOOPBACK_ROOT: lb,
    RIG_HEARTBEAT_MS: '300', RIG_HEARTBEAT_STALE_MS: '5000', RIG_STATUS_POLL_MS: '300', RIG_REMOTE_NO_TMUX: '1', ...extra,
  }, fakeBin);

  /** Sync CLI call. @returns {{code, out, err}} */
  function cli(as, args, { env, cwd, input } = {}) {
    const r = cp.spawnSync(process.execPath, [REMOTE_CJS, ...args], { cwd: cwd || repoOf(as), env: envFor(as, env), encoding: 'utf8', input, timeout: 120000 });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  }

  /** Async CLI call (for concurrent claims). */
  function cliAsync(as, args, { env } = {}) {
    return new Promise((resolve) => {
      const c = cp.spawn(process.execPath, [REMOTE_CJS, ...args], { cwd: repoOf(as), env: envFor(as, env) });
      let out = ''; let err = '';
      c.stdout.on('data', (d) => { out += d; });
      c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => resolve({ code, out, err }));
    });
  }

  /** Writes plan.md + phases into <as clone>/plans/<slug>; phases: [{file, machine, owns, dependsOn, name}]. */
  function writePlan(slug, phases, { orchestrator, branch = 'main', as = 'alpha' } = {}) {
    const dir = path.join(repoOf(as), 'plans', slug);
    fs.mkdirSync(dir, { recursive: true });
    const rows = phases.map((p, i) => `| ${i + 1} | [${p.name || `Phase ${i + 1}`}](./${p.file}) | Pending |`);
    const fm = ['---', `title: ${slug}`, 'status: pending', ...(orchestrator ? [`orchestrator: ${orchestrator}`] : []), `branch: ${branch}`, '---'];
    fs.writeFileSync(path.join(dir, 'plan.md'), `${fm.join('\n')}\n\n# ${slug}\n\n| Phase | Name | Status |\n|-------|------|--------|\n${rows.join('\n')}\n`);
    phases.forEach((p, i) => {
      const f = ['---', `phase: ${i + 1}`, 'status: pending'];
      if (p.machine) f.push(`machine: ${p.machine}`);
      if (p.owns) f.push(`owns: [${p.owns.map((o) => JSON.stringify(o)).join(', ')}]`);
      if (p.dependsOn) f.push(`dependsOn: [${p.dependsOn.join(', ')}]`);
      f.push('---', '', `# Phase ${i + 1}: ${p.name || ''}`, '', '## Success Criteria', '', `- ${p.test || 'true'}`, '');
      fs.writeFileSync(path.join(dir, p.file), f.join('\n'));
    });
    return dir;
  }

  const originHas = (branch) => { try { git(base.origin, 'rev-parse', '--verify', `refs/heads/${branch}`); return true; } catch { return false; } };
  const originHead = (branch) => git(base.origin, 'rev-parse', `refs/heads/${branch}`);

  /** Make the bare origin reject every push (pre-receive) until allowPush(). Message matches REJECT_RE. */
  function rejectPushes() {
    const hook = path.join(base.origin, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, `#!/bin/sh\n[ -f ${JSON.stringify(flagFile)} ] && { echo "pre-receive hook declined (e2e)" >&2; exit 1; }\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(flagFile, '1');
  }
  const allowPush = () => fs.rmSync(flagFile, { force: true });

  /** [{machine, runId, dir, exited}] for every run dir on every machine. */
  function allRuns() {
    const out = [];
    let ms = []; try { ms = fs.readdirSync(lb); } catch { /* none yet */ }
    for (const m of ms) {
      const rd = path.join(lb, m, 'rig-home', 'runs');
      let ids = []; try { ids = fs.readdirSync(rd); } catch { /* none */ }
      for (const runId of ids) out.push({ machine: m, runId, dir: path.join(rd, runId), exited: fs.existsSync(path.join(rd, runId, 'exit')) });
    }
    return out;
  }

  /** Waits until the run's exit file exists. */
  async function waitExit(runDir, ms = 15000) {
    const t0 = Date.now();
    while (!fs.existsSync(path.join(runDir, 'exit')) && Date.now() - t0 < ms) await wait(100);
    return fs.existsSync(path.join(runDir, 'exit'));
  }

  /** Cancel stragglers, kill our tmux sessions, delete the temp root. Never touches foreign tmux sessions. */
  async function cleanup() {
    try {
      const live = allRuns().filter((r) => !r.exited);
      for (const r of live) cli(r.machine === 'alpha' ? 'delta' : 'alpha', ['cancel', r.machine, r.runId]);
      for (const r of live) await waitExit(r.dir);
      for (const r of allRuns()) sessions.add(`rig-${r.runId}`);
      for (const s of sessions) cp.spawnSync('tmux', ['kill-session', '-t', s], { stdio: 'ignore' });
    } finally {
      await wait(200);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  return { root, origin: base.origin, git, cli, cliAsync, addWorker, useRealClaude, repoOf, setMode, stubCalls, writePlan, originHas, originHead, rejectPushes, allowPush, allRuns, waitExit, cleanup, sessions, wait, envFor, registryFile };
}

module.exports = { createFixture, REMOTE_CJS };
