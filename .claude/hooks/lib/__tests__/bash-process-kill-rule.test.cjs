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

describe('ReDoS and length caps', () => {
  it('asks (never allows) for an unsafe -f pattern and returns fast', () => {
    const t0 = Date.now();
    const cmd = `pkill -f '(a+)+b' #${'a'.repeat(40)}`;
    assert.strictEqual(decision(cmd), 'ask');
    assert.strictEqual(decision(`true ${'a'.repeat(40)}; pkill -f '(a+)+b|vite'; npx vite &`), 'ask');
    assert.strictEqual(decision("pkill -f '((a+))+$'"), 'ask');
    assert.strictEqual(decision("pkill -f '(a|aa)+$'"), 'ask');
    assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
  });
  it('asks for a command longer than the matched-text cap', () => {
    assert.strictEqual(decision(`echo ${'x'.repeat(9000)}; pkill -f vite`), 'ask');
  });
});

describe('pgrep -f feeding kill', () => {
  it('denies pipelines into xargs kill, with or without -r / signal', () => {
    assert.strictEqual(decision('pgrep -f vite | xargs kill'), 'deny');
    assert.strictEqual(decision('pgrep -f vite | xargs -r kill -9'), 'deny');
    assert.strictEqual(decision('pgrep -af vite | awk \'{print $1}\' | xargs kill -TERM'), 'deny');
  });
  it('denies command substitution and backtick forms', () => {
    assert.strictEqual(decision('kill $(pgrep -f vite)'), 'deny');
    assert.strictEqual(decision('kill -9 $(pgrep -f vite)'), 'deny');
    assert.strictEqual(decision('kill `pgrep -f vite`'), 'deny');
  });
  it('allows the bracket form and pgrep -x', () => {
    assert.strictEqual(decision("pgrep -f '[v]ite' | xargs kill"), null);
    assert.strictEqual(decision("kill $(pgrep -f '[v]ite')"), null);
    assert.strictEqual(decision('pgrep -x vite | xargs kill'), null);
    assert.strictEqual(decision('kill $(pgrep -x vite)'), null);
    assert.strictEqual(decision('pgrep -f vite'), null);
  });
  it('asks for unsafe or non-literal pgrep patterns feeding kill', () => {
    assert.strictEqual(decision("pgrep -f '(a+)+b' | xargs kill"), 'ask');
    assert.strictEqual(decision('pgrep -f "$P" | xargs kill'), 'ask');
  });
});

describe('remedy text', () => {
  it('never suggests pgrep -f / pgrep -af', () => {
    for (const cmd of ['pkill -f vite', 'pkill node', 'pkill -u me', 'killall -u me', 'kill -9 -1', 'pgrep -f vite | xargs kill']) {
      const r = run(cmd);
      assert.ok(r, cmd);
      assert.doesNotMatch(`${r.reason} ${r.context || ''}`.replace(/^.*?(?=Use the bracket)/, ''), /pgrep -a?f/, cmd); // remedy part only
      assert.match(r.reason, /\[v\]ite/, cmd);
    }
  });
  it('kill -9 -1 is denied while a lone kill -1 is not', () => {
    assert.strictEqual(decision('kill -9 -1'), 'deny');
    assert.strictEqual(decision('kill -1'), null);
  });
});

describe('pgrep -f next to any kill (cycle 2, M-new-1)', () => {
  it('denies placeholder xargs, while-read loops, assignments and nested-paren patterns', () => {
    for (const cmd of [
      'pgrep -f vite | xargs -I{} kill {}',
      'pgrep -f vite | xargs -I % kill -9 %',
      'pgrep -f vite | while read p; do kill $p; done',
      'P=$(pgrep -f vite); kill $P',
      'kill $(pgrep -f "(vite)")',
      'P=`pgrep -f vite`; kill -9 $P',
    ]) assert.strictEqual(decision(cmd), 'deny', cmd);
  });
  it('still allows bracket form, pgrep -x and kill without a self-matching pgrep', () => {
    for (const cmd of [
      "pgrep -f '[v]ite' | xargs -I{} kill {}",
      "P=$(pgrep -f '[v]ite'); kill $P",
      'P=$(pgrep -x vite); kill $P',
      'pgrep -f vite',
      'kill 1234',
    ]) assert.strictEqual(decision(cmd), null, cmd);
  });
  it('asks when a nested-paren pgrep pattern is catastrophic', () => {
    assert.strictEqual(decision(`echo ${'a'.repeat(40)}; kill $(pgrep -f '(.*a){12}x')`), 'ask');
  });
});

describe('vm timeout is the real ReDoS bound (cycle 2, H-1)', () => {
  const { resetTimeoutLatch } = require('../regex-test-with-timeout.cjs');
  const payloads = [
    `true ${'a'.repeat(40)}\npkill -f '(.*a){12}x|vite'`,
    `true ${'a'.repeat(40)}\npkill -f '(?:.*?){20}x|vite'`,
    `true ${'a'.repeat(7000)}\npkill -f '.*.*Q|vite'`,
  ];
  for (const cmd of payloads) {
    it(`asks fast: ${cmd.split('\n')[1]}`, () => {
      resetTimeoutLatch();
      const t0 = Date.now();
      assert.strictEqual(decision(cmd), 'ask');
      assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
    });
  }
});
