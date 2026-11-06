#!/usr/bin/env node
/**
 * Tests for the bash-safety-guard PreToolUse hook (entry script, rule contract, config, logging).
 * Each test installs a COPY of the hook into a temp HOME so the hook log and the global
 * ~/.claude/.rig.json are isolated; HOME and USERPROFILE are both set (Windows uses the latter).
 * Run: node --test plugins/rig/hooks/__tests__/bash-safety-guard.test.cjs
 * Env: RIG_SKIP_PERF=1 skips the latency test on slow CI.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateCommand } = require('../lib/bash-safety-rule-engine.cjs');

const HOOKS_SRC = path.resolve(__dirname, '..');
const roots = [];
test.after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

/** Copies the hook entry + lib/*.cjs into <dir>/.claude/hooks. */
function installHook(dir) {
  const dest = path.join(dir, '.claude', 'hooks');
  fs.mkdirSync(path.join(dest, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(HOOKS_SRC, 'bash-safety-guard.cjs'), path.join(dest, 'bash-safety-guard.cjs'));
  for (const f of fs.readdirSync(path.join(HOOKS_SRC, 'lib'))) {
    if (f.endsWith('.cjs')) fs.copyFileSync(path.join(HOOKS_SRC, 'lib', f), path.join(dest, 'lib', f));
  }
  return path.join(dest, 'bash-safety-guard.cjs');
}

/** Temp world: fake HOME with the hook installed, a work dir with a symlink, optional global config. */
function setup(globalConfig) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-bsg-')));
  roots.push(root);
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  fs.mkdirSync(work, { recursive: true });
  const hook = installHook(home);
  if (globalConfig) fs.writeFileSync(path.join(home, '.claude', '.rig.json'), JSON.stringify(globalConfig));
  fs.writeFileSync(path.join(work, 'real.conf'), 'a\n');
  let symlink = true;
  try {
    fs.symlinkSync(path.join(work, 'real.conf'), path.join(work, 'link.conf'));
  } catch {
    symlink = false;
  }
  const logFile = path.join(home, '.claude', 'hooks', '.logs', 'hook-log.jsonl');
  return { root, home, work, hook, symlink, logFile };
}

function runHook(world, input, { hook = world.hook, env = {}, cwd = world.work, raw } = {}) {
  const res = spawnSync(process.execPath, [hook], {
    input: raw !== undefined ? raw : JSON.stringify(input),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, HOME: world.home, USERPROFILE: world.home, CLAUDE_PROJECT_DIR: '', ...env },
  });
  let out = null;
  if (res.stdout.trim()) out = JSON.parse(res.stdout).hookSpecificOutput;
  return { status: res.status, out, stderr: res.stderr };
}

