#!/usr/bin/env node
/**
 * hooks/hooks.json is what the plugin registers: every command must be the exec form
 * (`node` + one `${CLAUDE_PLUGIN_ROOT}/hooks/<file>.cjs` argument), point at a file that exists,
 * and use only known events. A renamed or deleted hook would otherwise fail silently at runtime.
 * Run: node --test plugins/rig/hooks/__tests__/hooks-json-targets-exist.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const hooksJson = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
const EVENTS = ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'];
const ROOT_VAR = '${CLAUDE_PLUGIN_ROOT}/';

/** Flattens hooks.json to { event, matcher, handler } rows. */
function handlers() {
  const rows = [];
  for (const [event, entries] of Object.entries(hooksJson.hooks)) {
    for (const entry of entries) for (const handler of entry.hooks) rows.push({ event, matcher: entry.matcher, handler });
  }
  return rows;
}

describe('hooks.json', () => {
  it('registers exactly the events Rig uses', () => {
    assert.deepStrictEqual(Object.keys(hooksJson.hooks).sort(), [...EVENTS].sort());
  });

  it('uses the exec form: command "node" and one ${CLAUDE_PLUGIN_ROOT}/hooks/*.cjs argument', () => {
    for (const { event, handler } of handlers()) {
      assert.strictEqual(handler.type, 'command', `${event}: type`);
      assert.strictEqual(handler.command, 'node', `${event}: command must be bare node (no shell string)`);
      assert.ok(Array.isArray(handler.args) && handler.args.length === 1, `${event}: exactly one arg`);
      assert.ok(handler.args[0].startsWith(`${ROOT_VAR}hooks/`) && handler.args[0].endsWith('.cjs'), `${event}: ${handler.args[0]}`);
    }
  });

  it('every target file exists', () => {
    const rows = handlers();
    assert.ok(rows.length >= 6, 'finds the registered handlers');
    for (const { event, handler } of rows) {
      const file = path.join(PLUGIN_ROOT, handler.args[0].slice(ROOT_VAR.length));
      assert.ok(fs.existsSync(file), `${event}: missing ${handler.args[0]}`);
    }
  });

  it('SubagentStart has no bare-name matcher (plugin agent types are prefixed: rig:tester)', () => {
    for (const { event, matcher } of handlers()) {
      if (event !== 'SubagentStart' || matcher === undefined || matcher === '' || matcher === '*') continue;
      assert.ok(/^rig:/.test(matcher) || matcher.includes('rig:'), `SubagentStart matcher "${matcher}" must be empty or rig: prefixed`);
    }
  });

  it('every hook file in hooks/ that is registered is a .cjs entry point; no unregistered entry point', () => {
    const registered = new Set(handlers().map(({ handler }) => path.basename(handler.args[0])));
    const entryPoints = fs.readdirSync(path.join(PLUGIN_ROOT, 'hooks')).filter((f) => f.endsWith('.cjs'));
    assert.deepStrictEqual(entryPoints.sort(), [...registered].sort(), 'hooks/*.cjs and hooks.json must list the same files');
  });
});
