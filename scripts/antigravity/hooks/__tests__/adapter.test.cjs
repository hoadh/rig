// Run: node --test scripts/antigravity/hooks/__tests__/adapter.test.cjs
// Runs the real Rig hooks through the adapter in a generated-plugin layout, from the plugin dir as cwd (like agy).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeLayout, runAdapter, fixture, envFor } = require('./agy-test-layout.cjs');
const tb = require('./transcript-builder.cjs');

let L;
before(() => { L = makeLayout(); fs.mkdirSync(path.join(L.workspace, 'plans'), { recursive: true }); });
after(() => L.cleanup());

const fx = (name, over) => fixture(name, over, L);
const message = (stdout) => JSON.parse(stdout).injectSteps[0].systemMessage.systemMessage;
const CONV = '00000000-0000-4000-8000-0000000000aa';

test('session-init: injectSteps with Rig root line, paths inside the workspace, no plugin-copy side effects', () => {
  const r = runAdapter(L, 'session-init', fx('session-start', { conversationId: CONV }));
  assert.strictEqual(r.status, 0, r.stderr);
  const text = message(r.stdout);
  assert.ok(text.startsWith(`Rig root: ${L.pluginRoot}`), text.slice(0, 120));
  assert.ok(text.includes(L.workspace), 'workspace path missing');
  assert.ok(!text.includes(L.pluginRoot + path.sep + 'plans'), 'plans resolved in the plugin dir');
  // isPluginCopy() is false in the generated layout: no runtime copy, no 1.x notice
  assert.ok(!fs.existsSync(path.join(L.home, '.claude', 'rig')));
  assert.doesNotMatch(text, /1\.x/);
});

test('dev-rules-reminder: plain-text output becomes injectSteps on the first model call only', () => {
  const first = runAdapter(L, 'dev-rules-reminder', fx('pre-invocation-first', { conversationId: CONV }));
  assert.match(message(first.stdout), /Now:/);
  const later = runAdapter(L, 'dev-rules-reminder', fx('pre-invocation-later', { conversationId: CONV }));
  assert.strictEqual(later.stdout, '');
  assert.strictEqual(later.status, 0);
});

