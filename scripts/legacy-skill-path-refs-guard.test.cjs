#!/usr/bin/env node
/**
 * Guard: text and code under plugins/rig/ must not point at the 1.x file-install layout
 * (`.claude/{skills,scripts,hooks,agents,statusline,rules}`, with or without `$HOME/` or `~/`, or the old
 * `skills/rig-plan|rig-debug` dirs). In a plugin those paths do not exist; scripts are called by `bin/` name
 * (`rig-<x>`), and the installer rewrites that name to `node .claude/bin/rig-<x>` for file installs.
 *
 * Exactly two kinds of mention stay, both real user/project paths:
 *   1. ENV_FILE_PATH: `.claude/skills/.env` and `.claude/skills/<skill>/.env`, the API-key files users create
 *      (project or ~/.claude). Any number, matched by pattern.
 *   2. ALLOWED_FILES: files that talk about where users or earlier installs keep things, with an exact count.
 *      A count that no longer matches fails, so the list cannot rot.
 * Run: node scripts/legacy-skill-path-refs-guard.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOT = path.join(ROOT, 'plugins', 'rig');
const SKIP_DIRS = new Set(['node_modules', '.venv', '__pycache__', '.logs', '__tests__', 'tests', 'fixtures']);
const SKIP_FILES = /\.(test\.cjs|test\.js|test\.ts|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|pdf|zip|csv)$/i;
const PATTERN = /\.claude[\\/](?:skills|scripts|hooks|agents|statusline|rules)|skills\/rig-(?:plan|debug)\b/g;
const ENV_FILE_PATH = /\.claude[\\/]skills[\\/](?:[^\s/`'")]+[\\/])?\.env\b/g;

const ALLOWED_FILES = {
  'plugins/rig/hooks/lib/global-hook-yields-to-project-copy.cjs': { count: 6, reason: 'detects the 1.x file install by the real hook path in project and ~/.claude settings' },
  'plugins/rig/hooks/lib/rig-1x-copy-notice.cjs': { count: 2, reason: 'detects the 1.x file install by its real hook path (migration notice)' },
  'plugins/rig/scripts/rig-init/rig-1x-owned-paths.json': { count: 28, reason: 'the 28 `skills/rig-plan` and `skills/rig-debug` paths (1.1 skill dirs) the migrator moves' },
  'plugins/rig/skills/create-skill/SKILL.md': { count: 2, reason: 'where a user creates their own project or user skills' },
  'plugins/rig/skills/create-skill/references/distribution-guide.md': { count: 1, reason: 'where a user places their own skills' },
  'plugins/rig/skills/create-skill/references/skill-anatomy-and-requirements.md': { count: 1, reason: 'layout of a user skills dir' },
  'plugins/rig/skills/create-skill/references/structure-organization-criteria.md': { count: 1, reason: 'layout of a user skills dir' },
  'plugins/rig/skills/remote/references/worker-hooks-and-settings.md': { count: 1, reason: "the worker clone's own project .claude/hooks apply to headless runs" },
};

function scan(dir, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) scan(full, out);
    } else if (!SKIP_FILES.test(entry.name)) {
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue;
      const count = (buf.toString('utf8').replace(ENV_FILE_PATH, '').match(PATTERN) || []).length;
      if (count > 0) out[path.relative(ROOT, full).split(path.sep).join('/')] = count;
    }
  }
  return out;
}

describe('no legacy 1.x kit paths in plugins/rig', () => {
  const found = scan(SCAN_ROOT);

  it('scans the plugin (guards against a wrong root making the check vacuous)', () => {
    assert.ok(fs.existsSync(path.join(SCAN_ROOT, '.claude-plugin', 'plugin.json')), 'plugin root exists');
    assert.ok(fs.readdirSync(path.join(SCAN_ROOT, 'skills')).length > 20, 'skills dir is populated');
  });

  it('the pattern covers every dead 1.x form, including $HOME and ~ prefixes, and the env-file allowlist stays narrow', () => {
    for (const text of ['node .claude/scripts/set-active-plan.cjs', '$HOME/.claude/skills/x/SKILL.md', '~/.claude/hooks/a.cjs',
      '.claude/agents/planner.md', 'node .claude/statusline.cjs', '.claude/rules/core-rules.md', 'skills/rig-plan/references/a.md']) {
      assert.ok(text.match(PATTERN), text);
    }
    for (const text of ['.claude/settings.json', '~/.claude/teams/x', '.claude/.rig.json', 'skills/rig-planner/x']) {
      assert.ok(!text.match(PATTERN), text);
    }
    for (const env of ['.claude/skills/.env', '~/.claude/skills/media/.env', '$HOME/.claude/skills/${SKILL}/.env', '.claude\\skills\\.env', './.claude/skills/my-skill/.env']) {
      assert.ok(!env.replace(ENV_FILE_PATH, '').match(PATTERN), env);
    }
    for (const notEnv of ['.claude/skills/media/scripts/x.py', '.claude/skills/.envrc', '.claude/skills/x/.venv/bin']) {
      assert.ok(notEnv.replace(ENV_FILE_PATH, '').match(PATTERN), notEnv);
    }
  });

  it('only allowlisted files keep a legacy mention, with exactly the allowed count', () => {
    const unexpected = Object.entries(found)
      .filter(([file, n]) => n !== (ALLOWED_FILES[file] ? ALLOWED_FILES[file].count : 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${ALLOWED_FILES[file] ? ALLOWED_FILES[file].count : 0})`);
    assert.deepStrictEqual(unexpected, [], `legacy path references; call the bin name (rig-<x>) or use \${CLAUDE_SKILL_DIR}/relative paths instead:\n${unexpected.join('\n')}`);
  });

  it('every allowlist entry still exists and still has its mention (no stale entries)', () => {
    const stale = Object.keys(ALLOWED_FILES).filter((file) => !found[file]);
    assert.deepStrictEqual(stale, [], `remove from ALLOWED_FILES: ${stale.join(', ')}`);
  });
});
