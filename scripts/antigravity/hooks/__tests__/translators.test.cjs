// Run: node --test scripts/antigravity/hooks/__tests__/translators.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const toClaude = require('../antigravity-payload-to-claude.cjs');
const out = require('../claude-output-to-antigravity.cjs');
const { sessionIdFrom } = require('../antigravity-session-id.cjs');
const { hooksJson, portedHooks } = require('../antigravity-hooks-json.cjs');
const stopState = require('../antigravity-stop-state.cjs');
const { resolveHookScript } = require('../antigravity-hook-child.cjs');
const { fixture } = require('./agy-test-layout.cjs');

const WS = '/home/user/work/project';

test('sessionStart: ids, transcript, workspace, source', () => {
  const p = toClaude.sessionStart(fixture('session-start'), WS);
  assert.deepStrictEqual([p.session_id, p.cwd, p.hook_event_name, p.source], ['00000000-0000-4000-8000-000000000001', WS, 'SessionStart', 'startup']);
  assert.match(p.transcript_path, /transcript_full\.jsonl$/);
});

test('preInvocation: lastUserInput becomes prompt; missing input is empty', () => {
  const p = toClaude.preInvocation(fixture('pre-invocation-first'), WS);
  assert.strictEqual(p.prompt, 'Fix the failing unit test.');
  assert.strictEqual(p.hook_event_name, 'UserPromptSubmit');
  assert.strictEqual(p.transcript_path, '', 'must not hand the reminder our own injected context');
  assert.strictEqual(toClaude.preInvocation({ conversationId: 'x' }, WS).prompt, '');
});

test('workspaceOf: first absolute workspace path, else absolute cwd, else empty', () => {
  assert.strictEqual(toClaude.workspaceOf({ workspacePaths: ['rel', '/a'], cwd: '/b' }), '/a');
  assert.strictEqual(toClaude.workspaceOf({ cwd: '/b' }), '/b');
  assert.strictEqual(toClaude.workspaceOf({ workspacePaths: 'x', cwd: 'rel' }), '');
});

test('classifyTool: run_command -> Bash command; terminal input too', () => {
  const t = toClaude.classifyTool(fixture('pre-tool-use-run-command'), WS);
  assert.strictEqual(t.kind, 'shell');
  assert.deepStrictEqual([t.payload.tool_name, t.payload.tool_input.command, t.payload.cwd], ['Bash', 'npm test', WS]);
  const term = toClaude.classifyTool({ toolCall: { name: 'send_command_input', args: { Input: 'cat .env' } } }, WS);
  assert.strictEqual(term.payload.tool_input.command, 'cat .env');
});

test('classifyTool: shell tool without a command is a miss, not "other"', () => {
  for (const args of [{}, { CommandLine: '' }, { CommandLine: 5 }]) {
    const t = toClaude.classifyTool({ toolCall: { name: 'run_command', args } }, WS);
    assert.deepStrictEqual([t.kind, t.command, t.payload], ['shell', null, null]);
  }
  assert.strictEqual(toClaude.classifyTool({}, WS).kind, 'other');
  assert.strictEqual(toClaude.classifyTool({ toolCall: { name: 'run_command', args: [] } }, WS).command, null);
});

test('classifyTool: send_command_input without Input (terminate, wait) is not a miss', () => {
  for (const args of [{ CommandId: 'x', Terminate: true }, { Input: '' }, {}]) {
    assert.strictEqual(toClaude.classifyTool({ toolCall: { name: 'send_command_input', args } }, WS).kind, 'other');
  }
});

test('classifyTool: grep_search Includes are returned next to the paths', () => {
  const r = toClaude.classifyTool({ toolCall: { name: 'grep_search', args: { SearchPath: '/w', Query: 'x', Includes: ['.env', 3, ''] } } }, WS);
  assert.deepStrictEqual([r.paths, r.includes], [['/w'], ['.env']]);
});

test('classifyTool: read tools yield their path args; unknown tools are other', () => {
  const r = toClaude.classifyTool(fixture('pre-tool-use-read-file'), WS);
  assert.deepStrictEqual([r.kind, r.paths, r.includes], ['read', ['/home/user/.gemini/config/plugins/rig/skills/plan/SKILL.md'], []]);
  assert.deepStrictEqual(toClaude.classifyTool({ toolCall: { name: 'grep_search', args: { Query: 'x', SearchPath: '/a/.env' } } }, WS).paths, ['/a/.env']);
  assert.strictEqual(toClaude.classifyTool({ toolCall: { name: 'write_file', args: { Path: '/a' } } }, WS).kind, 'other');
});

test('stop payload: continuationActive -> stop_hook_active', () => {
  const extra = { transcriptPath: '/t.jsonl', lastAssistantMessage: 'Done', turnId: 'abc' };
  assert.strictEqual(toClaude.stop(fixture('stop'), WS, extra).stop_hook_active, false);
  const p = toClaude.stop({ ...fixture('stop'), continuationActive: true }, WS, extra);
  assert.deepStrictEqual([p.stop_hook_active, p.transcript_path, p.last_assistant_message, p.prompt_id], [true, '/t.jsonl', 'Done', 'abc']);
});

