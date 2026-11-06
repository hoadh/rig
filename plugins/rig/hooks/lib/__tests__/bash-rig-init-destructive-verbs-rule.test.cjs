#!/usr/bin/env node
/** Tests for bash-rig-init-destructive-verbs-rule.cjs (run through the rule engine). */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const rule = require('../bash-rig-init-destructive-verbs-rule.cjs');
const { evaluateCommand } = require('../bash-safety-rule-engine.cjs');

const decision = (command) => {
  const r = evaluateCommand(command, { rules: [rule], cwd: process.cwd() }).result;
  return r ? r.decision : null;
};

describe('rig-init-destructive-verbs', () => {
  it('asks for every apply verb, however rig-init is reached', () => {
    for (const command of [
      'rig-init --migrate', 'rig-init --migrate --global', 'rig-init --migrate --project .', 'rig-init --resume', 'rig-init --restore /x/y',
      'rig-init --permissions', 'rig-init --runtime', 'rig-init --deps', 'rig-init --migrate --yes', 'rig-init -y',
      '/home/u/.claude/plugins/cache/rig/bin/rig-init --migrate', 'node /p/bin/rig-init --migrate', 'node /p/scripts/rig-init/cli.cjs --runtime',
      'sudo rig-init --migrate', 'cd /x && rig-init --restore b', 'bash -c "rig-init --migrate"', 'echo $(rig-init --migrate)',
      'node ~/.claude/rig-backups/global/261106-101010/restore.cjs',
    ]) assert.strictEqual(decision(command), 'ask', command);
  });

  it('allows the read-only plan and unrelated commands that only mention the words', () => {
    for (const command of ['rig-init --plan', 'rig-init --plan --json', 'rig-init --help', 'rig-init', 'echo rig-init --migrate-notes.txt', 'git commit -m "docs: rig-init"',
      'ls ~/.claude/rig-backups', 'cat restore.cjs', 'npm run migrate', 'some-tool --migrate']) {
      assert.strictEqual(decision(command), null, command);
    }
  });

  it('never denies and gives the reason a user can act on', () => {
    const r = evaluateCommand('rig-init --migrate', { rules: [rule], cwd: process.cwd() }).result;
    assert.strictEqual(r.ruleId, 'rig-init-destructive-verbs');
    assert.match(r.reason, /terminal/);
  });
});