const bash = (command, world) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: world.work });
const logLines = (world) => (fs.existsSync(world.logFile)
  ? fs.readFileSync(world.logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

test('denies a pkill -f self-match with reason, no additionalContext', () => {
  const w = setup();
  const { status, out } = runHook(w, bash('pkill -f server.js', w));
  assert.strictEqual(status, 0);
  assert.strictEqual(out.hookEventName, 'PreToolUse');
  assert.strictEqual(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /\[v\]ite/);
  assert.ok(out.permissionDecisionReason.length <= 300);
});

test('asks for common names and attaches additionalContext', () => {
  const w = setup();
  const { out } = runHook(w, bash('pkill node', w));
  assert.strictEqual(out.permissionDecision, 'ask');
  assert.match(out.additionalContext, /pgrep/);
});

test('denies sed -i on a symlink (cwd from payload)', (t) => {
  const w = setup();
  if (!w.symlink) return t.skip('no symlink support');
  const { out } = runHook(w, bash(`sed -i 's/a/b/' link.conf`, w));
  assert.strictEqual(out.permissionDecision, process.platform === 'win32' ? 'ask' : 'deny');
});

test('allow path: no output, exit 0, and no hook-log line', () => {
  const w = setup();
  for (const cmd of ['ls -la', `echo "sed -i x link.conf"`, 'killall Finder', `pkill -f '[s]erver.js'`, 'sed -i x real.conf']) {
    const { status, out } = runHook(w, bash(cmd, w));
    assert.strictEqual(status, 0, cmd);
    assert.strictEqual(out, null, cmd);
  }
  assert.deepStrictEqual(logLines(w), []);
});

test('malformed stdin, empty stdin, non-Bash tool and missing command exit 0 silently', () => {
  const w = setup();
  for (const opts of [{ raw: 'not json' }, { raw: '' }, { raw: '[]' }, { raw: 'null' }]) {
    const { status, out } = runHook(w, null, opts);
    assert.strictEqual(status, 0);
    assert.strictEqual(out, null);
  }
  const other = runHook(w, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { command: 'pkill -f x' } });
  assert.strictEqual(other.out, null);
  const none = runHook(w, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  assert.strictEqual(none.out, null);
});

test('logs deny/ask with rule id and command hash, never the raw command', () => {
  const w = setup();
  const secretish = 'pkill -f supersecret-token-123';
  runHook(w, bash(secretish, w));
  runHook(w, bash('pkill claude', w));
  const lines = logLines(w);
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0].note, /^decision:deny rule:process-kill cmd:[0-9a-f]{12}$/);
  assert.match(lines[1].note, /^decision:ask rule:process-kill cmd:[0-9a-f]{12}$/);
  assert.ok(!fs.readFileSync(w.logFile, 'utf8').includes('supersecret'));
  assert.ok(lines.every((l) => l.hook === 'bash-safety-guard'));
});

test('entry crash fails open and is logged', () => {
  const w = setup();
  const tokenizer = path.join(w.home, '.claude', 'hooks', 'lib', 'bash-command-segment-tokenizer.cjs');
  fs.writeFileSync(tokenizer, `module.exports = { tokenize() { throw new Error('boom'); }, commandName() { return ''; }, expandHome(p) { return p; } };`);
  const { status, out } = runHook(w, bash('pkill -f vite', w));
  assert.strictEqual(status, 0);
  assert.strictEqual(out, null);
  const lines = logLines(w);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].status, 'crash');
});

test('global toggles: hook off and per-rule off', () => {
  const off = setup({ hooks: { 'bash-safety-guard': false } });
  assert.strictEqual(runHook(off, bash('pkill -f vite', off)).out, null);

  const ruleOff = setup({ bashSafetyGuard: { rules: { processKill: false } } });
  assert.strictEqual(runHook(ruleOff, bash('pkill -f vite', ruleOff)).out, null);
  if (ruleOff.symlink && process.platform !== 'win32') {
    assert.strictEqual(runHook(ruleOff, bash('sed -i x link.conf', ruleOff)).out.permissionDecision, 'deny');
  }

  const otherRuleOff = setup({ bashSafetyGuard: { rules: { inPlaceEditSymlink: false } } });
  assert.strictEqual(runHook(otherRuleOff, bash('pkill -f vite', otherRuleOff)).out.permissionDecision, 'deny');
});

test('project-local .rig.json toggles are ignored', () => {
  const w = setup();
  const project = path.join(w.root, 'project');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', '.rig.json'),
    JSON.stringify({ hooks: { 'bash-safety-guard': false }, bashSafetyGuard: { rules: { processKill: false } } }));
  const { out } = runHook(w, bash('pkill -f vite', w), { cwd: project, env: { CLAUDE_PROJECT_DIR: project } });
  assert.strictEqual(out.permissionDecision, 'deny');
});

