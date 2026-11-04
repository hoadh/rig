#!/usr/bin/env node
/**
 * Tests for bash-process-kill-rule.cjs (run through the rule engine).
 * Run: node --test .claude/hooks/lib/__tests__/bash-process-kill-rule.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const rule = require('../bash-process-kill-rule.cjs');
const { evaluateCommand } = require('../bash-safety-rule-engine.cjs');

const run = (command) => evaluateCommand(command, { rules: [rule], cwd: process.cwd() }).result;
const decision = (command) => {
  const r = run(command);
  return r ? r.decision : null;
};

describe('pkill -f self-match', () => {
  it('denies a plain pattern found in the command line', () => {
    const r = run('pkill -f server.js');
    assert.strictEqual(r.decision, 'deny');
    assert.strictEqual(r.ruleId, 'process-kill');
    assert.match(r.reason, /\[v\]ite/);
    assert.ok(r.reason.length <= 300);
  });
  it('allows the bracket form alone', () => {
    assert.strictEqual(decision(`pkill -f '[s]erver.js'`), null);
  });
  it('denies the bracket form when the real name appears elsewhere in the command', () => {
    assert.strictEqual(decision(`pkill -f '[s]erver.js'; node server.js &`), 'deny');
  });
  it('handles clusters, --full, -i and long forms', () => {
    assert.strictEqual(decision('pkill -9f vite'), 'deny');
    assert.strictEqual(decision('pkill -fi VITE'), 'deny');
    assert.strictEqual(decision('pkill --full vite'), 'deny');
    assert.strictEqual(decision('pkill -KILL -f vite'), 'deny');
    assert.strictEqual(decision('pkill -9 -f vite'), 'deny');
  });
  it('strips execution prefixes', () => {
    assert.strictEqual(decision('timeout 5 pkill -f vite'), 'deny');
    assert.strictEqual(decision('sudo -E pkill -9 -f vite'), 'deny');
    assert.strictEqual(decision('xargs -r pkill -f vite'), 'deny');
    assert.strictEqual(decision(`bash -c 'pkill -f vite'`), 'deny');
    assert.strictEqual(decision('nohup pkill -f vite &'), 'deny');
  });
  it('asks for non-literal or uncompilable patterns', () => {
    assert.strictEqual(decision('pkill -f "$P"'), 'ask');
    assert.strictEqual(decision('pkill -f "(unclosed"'), 'ask');
  });
  it('gives ask a context with the remedy', () => {
    assert.match(run('pkill -f "$P"').context, /pgrep/);
  });
});

describe('broad scope', () => {
  it('denies user/group/parent filters and kill -1 / kill 0', () => {
    for (const cmd of ['pkill -u alex', 'pkill -U 1000 foo', 'pkill -g 5', 'pkill -P 1', 'pkill --euid alex x', 'pkill -9u alex',
      'killall -u alex', 'kill -9 -1', 'kill 0', 'kill -TERM 0', 'kill -- -1', 'kill -s KILL -1', 'kill -9 -1 ']) {
      assert.strictEqual(decision(cmd), 'deny', cmd);
    }
  });
  it('allows kill of specific pids and signal lists', () => {
    for (const cmd of ['kill 1234', 'kill -9 1234', 'kill -1234', 'kill -l', 'kill -HUP 42', 'kill -s TERM 99']) {
      assert.strictEqual(decision(cmd), null, cmd);
    }
  });
  it('does not read -HUP/-TERM as -U/-P filters', () => {
    assert.strictEqual(decision('pkill -HUP myworker'), null);
    assert.strictEqual(decision('pkill -TERM myworker'), null);
  });
});

describe('common names', () => {
  it('asks for pkill/killall of common names with remedy context', () => {
    for (const cmd of ['pkill node', 'killall claude', 'pkill -x python', 'killall Node', 'pkill -x ssh', 'killall git', 'pkill -9 bash']) {
      const r = run(cmd);
      assert.strictEqual(r && r.decision, 'ask', cmd);
      assert.ok(r.context, cmd);
    }
  });
  it('asks for killall -r', () => {
    assert.strictEqual(decision('killall -r "foo.*"'), 'ask');
  });
  it('allows uncommon names', () => {
    for (const cmd of ['killall Finder', 'pkill myworker', 'pkill -x nodemon', 'killall -9 vite', 'pkill ssh-agent']) {
      assert.strictEqual(decision(cmd), null, cmd);
    }
  });
  it('does not run on unrelated commands', () => {
    assert.strictEqual(decision('echo pkill -f vite'), null);
    assert.strictEqual(decision('pgrep -f vite'), null);
    assert.strictEqual(decision('pkill'), null);
  });
});
