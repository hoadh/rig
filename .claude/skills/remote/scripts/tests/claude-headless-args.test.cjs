'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { ALWAYS_DISALLOWED } = require('../lib/allowed-tools-policy.cjs');
const C = require('../lib/claude-headless-args.cjs');

const spec = (resume) => ({
  maxTurns: 40,
  agent: { sessionId: '123e4567-e89b-12d3-a456-426614174000', resume, allowedTools: ['Edit', 'Bash(git status:*)'], disallowedTools: ['WebFetch'] },
});

t.test('fresh run uses --session-id, resume uses --resume', () => {
  const a = C.buildClaudeArgs(spec(false));
  t.eq(a.slice(0, 3), ['-p', '--session-id', '123e4567-e89b-12d3-a456-426614174000']);
  t.ok(C.buildClaudeArgs(spec(true)).includes('--resume'));
  t.ok(!C.buildClaudeArgs(spec(true)).includes('--session-id'));
});

t.test('optional agent.settings emits --settings before the variadic tool lists', () => {
  const sp = spec(false);
  t.ok(!C.buildClaudeArgs(sp).includes('--settings'));
  sp.agent.settings = '/home/w/rig-settings.json';
  const a = C.buildClaudeArgs(sp);
  t.eq(a[a.indexOf('--settings') + 1], '/home/w/rig-settings.json');
  t.ok(a.indexOf('--settings') < a.indexOf('--allowedTools'));
});

t.test('fixed flags: json output, acceptEdits, no prompts, max turns, tool lists', () => {
  const a = C.buildClaudeArgs(spec(false));
  const at = (flag) => a[a.indexOf(flag) + 1];
  t.eq(at('--output-format'), 'json');
  t.eq(at('--permission-mode'), 'acceptEdits');
  t.eq(at('--permission-prompts'), 'none');
  t.eq(at('--max-turns'), '40');
  t.eq(a.slice(a.indexOf('--allowedTools') + 1), ['Edit', 'Bash(git status:*)']);
  t.eq(a.slice(a.indexOf('--disallowedTools') + 1, a.indexOf('--allowedTools')), [...ALWAYS_DISALLOWED, 'WebFetch']); // worker re-adds the fixed denylist
  const empty = spec(false); empty.agent.disallowedTools = [];
  const b = C.buildClaudeArgs(empty);
  t.eq(b.slice(b.indexOf('--disallowedTools') + 1, b.indexOf('--allowedTools')), ALWAYS_DISALLOWED); // a spec cannot drop it
});

t.test('never builds bypass flags; prompt is not in argv', () => {
  const joined = C.buildClaudeArgs(spec(false)).join(' ');
  t.ok(!/bypassPermissions|dangerously-skip-permissions/.test(joined));
});

t.test('binary: registry path wins; PATH lookup; win32 needs .exe', () => {
  t.eq(C.resolveClaudeBinary({ claude: '/opt/claude' }, {}, 'linux'), '/opt/claude');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-claude-bin-'));
  try {
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n');
    t.eq(C.resolveClaudeBinary({}, { PATH: `/nonexistent:${dir}` }, 'linux'), path.join(dir, 'claude'));
    t.eq(C.resolveClaudeBinary({}, { Path: dir }, 'win32'), null); // no claude.exe, a bare "claude" does not count
    fs.writeFileSync(path.join(dir, 'claude.exe'), '');
    t.eq(C.resolveClaudeBinary({}, { Path: dir }, 'win32'), path.join(dir, 'claude.exe'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t.test('parseClaudeJson tolerates noise and empty output', () => {
  t.eq(C.parseClaudeJson('{"a":1}'), { a: 1 });
  t.eq(C.parseClaudeJson('warn\n{"a":1}\n'), { a: 1 });
  t.eq(C.parseClaudeJson(''), null);
  t.eq(C.parseClaudeJson('not json'), null);
});

t.test('classifyAgentOutcome: ok, auth, ratelimit, agent, timeout, cancelled', () => {
  const ok = { code: 0, json: { is_error: false, subtype: 'success' } };
  t.eq(C.classifyAgentOutcome(ok), null);
  t.eq(C.classifyAgentOutcome({ code: 1, stderr: 'Error: Not logged in. Please run /login' }), 'auth');
  t.eq(C.classifyAgentOutcome({ code: 1, json: { is_error: true, result: 'API Error: 401 authentication_error' } }), 'auth');
  t.eq(C.classifyAgentOutcome({ code: 1, stderr: '429 rate_limit_error: too many requests' }), 'ratelimit');
  t.eq(C.classifyAgentOutcome({ code: 1, stderr: 'boom' }), 'agent');
  t.eq(C.classifyAgentOutcome({ code: 0, json: { is_error: true, subtype: 'error_max_turns' } }), 'agent');
  t.eq(C.classifyAgentOutcome({ code: null, timedOut: true }), 'timeout');
  t.eq(C.classifyAgentOutcome({ code: null, cancelled: true, timedOut: true }), 'cancelled');
});

t.done();