test('contextOutput: JSON additionalContext, plain text, empty, malformed', () => {
  const steps = (s) => JSON.parse(s).injectSteps[0].systemMessage.systemMessage;
  assert.strictEqual(steps(out.contextOutput(JSON.stringify({ hookSpecificOutput: { additionalContext: 'ctx' } }))), 'ctx');
  assert.strictEqual(steps(out.contextOutput('- Now: 2026-11-13\n')), '- Now: 2026-11-13');
  assert.strictEqual(steps(out.contextOutput('ctx', 'Rig root: /r')), 'Rig root: /r\n\nctx');
  for (const bad of ['', '  \n', '{"x":1}', '{broken', '[1]', JSON.stringify({ hookSpecificOutput: {} })]) assert.strictEqual(out.contextOutput(bad), '', bad);
});

test('guardOutput: deny -> deny, ask -> force_ask with context, empty allows, unknown is unrecognized', () => {
  const mk = (d, extra = {}) => JSON.stringify({ hookSpecificOutput: { permissionDecision: d, permissionDecisionReason: 'why', ...extra } });
  assert.deepStrictEqual(JSON.parse(out.guardOutput(mk('deny')).out), { decision: 'deny', reason: 'why' });
  assert.deepStrictEqual(JSON.parse(out.guardOutput(mk('ask', { additionalContext: 'fix' })).out), { decision: 'force_ask', reason: 'why fix' });
  assert.deepStrictEqual(out.guardOutput(''), { out: '', recognized: true });
  for (const bad of ['{}', '{broken', mk('allow'), mk('weird'), 'plain text']) assert.strictEqual(out.guardOutput(bad).recognized, false, bad);
  assert.notStrictEqual(out.guardOutput('{}').out, '{}');
});

test('stopOutput: block and remind become continue; nothing and malformed stay silent', () => {
  assert.deepStrictEqual(JSON.parse(out.stopOutput(JSON.stringify({ decision: 'block', reason: 'run tests' }))), { decision: 'continue', reason: 'run tests' });
  assert.deepStrictEqual(JSON.parse(out.stopOutput(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'nudge' } }))), { decision: 'continue', reason: 'nudge' });
  for (const none of ['', '{}', '{broken', 'text', JSON.stringify({ decision: 'block' })]) assert.strictEqual(out.stopOutput(none), '', none);
});

test('sessionIdFrom keeps UUIDs and neutralises path characters', () => {
  assert.strictEqual(sessionIdFrom('7ff5435f-0965-424d-984d-5e1038c9e3de'), '7ff5435f-0965-424d-984d-5e1038c9e3de');
  assert.strictEqual(sessionIdFrom('../../etc/passwd'), '______etc_passwd');
  assert.strictEqual(sessionIdFrom(undefined), '');
  assert.strictEqual(sessionIdFrom('a'.repeat(200)).length, 64);
});

test('hooks.json: ported hooks, plugin-relative adapter path, flat vs grouped', () => {
  assert.deepStrictEqual(portedHooks, ['session-init', 'dev-rules-reminder', 'bash-safety-guard', 'verify-completion-guard']);
  const commands = [];
  const walk = (v) => { if (v && typeof v === 'object') { if (typeof v.command === 'string') commands.push(v.command); Object.values(v).forEach(walk); } };
  walk(hooksJson);
  assert.strictEqual(commands.length, portedHooks.length);
  for (const hook of portedHooks) assert.ok(commands.includes(`node ./hooks/antigravity-hook-adapter.cjs ${hook}`), hook);
  assert.ok(Array.isArray(hooksJson['rig-bash-safety-guard'].PreToolUse[0].hooks));
  assert.ok(hooksJson['rig-session-init'].SessionStart[0].command);
  assert.strictEqual(hooksJson['rig-bash-safety-guard'].PreToolUse[0].hooks[0].timeout, 5);
  assert.strictEqual(hooksJson['rig-verify-completion-guard'].Stop[0].timeout, 10);
});

test('resolveHookScript refuses names that leave the hooks dir', () => {
  const dir = path.join(os.tmpdir(), 'h');
  assert.strictEqual(resolveHookScript('session-init', dir), path.join(dir, 'session-init.cjs'));
  for (const bad of ['../x', 'a/b', '/etc/passwd']) assert.strictEqual(resolveHookScript(bad, dir), null, bad);
});

test('stop state: conversation window cap survives a changing turn id and expires', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-stop-'));
  try {
    const t0 = 1_000_000;
    for (let i = 0; i < stopState.MAX_PER_CONVERSATION_WINDOW; i += 1) assert.ok(stopState.bumpCount(dir, 'c1', `turn-${i}`, t0 + i));
    assert.strictEqual(stopState.recentContinuations(dir, 'c1', t0 + 10), stopState.MAX_PER_CONVERSATION_WINDOW);
    assert.strictEqual(stopState.readCount(dir, 'c1', 'turn-0'), 0, 'per-turn count follows the latest turn');
    assert.strictEqual(stopState.recentContinuations(dir, 'c2', t0 + 10), 0);
    assert.strictEqual(stopState.recentContinuations(dir, 'c1', t0 + stopState.WINDOW_MS + 10), 0, 'window expires');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop state: counts per turn, resets on a new turn, atomic file, unwritable dir reports false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-stop-'));
  try {
    assert.strictEqual(stopState.readCount(dir, 'c1', 't1'), 0);
    assert.ok(stopState.bumpCount(dir, 'c1', 't1'));
    assert.ok(stopState.bumpCount(dir, 'c1', 't1'));
    assert.strictEqual(stopState.readCount(dir, 'c1', 't1'), 2);
    assert.strictEqual(stopState.readCount(dir, 'c1', 't2'), 0);
    assert.strictEqual(stopState.readCount(dir, 'c2', 't1'), 0);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'state')), ['agy-stop-c1.json']);
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, '');
    assert.strictEqual(stopState.bumpCount(blocker, 'c1', 't1'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