test('active plan set from a shell (ANTIGRAVITY_CONVERSATION_ID) reaches the reminder', () => {
  const plan = path.join(L.workspace, 'plans', '261113-1200-demo');
  fs.mkdirSync(plan, { recursive: true });
  const res = spawnSync(process.execPath, [path.join(L.pluginRoot, 'scripts', 'set-active-plan-antigravity.cjs'), 'plans/261113-1200-demo'], {
    cwd: L.workspace, env: envFor(L, { conversationId: CONV }), encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Active plan set to:/);
  const r = runAdapter(L, 'dev-rules-reminder', fx('pre-invocation-first', { conversationId: CONV, lastUserInput: 'next step' }));
  assert.ok(message(r.stdout).includes('261113-1200-demo'), r.stdout);
});

test('plan change between turns is emitted even when the transcript already holds our injected context', () => {
  const conv = '00000000-0000-4000-8000-0000000000bb';
  const transcript = path.join(L.root, 'brain', '.system_generated', 'logs', 'transcript_full.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const marker = { type: 'SYSTEM_MESSAGE', source: 'SYSTEM_SDK', content: 'injected by a PreInvocation hook:\n## Rig Session\n- Now: x\n\n## Plan Context\n- Plan: none' };
  fs.writeFileSync(transcript, tb.toJsonl([tb.user('turn 1'), marker, tb.planner('ok')]));
  const payload = (over) => fx('pre-invocation-first', { conversationId: conv, transcriptPath: transcript, ...over });
  assert.match(message(runAdapter(L, 'dev-rules-reminder', payload({ lastUserInput: 'turn 1' })).stdout), /Plan: none/);
  const same = runAdapter(L, 'dev-rules-reminder', payload({ lastUserInput: 'turn 1b' }));
  assert.doesNotMatch(message(same.stdout), /Plan Context/, 'unchanged state: Now line only');
  const plan = path.join(L.workspace, 'plans', '261113-1300-turn2');
  fs.mkdirSync(plan, { recursive: true });
  const set = spawnSync(process.execPath, [path.join(L.pluginRoot, 'scripts', 'set-active-plan-antigravity.cjs'), plan], { cwd: L.workspace, env: envFor(L, { conversationId: conv }), encoding: 'utf8' });
  assert.strictEqual(set.status, 0, set.stderr);
  assert.match(message(runAdapter(L, 'dev-rules-reminder', payload({ lastUserInput: 'turn 2' })).stdout), /261113-1300-turn2/);
});

test('set-active-plan-antigravity without a conversation id warns and writes nothing', () => {
  const res = spawnSync(process.execPath, [path.join(L.pluginRoot, 'scripts', 'set-active-plan-antigravity.cjs'), 'plans/x'], {
    cwd: L.workspace, env: envFor(L), encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /ANTIGRAVITY_CONVERSATION_ID not set/);
});

const guard = (command, over = {}) => runAdapter(L, 'bash-safety-guard', fx('pre-tool-use-run-command', { toolCall: { id: 'c', name: 'run_command', args: { CommandLine: command } }, ...over }));

test('guard: allowed command prints nothing (never {})', () => {
  const r = guard('ls -la');
  assert.deepStrictEqual([r.status, r.stdout], [0, '']);
});

test('guard: deny -> deny, ask -> force_ask', () => {
  assert.strictEqual(JSON.parse(guard('pkill -f node').stdout).decision, 'deny');
  const ask = JSON.parse(guard('cat .env').stdout);
  assert.strictEqual(ask.decision, 'force_ask');
  assert.match(ask.reason, /\.env/);
});

test('guard: terminal input is guarded like a command', () => {
  const r = runAdapter(L, 'bash-safety-guard', fx('pre-tool-use-run-command', { toolCall: { id: 'c', name: 'send_command_input', args: { Input: 'cat .env' } } }));
  assert.strictEqual(JSON.parse(r.stdout).decision, 'force_ask');
});

test('guard: shell tool without a command fails closed', () => {
  for (const args of [{}, { CommandLine: '' }]) {
    const r = runAdapter(L, 'bash-safety-guard', fx('pre-tool-use-run-command', { toolCall: { id: 'c', name: 'run_command', args } }));
    assert.strictEqual(JSON.parse(r.stdout).decision, 'deny');
  }
});

test('guard: send_command_input without Input (terminate) is allowed; with a secret read it asks', () => {
  const call = (args) => runAdapter(L, 'bash-safety-guard', fx('pre-tool-use-run-command', { toolCall: { id: 'c', name: 'send_command_input', args } }));
  assert.strictEqual(call({ CommandId: 'abc', Terminate: true }).stdout, '');
  assert.strictEqual(call({ CommandId: 'abc', Input: '' }).stdout, '');
  assert.strictEqual(JSON.parse(call({ CommandId: 'abc', Input: 'cat .env\n' }).stdout).decision, 'force_ask');
});

test('guard: read-tool hardening - padded paths and grep_search Includes', () => {
  const read = (name, args) => runAdapter(L, 'bash-safety-guard', fx('pre-tool-use-read-file', { toolCall: { id: 'c', name, args } })).stdout;
  const padded = `${L.workspace}/${'./'.repeat(600)}.env`;
  assert.strictEqual(JSON.parse(read('read_file', { Path: padded })).decision, 'force_ask');
  const grep = (Includes) => read('grep_search', { SearchPath: L.workspace, Query: '.', Includes });
  for (const hit of [['.env'], ['.env*'], ['*.pem'], ['**/.env.production']]) assert.strictEqual(JSON.parse(grep(hit)).decision, 'force_ask', hit.join());
  for (const pass of [['*.js'], ['*.json'], ['*'], ['.env.example'], ['src/**/*.ts']]) assert.strictEqual(grep(pass), '', pass.join());
  assert.strictEqual(read('grep_search', { SearchPath: L.workspace, Query: '.' }), '');
});

test('guard: native read tool on a secret file asks; templates and normal files pass', () => {
  const read = (p) => runAdapter(L, 'bash-safety-guard', fx('pre-tool-use-read-file', { toolCall: { id: 'c', name: 'read_file', args: { Path: p } } }));
  assert.strictEqual(JSON.parse(read(path.join(L.workspace, '.env')).stdout).decision, 'force_ask');
  assert.strictEqual(JSON.parse(read('.env.production').stdout).decision, 'force_ask'); // relative: workspace is the base
  assert.strictEqual(JSON.parse(read('~/.ssh/id_rsa').stdout).decision, 'force_ask');
  assert.strictEqual(read(path.join(L.workspace, '.env.example')).stdout, '');
  assert.strictEqual(read(path.join(L.workspace, 'README.md')).stdout, '');
});

test('guard: tools outside the guard set pass without a child', () => {
  const r = runAdapter(L, 'bash-safety-guard', fx('pre-tool-use-run-command', { toolCall: { id: 'c', name: 'write_file', args: { Path: '/x/.env' } } }));
  assert.strictEqual(r.stdout, '');
});

test('guard: child that prints an unreadable decision is denied; child that crashes fails open', () => {
  const script = path.join(L.pluginRoot, 'hooks', 'bash-safety-guard.cjs');
  const original = fs.readFileSync(script, 'utf8');
  try {
    fs.writeFileSync(script, 'process.stdout.write("{}");');
    assert.strictEqual(JSON.parse(guard('ls').stdout).decision, 'deny');
    fs.writeFileSync(script, 'process.exit(3);');
    assert.strictEqual(guard('ls').stdout, '');
    fs.writeFileSync(script, 'process.stdout.write(\'{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"x"}}\'); process.exit(3);');
    assert.strictEqual(JSON.parse(guard('ls').stdout).decision, 'deny'); // decided, then exited non-zero: still honoured
  } finally {
    fs.writeFileSync(script, original);
  }
});

test('adapter: malformed stdin, empty stdin, unknown and traversal hook names print nothing and exit 0', () => {
  for (const [hook, input] of [['session-init', '{broken'], ['session-init', ''], ['session-init', '[]'], ['nope', '{}'], ['../antigravity-session-id', '{}'], ['', '{}']]) {
    const r = runAdapter(L, hook, input);
    assert.deepStrictEqual([r.status, r.stdout], [0, ''], hook);
  }
  assert.deepStrictEqual(spawnSync(process.execPath, [path.join(L.pluginRoot, 'hooks', 'antigravity-hook-adapter.cjs')], { input: '{}', encoding: 'utf8' }).stdout, '');
});

test('guard latency (informational)', () => {
  const runs = 8;
  const t = [];
  for (let i = 0; i < runs; i += 1) t.push(guard('ls -la').ms);
  const avg = t.reduce((a, b) => a + b, 0) / runs;
  console.log(`# adapter+guard latency: avg ${avg.toFixed(0)} ms, max ${Math.max(...t).toFixed(0)} ms over ${runs} runs`);
  assert.ok(avg < 2000);
});

// ---- Stop ----
const stopCtx = (name, steps, over = {}) => {
  const dir = path.join(L.root, name);
  const tpath = path.join(dir, '.system_generated', 'logs', 'transcript_full.jsonl');
  fs.mkdirSync(path.dirname(tpath), { recursive: true });
  fs.writeFileSync(tpath, tb.toJsonl(steps));
  return fx('stop', { conversationId: `00000000-0000-4000-8000-${name.padStart(12, '0')}`, transcriptPath: tpath, ...over });
};
const editNoVerify = [tb.user('fix'), tb.planner('', [tb.edit('/w/src/a.js')]), tb.result('edited'), tb.planner('Fixed.')];
const stop = (payload) => runAdapter(L, 'verify-completion-guard', payload);
const setMode = (mode) => {
  fs.mkdirSync(path.join(L.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(L.home, '.claude', '.rig.json'), JSON.stringify({ verifyGuard: { mode } }));
};

test('stop (remind): unverified edit continues once with the nudge; second stop is silent', () => {
  setMode('remind');
  const first = stop(stopCtx('101', editNoVerify));
  const out = JSON.parse(first.stdout);
  assert.strictEqual(out.decision, 'continue');
  assert.match(out.reason, /no passing test/);
  assert.strictEqual(stop(stopCtx('101', editNoVerify, { continuationActive: true })).stdout, '');
  assert.deepStrictEqual(fs.readdirSync(path.join(L.pluginData, 'state')).filter((f) => f.startsWith('agy-transcript-')), [], 'temp transcript left behind');
});

test('stop: verified turn, no edits, subagent, error stops and missing PLUGIN_DATA stay silent', () => {
  setMode('remind');
  const verified = [...editNoVerify.slice(0, 3), tb.planner('', [tb.run('npm test')]), tb.ok(), tb.planner('Fixed.')];
  assert.strictEqual(stop(stopCtx('102', verified)).stdout, '');
  assert.strictEqual(stop(stopCtx('103', [tb.user('hi'), tb.planner('Hello.')])).stdout, '');
  const sub = [{ type: 'SYSTEM_MESSAGE', source: 'SYSTEM', content: 'task' }, ...editNoVerify.slice(1)];
  assert.strictEqual(stop(stopCtx('104', sub)).stdout, '');
  assert.strictEqual(stop(stopCtx('105', editNoVerify, { terminationReason: 'ERROR' })).stdout, '');
  assert.strictEqual(stop(stopCtx('106', editNoVerify, { error: 'boom' })).stdout, '');
  assert.strictEqual(stop(stopCtx('107', editNoVerify, { transcriptPath: '/nonexistent/t.jsonl' })).stdout, '');
  const noData = runAdapter(L, 'verify-completion-guard', stopCtx('108', editNoVerify), { env: { PLUGIN_DATA: '' } });
  assert.strictEqual(noData.stdout, '');
});

test('stop (block): blocks twice per turn then lets go; escape phrase passes; a new turn blocks again', () => {
  setMode('block');
  const turn1 = stopCtx('201', editNoVerify);
  assert.strictEqual(JSON.parse(stop(turn1).stdout).decision, 'continue');
  assert.strictEqual(JSON.parse(stop({ ...turn1, continuationActive: true }).stdout).decision, 'continue');
  assert.strictEqual(stop({ ...turn1, continuationActive: true }).stdout, '', 'cap of 2 per turn');
  // turn 2 in the same conversation: new explicit user input, new turn id
  const turn2 = stopCtx('201', [...editNoVerify, tb.user('again'), tb.planner('', [tb.edit('/w/src/b.js')]), tb.result('edited'), tb.planner('Fixed again.')]);
  assert.strictEqual(JSON.parse(stop(turn2).stdout).decision, 'continue');
  const escape = stopCtx('202', [...editNoVerify.slice(0, 3), tb.planner('Verification skipped: no test runner here.')]);
  assert.strictEqual(stop(escape).stdout, '');
});

test('stop: the adapter cap holds even when the hook would continue', () => {
  setMode('block');
  const payload = stopCtx('301', editNoVerify);
  const { convertTranscript } = require('../antigravity-transcript-to-claude.cjs');
  const { bumpCount, MAX_CONTINUATIONS_PER_TURN } = require('../antigravity-stop-state.cjs');
  const { turnId } = convertTranscript(payload.transcriptPath, payload.conversationId);
  for (let i = 0; i < MAX_CONTINUATIONS_PER_TURN; i += 1) assert.ok(bumpCount(L.pluginData, payload.conversationId, turnId));
  assert.strictEqual(stop(payload).stdout, '');
});

test('stop log: subagent skipped before the hook is spawned; main with injected SYSTEM_MESSAGE steps still runs', () => {
  setMode('remind');
  const sys = { type: 'SYSTEM_MESSAGE', source: 'SYSTEM_SDK', content: 'injected by a SessionStart hook' };
  const main = [tb.user('fix'), sys, sys, tb.planner('', [tb.edit('/w/src/a.js')]), tb.result('edited'), tb.planner('Fixed.')];
  const sub = [{ type: 'SYSTEM_MESSAGE', source: 'SYSTEM', content: 'parent task' }, ...main.slice(1)];
  const logFile = path.join(L.pluginData, 'logs', 'hook-log.jsonl');
  const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0;
  const subPayload = stopCtx('401', sub);
  const mainPayload = stopCtx('402', main);
  assert.strictEqual(stop(subPayload).stdout, '');
  assert.strictEqual(JSON.parse(stop(mainPayload).stdout).decision, 'continue');
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').slice(before).filter(Boolean).map((l) => JSON.parse(l));
  const agy = lines.filter((l) => l.hook === 'agy-verify-completion-guard' || /conv=/.test(l.note || ''));
  const crypto = require('crypto');
  const tag = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 8);
  assert.ok(agy.some((l) => l.note.includes(`conv=${tag(subPayload.conversationId)} skip subagent`)), JSON.stringify(agy));
  assert.ok(agy.some((l) => l.note.includes(`conv=${tag(mainPayload.conversationId)} run continue`)), JSON.stringify(agy));
  assert.ok(!lines.some((l) => /skip subagent/.test(l.note || '') && l.note.includes(tag(mainPayload.conversationId))));
  assert.ok(!JSON.stringify(lines).includes(subPayload.conversationId), 'raw conversation id must not be logged');
  // the hook itself ran once (main), not for the subagent
  const hookRuns = lines.filter((l) => l.hook === 'verify-completion-guard');
  assert.strictEqual(hookRuns.length, 1, JSON.stringify(hookRuns));
});

test('stop: conversation cap holds when every continuation looks like a new turn', () => {
  setMode('block');
  const conv = '00000000-0000-4000-8000-000000000401';
  const { bumpCount, MAX_PER_CONVERSATION_WINDOW } = require('../antigravity-stop-state.cjs');
  for (let i = 0; i < MAX_PER_CONVERSATION_WINDOW; i += 1) assert.ok(bumpCount(L.pluginData, conv, `other-turn-${i}`));
  const payload = stopCtx('401', editNoVerify, { conversationId: conv });
  assert.strictEqual(stop(payload).stdout, '');
  // another conversation is unaffected
  assert.strictEqual(JSON.parse(stop(stopCtx('402b', editNoVerify)).stdout).decision, 'continue');
});

test('stop: no conversation id means no Stop (shared state files would cross conversations)', () => {
  setMode('remind');
  assert.strictEqual(stop(stopCtx('501', editNoVerify, { conversationId: '' })).stdout, '');
  assert.deepStrictEqual(fs.readdirSync(path.join(L.pluginData, 'state')).filter((f) => /^agy-(stop|transcript)-(\.|json|jsonl|$)/.test(f) || f === 'agy-stop-.json' || f === 'agy-transcript-.jsonl'), []);
});
