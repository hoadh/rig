#!/usr/bin/env node
/** Tests for the 1.x owned-path list and the kit command form (rig-1x-owned-paths.cjs, settings-rig-entries-stripper.cjs). */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const owned = require('../rig-1x-owned-paths.cjs');
const { stripRigSettings } = require('../settings-rig-entries-stripper.cjs');
const { settingsFor, globalCmd, projectCmd, USER_HOOK_COMMAND } = require('./rig-init-fixtures.cjs');

const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..');
const GLOBAL = { kind: 'global', root: '/home/u' };
const PROJECT = { kind: 'project', root: '/work/app' };

describe('owned path list', () => {
  it('covers the 1.0 and 1.1 file layouts and the retired hooks, and never user config', () => {
    for (const rel of ['hooks/session-init.cjs', 'hooks/lib/hook-logger.cjs', 'statusline.cjs', 'metadata.json', 'skills/rig-plan/SKILL.md', 'skills/fix/SKILL.md',
      'agents/debugger.md', 'rules/core-rules.md', 'rules/development-rules.md', 'output-styles/coding-level-1-junior.md', 'hooks/scout-block.cjs', 'skills/install.sh']) {
      assert.ok(owned.isOwnedFile(rel), rel);
    }
    for (const rel of ['settings.json', 'settings.local.json', '.rig.json', '.env.example', '.gitignore', '.mcp.json.example', 'skills/.env', 'hooks/my-own-hook.sh', 'skills/my-skill/SKILL.md']) {
      assert.ok(!owned.isOwnedFile(rel), rel);
    }
    assert.ok(owned.OWNED_FILES.size > 600);
  });

  it('is the current union of the v1.0.0 and v1.1.0 tags (skipped when the tags are not in this clone)', (t) => {
    try {
      for (const tag of ['v1.0.0', 'v1.1.0']) execFileSync('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { cwd: REPO, stdio: 'ignore' });
    } catch { return t.skip('git tags v1.0.0 / v1.1.0 not available'); }
    execFileSync(process.execPath, [path.join(REPO, 'scripts', 'generate-rig-1x-owned-paths.cjs'), '--check'], { cwd: REPO, stdio: 'pipe' });
  });
});

describe('rigCommandRel (the full 1.x kit command form)', () => {
  it('matches the global forms only for the global target', () => {
    for (const cmd of ['node "$HOME/.claude/hooks/session-init.cjs"', 'node $HOME/.claude/hooks/session-init.cjs', 'node ~/.claude/hooks/session-init.cjs',
      'node "${HOME}/.claude/hooks/session-init.cjs"', 'node "%USERPROFILE%\\.claude\\hooks\\session-init.cjs"', 'node "/home/u/.claude/hooks/session-init.cjs"']) {
      assert.strictEqual(owned.rigCommandRel(cmd, GLOBAL), 'hooks/session-init.cjs', cmd);
      assert.strictEqual(owned.rigCommandRel(cmd, PROJECT), null, `project must not claim ${cmd}`);
    }
  });

  it('matches the project forms only for the project target', () => {
    for (const cmd of ['node "$CLAUDE_PROJECT_DIR"/.claude/hooks/session-init.cjs', 'node .claude/hooks/session-init.cjs', 'node ./.claude/hooks/session-init.cjs',
      'node "/work/app/.claude/hooks/session-init.cjs"', 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/session-init.cjs"']) {
      assert.strictEqual(owned.rigCommandRel(cmd, PROJECT), 'hooks/session-init.cjs', cmd);
      assert.strictEqual(owned.rigCommandRel(cmd, GLOBAL), null, `global must not claim ${cmd}`);
    }
  });

  it('never matches by basename, another project, a user hook or a non-owned file', () => {
    for (const cmd of ['node /opt/tools/session-init.cjs', 'node "/other/project/.claude/hooks/session-init.cjs"', 'node /home/u/.claude/hooks/my-own-hook.cjs',
      'python3 "$HOME/.claude/hooks/session-init.cjs"', 'node "$HOME/.claude/hooks/../../evil.cjs"', 'session-init.cjs', '', undefined]) {
      assert.strictEqual(owned.rigCommandRel(cmd, GLOBAL), null, String(cmd));
    }
  });
});

describe('stripRigSettings', () => {
  it('removes only Rig handlers and the Rig statusLine, keeps user hooks and keys, and records the removals', () => {
    const input = settingsFor(globalCmd);
    const { settings, removedHooks, removedStatusLine } = stripRigSettings(input, GLOBAL);
    assert.strictEqual(removedHooks.length, 6);
    assert.ok(removedStatusLine.command.includes('statusline.cjs'));
    assert.deepStrictEqual(settings.hooks, { SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: USER_HOOK_COMMAND }] }] });
    assert.strictEqual(settings.statusLine, undefined);
    assert.deepStrictEqual(settings.permissions, input.permissions);
    assert.strictEqual(settings.model, 'sonnet');
    assert.ok(input.hooks.Stop, 'input not mutated');
  });

  it('drops the hooks key when only Rig hooks were there, and leaves a foreign statusLine alone', () => {
    const { settings } = stripRigSettings({ statusLine: { type: 'command', command: 'node /me/line.js' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: globalCmd('hooks/verify-completion-guard.cjs') }] }] } }, GLOBAL);
    assert.strictEqual(settings.hooks, undefined);
    assert.strictEqual(settings.statusLine.command, 'node /me/line.js');
  });

  it('does not touch a project command form in global settings', () => {
    const { removedHooks } = stripRigSettings(settingsFor(projectCmd), GLOBAL);
    assert.strictEqual(removedHooks.length, 0);
  });
});
