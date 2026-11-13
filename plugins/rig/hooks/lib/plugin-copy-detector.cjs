'use strict';
/**
 * Where this hook runs from, and whether a Rig 1.x file install is still on disk.
 *
 * `isPluginCopy(self)`: the hook file sits in `<plugin>/hooks/` next to `.claude-plugin/plugin.json` (the Claude Code
 * plugin). The generated Antigravity copy has no `.claude-plugin`, so it is false there.
 *
 * `rig1xHooksNotice(opts)`: since 2.1.0 nothing yields to a 1.x copy any more, so when 1.x files are still installed
 * (`~/.claude/hooks/session-init.cjs` or the project's, beside a Rig 1.x marker) and registered, every Rig hook runs
 * twice. Session-init says so in one line. Cheap on purpose: a few stat calls, no settings parsing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SENTINEL = path.join('.claude', 'hooks', 'session-init.cjs');
const MIGRATION_DOC = 'https://github.com/hoadh/rig/blob/main/docs/how-to/migrate-from-rig-1x.md';

function isPluginCopy(self) {
  const hooksDir = path.dirname(self);
  if (path.basename(hooksDir) !== 'hooks') return false;
  return fs.existsSync(path.join(path.dirname(hooksDir), '.claude-plugin', 'plugin.json'));
}

/**
 * True when a `.claude` dir carries a Rig 1.x install marker: `metadata.json` named `rig` (v1.0.0 and v1.1.0 ship it) or
 * `hooks/lib/rig-config-utils.cjs` (Rig's own file; other kits with the same generic hook names do not have it).
 */
function hasRig1xMarker(claudeDir) {
  try {
    if (fs.existsSync(path.join(claudeDir, 'hooks', 'lib', 'rig-config-utils.cjs'))) return true;
    const meta = JSON.parse(fs.readFileSync(path.join(claudeDir, 'metadata.json'), 'utf8'));
    return Boolean(meta) && meta.name === 'rig';
  } catch {
    return false;
  }
}

function realpathOrNull(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/** @returns {string[]} where a 1.x copy of the hooks exists: 'global' and/or 'project' */
function find1xCopies({ self, projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd(), home = os.homedir() }) {
  const me = realpathOrNull(self);
  const homeReal = realpathOrNull(home);
  const found = [];
  const globalHook = realpathOrNull(path.join(home, SENTINEL));
  if (globalHook && globalHook !== me && hasRig1xMarker(path.join(home, '.claude'))) found.push('global');
  const project = realpathOrNull(projectDir);
  const projectHook = project && project !== homeReal ? realpathOrNull(path.join(project, SENTINEL)) : null;
  if (projectHook && projectHook !== me && hasRig1xMarker(path.join(project, '.claude'))) found.push('project');
  return found;
}

/** The one-line notice, or '' when no 1.x copy is found. */
function rig1xHooksNotice(opts) {
  const where = find1xCopies(opts);
  if (!where.length) return '';
  return `Rig 1.x files are still installed (${where.map((w) => (w === 'global' ? '~/.claude' : 'this project .claude')).join(' and ')}). ` +
    'Rig 2.1 does not support them: if their hooks are still registered, every Rig hook runs twice. ' +
    `Remove the 1.x hooks from settings.json, or migrate with Rig 2.0.10: ${MIGRATION_DOC}`;
}

module.exports = { isPluginCopy, hasRig1xMarker, find1xCopies, rig1xHooksNotice };
