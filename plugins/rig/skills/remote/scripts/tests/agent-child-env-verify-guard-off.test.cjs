'use strict';
/** rig:remote agent children must carry RIG_VERIFY_GUARD_MODE=off (no Stop-hook nudge turn for workers). */
const t = require('./minimal-test-harness.cjs');
const { buildAgentChildEnv } = require('../lib/agent-child-env.cjs');

t.test('agent child env pins RIG_VERIFY_GUARD_MODE=off, overriding the parent value', () => {
  t.eq(buildAgentChildEnv({ PATH: process.env.PATH || '/usr/bin' }, {}).RIG_VERIFY_GUARD_MODE, 'off');
  t.eq(buildAgentChildEnv({ PATH: process.env.PATH || '/usr/bin', RIG_VERIFY_GUARD_MODE: 'block' }, {}).RIG_VERIFY_GUARD_MODE, 'off');
});

t.test('the pin does not disturb the git hardening pins', () => {
  const env = buildAgentChildEnv({ PATH: process.env.PATH || '/usr/bin', GIT_ASKPASS: '/evil' }, {});
  t.ok(!('GIT_ASKPASS' in env));
  t.eq(env.GIT_CONFIG_NOSYSTEM, '1');
});

t.done();
