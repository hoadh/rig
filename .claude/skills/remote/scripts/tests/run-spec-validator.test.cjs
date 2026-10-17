'use strict';
const t = require('./minimal-test-harness.cjs');
const { validateSpec, specHash } = require('../lib/run-spec-validator.cjs');

const SHA = 'a'.repeat(40);
const agentSpec = (over = {}) => ({
  v: 1, runId: 'r260101010101-abc123', orchestrator: 'mac', slug: 'my-plan', phase: '03', kind: 'agent',
  baseSha: SHA, startSha: SHA, branch: 'rig/waso/my-plan', owns: ['src/**'], timeoutSec: 600, maxTurns: 50,
  agent: { sessionId: '123e4567-e89b-12d3-a456-426614174000', resume: false, allowedTools: ['Edit', 'Bash(git status:*)'], disallowedTools: [] },
  ...over,
});
const cmdSpec = (over = {}) => ({
  v: 1, runId: 'r260101010101-abc123', orchestrator: 'mac', slug: null, phase: null, kind: 'command', ref: SHA, command: 'npm test', timeoutSec: 60, ...over,
});
const bad = (spec) => t.throwsRemote(() => validateSpec(spec, { self: 'waso' }), { exitCode: 2 });

t.test('valid agent + command specs pass', () => {
  validateSpec(agentSpec(), { self: 'waso' });
  validateSpec(cmdSpec(), { self: 'waso' });
});

t.test('agent.settings: absolute path ok, relative/metachar rejected', () => {
  const withSettings = (v) => agentSpec({ agent: { ...agentSpec().agent, settings: v } });
  validateSpec(withSettings('/home/w/rig-settings.json'), { self: 'waso' });
  validateSpec(withSettings('C:\\Users\\w\\rig-settings.json'), { self: 'waso' });
  bad(withSettings('rig-settings.json'));
  bad(withSettings('/tmp/a;rm -rf x'));
  bad(withSettings('/tmp/../etc/x'));
});

t.test('branch must equal rig/<self>/<slug>', () => {
  bad(agentSpec({ branch: 'rig/mac/my-plan' }));
  bad(agentSpec({ branch: 'main' }));
});

t.test('ids and shas validated', () => {
  bad(agentSpec({ runId: 'x' }));
  bad(agentSpec({ orchestrator: 'Mac!' }));
  bad(agentSpec({ baseSha: 'abc' }));
  bad(agentSpec({ startSha: 'HEAD' }));
  bad(agentSpec({ slug: '../x' }));
  bad(agentSpec({ phase: '3' }));
  bad(cmdSpec({ ref: 'main' }));
});

t.test('unknown keys rejected (nonce, permissionMode, extra agent keys)', () => {
  bad(agentSpec({ nonce: 'a'.repeat(32) }));
  bad(agentSpec({ permissionMode: 'bypassPermissions' }));
  const a = agentSpec(); a.agent.permissionMode = 'bypassPermissions';
  bad(a);
});

t.test('agent needs non-empty allowedTools, uuid session, boolean resume, sane owns', () => {
  const a = agentSpec(); a.agent.allowedTools = [];
  bad(a);
  const b = agentSpec(); b.agent.sessionId = 'nope';
  bad(b);
  const c = agentSpec(); c.agent.resume = 'yes';
  bad(c);
  bad(agentSpec({ owns: [] }));
  bad(agentSpec({ owns: ['../x'] }));
  bad(agentSpec({ owns: ['/abs/**'] }));
});

t.test('numeric bounds and kind-specific keys', () => {
  bad(agentSpec({ timeoutSec: 0 }));
  bad(agentSpec({ maxTurns: 5000 }));
  bad(agentSpec({ timeoutSec: 1.5 }));
  bad(cmdSpec({ command: '  ' }));
  bad(cmdSpec({ owns: ['x'] }));
  bad(agentSpec({ command: 'rm -rf /' }));
  bad(agentSpec({ kind: 'other' }));
  bad(null);
});

t.test('specHash is stable across key order and differs on change', () => {
  const a = agentSpec();
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse())));
  t.eq(specHash(a), specHash(reordered));
  t.ok(specHash(a) !== specHash(agentSpec({ maxTurns: 51 })));
});

t.done();
