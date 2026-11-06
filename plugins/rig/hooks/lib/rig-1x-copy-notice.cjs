'use strict';
/**
 * One-line SessionStart notice for the plugin copy of session-init: Rig 1.x files are still installed (the global
 * `~/.claude/hooks/session-init.cjs`, or the project's `.claude/hooks/session-init.cjs`), so the user should run
 * `rig-init --migrate` in a terminal. Cheap on purpose (two stat calls); the full plan is `rig-init --plan`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SENTINEL = path.join('.claude', 'hooks', 'session-init.cjs');

/**
 * True when a `.claude` dir carries a Rig 1.x install marker: `metadata.json` named `rig` (v1.0.0 and v1.1.0 ship it) or
 * `hooks/lib/rig-config-utils.cjs` (Rig's own file; other kits with the same generic hook, agent and skill names do not
 * have it). File names alone (`hooks/session-init.cjs`) say nothing about whose install this is.
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

/** @returns {string[]} where a 1.x copy of the hook exists: 'global' and/or 'project' ('' when none) */
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

/** The notice text, or '' when no 1.x copy is found. */
function rig1xCopyNotice(opts) {
  const where = find1xCopies(opts);
  if (!where.length) return '';
  return `Rig 1.x files are still installed (${where.map((w) => (w === 'global' ? '~/.claude' : 'this project .claude')).join(' and ')}). ` +
    'Run `rig-init --migrate` in a terminal (preview with `rig-init --plan`) to move them to the plugin; the 1.x hooks and the plugin hooks do not run twice meanwhile.';
}

module.exports = { find1xCopies, rig1xCopyNotice, hasRig1xMarker };