test('exactly one copy guards when global and project both install the hook (RT#8)', () => {
  const w = setup();
  const project = path.join(w.root, 'project');
  const projectHook = installHook(project);
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/bash-safety-guard.cjs' }] }] },
  }));
  const env = { CLAUDE_PROJECT_DIR: project };
  const input = bash('pkill -f vite', w);
  const globalRun = runHook(w, input, { env, cwd: project });
  const projectRun = runHook(w, input, { hook: projectHook, env, cwd: project });
  assert.strictEqual(globalRun.out, null, 'global copy must yield');
  assert.strictEqual(projectRun.out.permissionDecision, 'deny', 'project copy guards');
  // without a project copy registered, the global copy guards
  const lone = setup();
  assert.strictEqual(runHook(lone, bash('pkill -f vite', lone), { env: { CLAUDE_PROJECT_DIR: lone.work } }).out.permissionDecision, 'deny');
});

test('allow path latency: median overhead over bare node stays small (generous, load tolerant)', (t) => {
  if (process.env.RIG_SKIP_PERF) return t.skip('RIG_SKIP_PERF set');
  const w = setup();
  const time = (args, input) => {
    const t0 = process.hrtime.bigint();
    spawnSync(process.execPath, args, { input, env: { ...process.env, HOME: w.home, USERPROFILE: w.home } });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const payload = JSON.stringify(bash('ls -la', w));
  const hookMs = [];
  const baseMs = [];
  for (let i = 0; i < 30; i += 1) {
    hookMs.push(time([w.hook], payload));
    baseMs.push(time(['-e', ''], ''));
  }
  const base = median(baseMs);
  // A machine whose bare node start is already slow is too loaded for a latency gate.
  if (base > 80) return t.skip(`machine loaded: bare node median ${base.toFixed(0)} ms`);
  // Medians (not p95) so a few scheduler hiccups under parallel test load do not fail the run.
  const overhead = median(hookMs) - base;
  assert.ok(overhead < 100, `guard median overhead ${overhead.toFixed(1)} ms (hook ${median(hookMs).toFixed(1)}, node ${base.toFixed(1)})`);
});

// Rule contract (engine level, with stub rules)

const stub = (over) => ({ id: 'stub', configKey: 'stub', opaquePolicy: 'skip', crashPolicy: 'allow', check: () => null, ...over });

test('opaque segment reaches an `inspect` rule with its raw text, and not a `skip` rule', () => {
  const seen = { inspect: [], skip: [] };
  const rules = [
    stub({ id: 'i', opaquePolicy: 'inspect', check: (s) => { seen.inspect.push(s.raw); return null; } }),
    stub({ id: 's', opaquePolicy: 'skip', check: (s) => { seen.skip.push(s.raw); return null; } }),
  ];
  evaluateCommand('cat $(x) ; ls', { rules, cwd: process.cwd() });
  assert.deepStrictEqual(seen.inspect, ['cat $(x)', 'ls']);
  assert.deepStrictEqual(seen.skip, ['ls']);
});

test('rule crash follows crashPolicy; entry-level strongest decision wins', () => {
  const boom = () => { throw Object.assign(new Error('/secret/path failed'), { code: 'EACCES' }); };
  const asked = evaluateCommand('ls', { rules: [stub({ id: 'c', crashPolicy: 'ask', check: boom })], cwd: process.cwd() });
  assert.strictEqual(asked.result.decision, 'ask');
  assert.strictEqual(asked.crashes[0].ruleId, 'c');
  assert.ok(!JSON.stringify(asked.crashes).includes('secret'), 'crash info must not carry paths');

  const allowed = evaluateCommand('ls', { rules: [stub({ crashPolicy: 'allow', check: boom })], cwd: process.cwd() });
  assert.strictEqual(allowed.result, null);
  assert.strictEqual(allowed.crashes.length, 1);

  const mixed = evaluateCommand('ls', {
    rules: [stub({ id: 'a', check: () => ({ decision: 'ask', reason: 'x' }) }), stub({ id: 'd', check: () => ({ decision: 'deny', reason: 'y' }) })],
    cwd: process.cwd(),
  });
  assert.strictEqual(mixed.result.decision, 'deny');
  assert.strictEqual(mixed.result.ruleId, 'd');
});

test('disabled rules are not run; invalid decisions are ignored', () => {
  const rules = [stub({ id: 'x', check: () => ({ decision: 'deny', reason: 'no' }) })];
  assert.strictEqual(evaluateCommand('ls', { rules, cwd: process.cwd(), isRuleEnabled: () => false }).result, null);
  const bogus = [stub({ check: () => ({ decision: 'allow', reason: 'r' }) })];
  assert.strictEqual(evaluateCommand('ls', { rules: bogus, cwd: process.cwd() }).result, null);
});

test('pgrep -f feeding kill is denied at the entry; bracket form allowed (M3, F1)', () => {
  const w = setup();
  for (const cmd of ['pgrep -f vite | xargs kill', 'pgrep -f vite | xargs -r kill -9', 'kill $(pgrep -f vite)', 'kill `pgrep -f vite`']) {
    const { out } = runHook(w, bash(cmd, w));
    assert.strictEqual(out && out.permissionDecision, 'deny', cmd);
    assert.doesNotMatch(out.permissionDecisionReason.replace(/^.*?(?=Use the bracket)/, ''), /pgrep -a?f/, cmd);
  }
  for (const cmd of [`pgrep -f '[v]ite' | xargs kill`, `kill $(pgrep -f '[v]ite')`, 'pgrep -x vite | xargs kill']) {
    assert.strictEqual(runHook(w, bash(cmd, w)).out, null, cmd);
  }
});

test('ReDoS pattern asks and answers within a second (H2)', () => {
  const w = setup();
  const t0 = Date.now();
  const { out } = runHook(w, bash(`pkill -f '(a+)+b' #${'a'.repeat(40)}`, w));
  assert.strictEqual(out.permissionDecision, 'ask');
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
});

test('shell option and eval wrappers are inspected (L1)', () => {
  const w = setup();
  for (const cmd of [`bash -o pipefail -c 'pkill -f node'`, `eval 'pkill -f node'`]) {
    assert.strictEqual(runHook(w, bash(cmd, w)).out.permissionDecision, 'deny', cmd);
  }
});

test('entry-level crash logs only error name and code (M4)', () => {
  const w = setup();
  // the installed copy of a lib module throws an error whose message holds a path and a secret
  const cfg = path.join(w.home, '.claude', 'hooks', 'lib', 'bash-safety-guard-config.cjs');
  fs.writeFileSync(cfg, "const e = new Error('boom /home/secret-user/private.txt'); e.code = 'EBOOM'; throw e;\n");
  const { status, out } = runHook(w, bash('ls', w));
  assert.strictEqual(status, 0);
  assert.strictEqual(out, null);
  const crash = logLines(w).find((l) => l.status === 'crash');
  assert.ok(crash, 'crash entry expected');
  assert.strictEqual(crash.error, 'Error:EBOOM');
  assert.ok(!JSON.stringify(crash).includes('secret-user'));
});

test('reviewer ReDoS payloads return ask in under 1.5s each through the real hook (H-1)', () => {
  const w = setup();
  for (const command of [
    `true ${'a'.repeat(40)}\npkill -f '(.*a){12}x|vite'`,
    `true ${'a'.repeat(40)}\npkill -f '(?:.*?){20}x|vite'`,
    `true ${'a'.repeat(7000)}\npkill -f '.*.*Q|vite'`,
    `echo ${'a'.repeat(40)}; kill $(pgrep -f '(.*a){12}x')`,
  ]) {
    const t0 = Date.now();
    const { out } = runHook(w, bash(command, w));
    assert.strictEqual(out && out.permissionDecision, 'ask', command.slice(-40));
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
  }
});

test('placeholder xargs, while-read and assignment pgrep->kill forms are denied at the entry (M-new-1)', () => {
  const w = setup();
  for (const cmd of ['pgrep -f vite | xargs -I{} kill {}', 'pgrep -f vite | while read p; do kill $p; done', 'P=$(pgrep -f vite); kill $P', 'kill $(pgrep -f "(vite)")']) {
    assert.strictEqual(runHook(w, bash(cmd, w)).out.permissionDecision, 'deny', cmd);
  }
});
