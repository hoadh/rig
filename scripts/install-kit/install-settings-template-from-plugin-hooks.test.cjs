#!/usr/bin/env node
/**
 * Tests for the file-install source mapping and settings template (plugins/rig -> .claude/).
 * Run: node --test scripts/install-kit/install-settings-template-from-plugin-hooks.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildInstallSettingsTemplate, convertHooks } = require('./install-settings-template-from-plugin-hooks.cjs');
const { installRelFor, buildCopyPlan } = require('./kit-source-file-list-and-copy-plan.cjs');

const KIT_ROOT = path.resolve(__dirname, '..', '..');
const cmd = (file) => `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}`;

describe('convertHooks', () => {
  it('turns exec-form plugin handlers into 1.x file-install commands, keeping matchers and timeouts', () => {
    const out = convertHooks({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/a.cjs'], timeout: 5 }] }],
      SubagentStart: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/b.cjs'] }] }],
    });
    assert.deepStrictEqual(out.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd('a.cjs'), timeout: 5 }] }]);
    assert.deepStrictEqual(out.SubagentStart, [{ matcher: '*', hooks: [{ type: 'command', command: cmd('b.cjs') }] }]);
  });

  it('refuses handlers that are not exec-form node under ${CLAUDE_PLUGIN_ROOT}', () => {
    for (const handler of [
      { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/a.cjs"' },
      { type: 'command', command: 'node', args: ['/abs/a.cjs'] },
      { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/a.cjs', 'extra'] },
    ]) assert.throws(() => convertHooks({ Stop: [{ hooks: [handler] }] }), /exec-form/);
  });
});

describe('buildInstallSettingsTemplate', () => {
  const settings = JSON.parse(buildInstallSettingsTemplate({ kitRoot: KIT_ROOT, fs }));

  it('registers every plugin hook as a file command and keeps the statusline and permissions', () => {
    const hooksJson = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'plugins/rig/hooks/hooks.json'), 'utf8')).hooks;
    assert.deepStrictEqual(Object.keys(settings.hooks).sort(), Object.keys(hooksJson).sort());
    const commands = Object.values(settings.hooks).flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));
    for (const file of ['session-init', 'subagent-init', 'team-context-inject', 'dev-rules-reminder', 'bash-safety-guard', 'verify-completion-guard']) {
      assert.ok(commands.includes(cmd(`${file}.cjs`)), file);
    }
    assert.strictEqual(settings.statusLine.command, 'node "$CLAUDE_PROJECT_DIR"/.claude/statusline.cjs');
    assert.ok(settings.permissions.ask.includes('Read(**/.env)'));
  });
});

describe('installRelFor', () => {
  it('maps plugin and repo .claude files to the installed .claude layout', () => {
    assert.strictEqual(installRelFor('plugins/rig/hooks/session-init.cjs', false), 'hooks/session-init.cjs');
    assert.strictEqual(installRelFor('plugins/rig/rules/core-rules.md', false), 'rules/core-rules.md');
    assert.strictEqual(installRelFor('plugins/rig/skills/plan/SKILL.md', true), 'skills/plan/SKILL.md');
    assert.strictEqual(installRelFor('.claude/.rig.json', false), '.rig.json');
    assert.strictEqual(installRelFor('CLAUDE.md', true), 'CLAUDE.md');
    assert.strictEqual(installRelFor('AGENTS.md', true), null);
  });
  it('leaves plugin-only files out', () => {
    assert.strictEqual(installRelFor('plugins/rig/.claude-plugin/plugin.json', false), null);
    assert.strictEqual(installRelFor('plugins/rig/hooks/hooks.json', false), null);
    assert.strictEqual(installRelFor('README.md', false), null);
  });
});

describe('buildCopyPlan on this repo', () => {
  it('plans one settings item with generated content and installs hooks under .claude/hooks', () => {
    const target = path.join(KIT_ROOT, '..', 'rig-install-target-never-written');
    const plan = buildCopyPlan({ kitRoot: KIT_ROOT, targetRoot: target, isGlobal: false, fs });
    const settings = plan.filter((i) => i.kind === 'settings');
    assert.strictEqual(settings.length, 1);
    assert.strictEqual(settings[0].dest, path.join(target, '.claude', 'settings.json'));
    assert.ok(settings[0].content.includes('session-init.cjs'));
    assert.ok(plan.some((i) => i.dest === path.join(target, '.claude', 'hooks', 'session-init.cjs')));
    assert.ok(plan.some((i) => i.dest === path.join(target, '.claude', 'rules', 'core-rules.md')));
    assert.ok(!plan.some((i) => /hooks\.json$|\.claude-plugin/.test(i.dest)), 'plugin-only files are not installed');
  });
});

describe('permissions template', () => {
  it('matches the permissions of the repo dev settings (one list, two homes)', () => {
    const template = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'plugins/rig/file-install-settings-template.json'), 'utf8'));
    const dev = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, '.claude/settings.json'), 'utf8'));
    assert.deepStrictEqual(dev.permissions, template.permissions);
  });
});
