'use strict';
const t = require('./minimal-test-harness.cjs');
const P = require('../lib/allowed-tools-policy.cjs');
const { validateSpec } = require('../lib/run-spec-validator.cjs');

t.test('baseline entries are all safe; always-disallowed git push/config/remote', () => {
  P.BASELINE.forEach((e) => t.eq(P.toolProblem(e), null, e));
  t.eq(P.ALWAYS_DISALLOWED, ['Bash(git push:*)', 'Bash(git config:*)', 'Bash(git remote:*)', 'Bash(git * --output*)']);
});

t.test('rejects bare/wildcard Bash, interpreters, network tools, git push|config|remote, other tools', () => {
  const bad = ['Bash', 'Bash(*)', 'Bash(:*)', 'Bash( *)', 'Bash(git:*)', 'Bash(node:*)', 'Bash(python3 -c x:*)', 'Bash(sh:*)', 'Bash(/bin/bash -c:*)',
    'Bash(curl http://x:*)', 'Bash(ssh h:*)', 'Bash(git push:*)', 'Bash(git config:*)', 'Bash(git remote add:*)', 'Bash(npm test; rm -rf /:*)',
    'WebFetch', 'Task', 'Read(/etc/passwd)', 'Bash(git -c x=y status:*)', 'Bash(cmd.exe /c:*)', 'Bash(powershell:*)'];
  bad.forEach((e) => t.ok(P.toolProblem(e), `should reject ${e}`));
  ['Bash(cargo test:*)', 'Bash(npm test:*)', 'Bash(npm test)'].forEach((e) => t.eq(P.toolProblem(e), null, e));
});

t.test('tokenizer keeps whitespace inside parentheses', () => {
  t.eq(P.tokenizeTools('Read Bash(git add:*)  Edit'), ['Read', 'Bash(git add:*)', 'Edit']);
});

t.test('resolve: default = baseline + registry; --allowed-tools only narrows', () => {
  t.eq(P.resolveAllowedTools(null, ['Bash(npm test:*)']), [...P.BASELINE, 'Bash(npm test:*)']);
  t.eq(P.resolveAllowedTools('Read Bash(npm test:*)', ['Bash(npm test:*)']), ['Read', 'Bash(npm test:*)']);
  t.throwsRemote(() => P.resolveAllowedTools('Read Bash(npm test:*)', []), { exitCode: 2 }); // widening
  t.throwsRemote(() => P.resolveAllowedTools('Bash(node:*)', []), { exitCode: 2 });
  t.throwsRemote(() => P.resolveAllowedTools('', []), { exitCode: 2 });
  t.throwsRemote(() => P.resolveAllowedTools(null, ['Bash(node:*)']), { exitCode: 2 }); // unsafe registry entry
});

t.test('worker-side: run-spec-validator rejects Bash, Bash(node:*), Bash(git push:*) even if orchestrator bypassed', () => {
  const SHA = 'a'.repeat(40);
  const spec = (tools) => ({
    v: 1, runId: 'r260101010101-abc123', orchestrator: 'mac', slug: 'my-plan', phase: '03', kind: 'agent', baseSha: SHA, startSha: SHA,
    branch: 'rig/waso/my-plan', owns: ['src/**'], timeoutSec: 600, maxTurns: 50,
    agent: { sessionId: '123e4567-e89b-12d3-a456-426614174000', resume: false, allowedTools: tools, disallowedTools: [] },
  });
  validateSpec(spec(P.BASELINE), { self: 'waso' });
  validateSpec(spec(['Read', 'Bash(npm test:*)']), { self: 'waso', registryTools: ['Bash(npm test:*)'] });
  for (const bad of ['Bash', 'Bash(node:*)', 'Bash(git push:*)']) {
    t.throwsRemote(() => validateSpec(spec(['Read', bad]), { self: 'waso', registryTools: [] }), { exitCode: 2 });
  }
  t.throwsRemote(() => validateSpec(spec(['Bash(npm test:*)']), { self: 'waso', registryTools: [] }), { exitCode: 2 }); // not in registry
});

t.done();
