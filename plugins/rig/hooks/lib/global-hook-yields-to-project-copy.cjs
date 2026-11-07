/**
 * Stops a hook from running twice when Rig is installed both globally (or as a plugin) and in the project.
 *
 * Claude Code only dedupes identical handler commands, and the two installs register different
 * strings (`"$HOME/.claude/hooks/x.cjs"` vs `"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.cjs`), so both
 * copies run. The global copy calls `yieldsToProjectCopy(__filename, input)` after reading its input
 * and exits when the project registers its own copy of the same hook file for the same event and
 * matcher: the project copy handles that invocation.
 *
 * Hooks only one side registers keep running. Anything uncertain (no project dir, unreadable
 * settings, bad matcher regex, unknown event, handler `if` conditions, a project copy that resolves
 * to this same file) returns false: a duplicate run is better than a hook that runs nowhere.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Input field each event's matcher is tested against. Events not listed only yield to entries
// whose matcher matches everything.
const MATCHER_FIELD = {
  PreToolUse: 'tool_name',
  PostToolUse: 'tool_name',
  PostToolUseFailure: 'tool_name',
  PermissionRequest: 'tool_name',
  SessionStart: 'source',
  SessionEnd: 'reason',
  SubagentStart: 'agent_type',
  SubagentStop: 'agent_type',
  PreCompact: 'trigger',
  Notification: 'notification_type',
};

// Events whose hooks get no matcher (any matcher there is ignored by Claude Code).
const NO_MATCHER_EVENTS = new Set(['UserPromptSubmit', 'Stop']);

const IS_WIN = process.platform === 'win32';

function realpathOrNull(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Path comparison form: forward slashes, case-folded on Windows. */
function norm(p) {
  const s = p.replace(/\\/g, '/');
  return IS_WIN ? s.toLowerCase() : s;
}

function readSettings(file) {
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    return settings && typeof settings === 'object' ? settings : {};
  } catch {
    return {};
  }
}

function matchesAll(matcher) {
  return matcher === undefined || matcher === '' || matcher === '*';
}

/** Same rule as Claude Code: empty or `*` matches everything, otherwise an anchored regex. */
function matcherMatches(matcher, value) {
  if (matchesAll(matcher)) return true;
  if (typeof value !== 'string') return false;
  try {
    return new RegExp(`^(?:${matcher})$`).test(value);
  } catch {
    return false;
  }
}

/** True when `text` contains `target` delimited by whitespace or the string ends (a whole path token). */
function containsPathToken(text, target) {
  let at = text.indexOf(target);
  while (at !== -1) {
    const before = text[at - 1];
    const after = text[at + target.length];
    if ((before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after))) return true;
    at = text.indexOf(target, at + 1);
  }
  return false;
}

/**
 * True when `command` runs exactly `projectHook`: after expanding CLAUDE_PROJECT_DIR and dropping
 * quotes, the command must contain one of the project hook's absolute paths as a whole token.
 * `$HOME`/`~` forms and absolute paths to the global install never match.
 */
