'use strict';
/**
 * `rig-init --permissions` and `rig-init --runtime`: the two things a plugin cannot ship, written into the user's
 * `~/.claude/settings.json`.
 *   permissions: merges permissions-template.json (ask/deny rules for secrets and build dirs); rules already present
 *     are not repeated, nothing is removed, other permission keys (allow, defaultMode) are never touched.
 *   runtime: copies the runtime files (statusline, remote worker) to ~/.claude/rig/runtime (same staged swap and no
 *     downgrade as the plugin's session-init) and points `statusLine` at that copy, unless the user already uses a
 *     statusLine that is not Rig's.
 * Both save a copy of settings.json under ~/.claude/rig-backups/user-settings/<ts>/ before writing it atomically.
 */
const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonAtomic, backupsDirFor } = require('./backup-restore-standalone.cjs');
const { createBackupDir, privateDir } = require('./migration-journal-applier.cjs');
const { copyRuntime, readRuntimeVersion, runtimeDirFor } = require('../../hooks/lib/runtime-copy-to-user-dir.cjs');
const { rigCommandRel } = require('./rig-1x-owned-paths.cjs');

const TEMPLATE_FILE = path.join(__dirname, 'permissions-template.json');
const RUNTIME_STATUSLINE_COMMAND = 'node "$HOME/.claude/rig/runtime/statusline.cjs"';
const RUNTIME_STATUSLINE_RE = /rig[/\\]runtime[/\\]statusline\.cjs/;
const LISTS = ['ask', 'deny'];

const userSettingsFile = (home) => path.join(home, '.claude', 'settings.json');

function loadTemplate() {
  const { permissions } = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
  for (const list of LISTS) {
    if (!Array.isArray(permissions[list]) || !permissions[list].every((r) => typeof r === 'string')) throw new Error(`permissions-template.json: permissions.${list} must be a string array`);
  }
  return permissions;
}

/** Rules of the template that `settings` does not have yet, per list. */
function missingRules(settings) {
  const template = loadTemplate();
  const current = (settings && settings.permissions) || {};
  const missing = {};
  for (const list of LISTS) {
    if (current[list] !== undefined && !Array.isArray(current[list])) throw new Error(`permissions.${list} in ${'settings.json'} is not an array; fix it first, rig-init will not replace your value`);
    const have = new Set(Array.isArray(current[list]) ? current[list] : []);
    missing[list] = template[list].filter((rule) => !have.has(rule));
  }
  return missing;
}

function planPermissions({ home }) {
  const read = readJsonFile(userSettingsFile(home));
  const missing = missingRules(read.value);
  return { file: userSettingsFile(home), missing, needed: missing.ask.length + missing.deny.length };
}

/** Copy the current user settings into rig-backups/user-settings/<ts>/; null when there is no file yet. */
function backupUserSettings({ home, now }) {
  const file = userSettingsFile(home);
  if (!fs.existsSync(file)) return null;
  privateDir(backupsDirFor(home));
  const dir = createBackupDir(path.join(backupsDirFor(home), 'user-settings'), now);
  fs.copyFileSync(file, path.join(dir, 'settings.json'));
  return dir;
}

function applyPermissions({ home, now = new Date() }) {
  const file = userSettingsFile(home);
  const read = readJsonFile(file);
  const missing = missingRules(read.value);
  const added = missing.ask.length + missing.deny.length;
  if (added === 0) return { added: 0, backup: null, file };
  const backup = backupUserSettings({ home, now });
  const settings = read.value || {};
  settings.permissions = settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {};
  for (const list of LISTS) {
    if (!missing[list].length) continue;
    settings.permissions[list] = [...(Array.isArray(settings.permissions[list]) ? settings.permissions[list] : []), ...missing[list]];
  }
  writeJsonAtomic(file, settings);
  return { added, backup, file };
}

/** 'none' | 'rig' (runtime copy or a 1.x Rig command: ours to point at the runtime) | 'other' (the user's own). */
function statusLineOwner(settings, home) {
  const sl = settings && settings.statusLine;
  if (!sl) return 'none';
  const command = typeof sl === 'object' ? sl.command : null;
  if (typeof command === 'string' && (RUNTIME_STATUSLINE_RE.test(command) || rigCommandRel(command, { kind: 'global', root: home }) === 'statusline.cjs')) return 'rig';
  return 'other';
}

function planRuntime({ home, pluginRoot }) {
  const read = readJsonFile(userSettingsFile(home));
  const owner = statusLineOwner(read.value, home);
  return {
    runtimeDir: runtimeDirFor(home),
    installedVersion: readRuntimeVersion(runtimeDirFor(home)),
    statusLine: owner,
    willSetStatusLine: owner !== 'other',
    pluginRoot,
  };
}

function applyRuntime({ home, pluginRoot, now = new Date(), copy = copyRuntime }) {
  const file = userSettingsFile(home);
  const read = readJsonFile(file);
  const owner = statusLineOwner(read.value, home);
  const runtime = copy({ pluginRoot, home });
  let statusLine = 'kept';
  let backup = null;
  if (owner === 'other') {
    statusLine = 'user-statusline-kept';
  } else if (!(read.value && read.value.statusLine && read.value.statusLine.command === RUNTIME_STATUSLINE_COMMAND)) {
    backup = backupUserSettings({ home, now });
    const settings = read.value || {};
    settings.statusLine = { type: 'command', command: RUNTIME_STATUSLINE_COMMAND, padding: 0 };
    writeJsonAtomic(file, settings);
    statusLine = 'set';
  }
  return { runtime, statusLine, backup, file };
}

module.exports = { planPermissions, applyPermissions, planRuntime, applyRuntime, missingRules, statusLineOwner, RUNTIME_STATUSLINE_COMMAND };