function runsProjectCopy(command, projectDirs, hookFile) {
  if (typeof command !== 'string') return false;
  const expanded = norm(command
    .replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR|%CLAUDE_PROJECT_DIR%/g, () => projectDirs[0])
    .replace(/"/g, ''));
  return projectDirs.some((dir) => containsPathToken(expanded, norm(path.join(dir, '.claude', 'hooks', hookFile))));
}

/** True when `command` runs `<home>/.claude/hooks/<hookFile>` (`$HOME`, `${HOME}`, `%USERPROFILE%`, leading `~` or absolute). */
function runsGlobalCopy(command, homeDirs, hookFile) {
  if (typeof command !== 'string') return false;
  const expanded = norm(command
    .replace(/\$\{HOME\}|\$HOME|%USERPROFILE%/g, () => homeDirs[0])
    .replace(/(^|[\s"])~(?=[\\/])/g, (_, lead) => `${lead}${homeDirs[0]}`)
    .replace(/"/g, ''));
  return homeDirs.some((dir) => containsPathToken(expanded, norm(path.join(dir, '.claude', 'hooks', hookFile))));
}

/** True when the hook file lives in the global 1.x install (~/.claude/hooks). */
function isGlobalCopy(self, home) {
  return norm(path.dirname(self)) === norm(path.join(home, '.claude', 'hooks'));
}

/**
 * True when the hook file lives in a Claude Code plugin: `<root>/hooks/<hook>.cjs` with
 * `<root>/.claude-plugin/plugin.json` next to it. A project that still carries a committed 1.x
 * `.claude/hooks/` copy registers the same hooks, so the plugin copy yields to it.
 */
function isPluginCopy(self) {
  const hooksDir = path.dirname(self);
  if (path.basename(hooksDir) !== 'hooks') return false;
  return fs.existsSync(path.join(path.dirname(hooksDir), '.claude-plugin', 'plugin.json'));
}

/** True when one of `settingsList` registers a handler for this event/value that `runs(command)` accepts. */
function registersHandler(settingsList, event, input, runs) {
  const field = MATCHER_FIELD[event];
  const value = field ? input[field] : undefined;
  const matches = (matcher) => (field ? matcherMatches(matcher, value) : NO_MATCHER_EVENTS.has(event) || matchesAll(matcher));
  return settingsList.some((settings) => {
    const entries = settings.hooks && settings.hooks[event];
    return Array.isArray(entries) && entries.some((entry) =>
      entry && Array.isArray(entry.hooks) && matches(entry.matcher) &&
      entry.hooks.some((h) => h && h.if === undefined && runs(h.command)));
  });
}

function loadSettings(dir) {
  return ['settings.json', 'settings.local.json'].map((name) => readSettings(path.join(dir, '.claude', name)));
}

/** The project registers its own copy of this hook for this invocation. */
function projectCopyHandles(self, home, input, event) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) return false;
  const project = realpathOrNull(projectDir);
  if (!project || norm(project) === norm(home)) return false;
  // The project copy must be a different file: a symlinked or global-pointing copy would make
  // both invocations yield and nothing would run.
  const hookFile = path.basename(self);
  const projectHook = realpathOrNull(path.join(project, '.claude', 'hooks', hookFile));
  if (!projectHook || norm(projectHook) === norm(self)) return false;
  const settingsList = loadSettings(project);
  if (settingsList.some((s) => s.disableAllHooks === true)) return false;
  const projectDirs = [...new Set([projectDir, project])];
  return registersHandler(settingsList, event, input, (command) => runsProjectCopy(command, projectDirs, hookFile));
}

/** The user's global 1.x install (~/.claude/settings*.json -> ~/.claude/hooks/<x>.cjs) handles this invocation. */
function globalCopyHandles(self, home, input, event) {
  const hookFile = path.basename(self);
  const globalHook = realpathOrNull(path.join(home, '.claude', 'hooks', hookFile));
  // A global file that is (a symlink to) this very file would make both sides yield.
  if (!globalHook || norm(globalHook) === norm(self)) return false;
  const settingsList = loadSettings(home);
  if (settingsList.some((s) => s.disableAllHooks === true)) return false;
  const homeDirs = [...new Set([os.homedir(), home])];
  return registersHandler(settingsList, event, input, (command) => runsGlobalCopy(command, homeDirs, hookFile));
}

/**
 * @param {string} hookPath __filename of the calling hook
 * @param {object} input parsed hook input (needs hook_event_name, plus the matcher field for that event)
 * @returns {boolean} true when this is the global or plugin copy and another copy handles this invocation:
 *   a project copy (global and plugin copies), or the global 1.x copy (plugin copy only)
 */
function yieldsToProjectCopy(hookPath, input) {
  return yieldTarget(hookPath, input) !== null;
}

/** @returns {'project'|'global'|null} which other copy handles this invocation, or null when this copy runs */
function yieldTarget(hookPath, input) {
  try {
    const event = input && input.hook_event_name;
    if (!event) return null;
    const home = realpathOrNull(os.homedir());
    const self = realpathOrNull(hookPath);
    if (!home || !self) return null;
    const plugin = isPluginCopy(self);
    if (!isGlobalCopy(self, home) && !plugin) return null;
    if (projectCopyHandles(self, home, input, event)) return 'project';
    return plugin && globalCopyHandles(self, home, input, event) ? 'global' : null;
  } catch {
    return null;
  }
}

module.exports = { yieldsToProjectCopy, matcherMatches, runsProjectCopy, runsGlobalCopy, isPluginCopy, yieldTarget };
