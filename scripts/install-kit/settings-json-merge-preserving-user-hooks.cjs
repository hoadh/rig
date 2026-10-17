/**
 * Merges the kit's settings.json into an existing one:
 * - Existing user hooks are kept; kit hooks are added only when their command is not present yet
 *   (compared after path normalization, so `~/.claude/x` and `"$HOME/.claude/x"` count as the same).
 * - Kit hooks with a matcher the user already has are appended into that matcher entry.
 * - A kit hook that is already present gets the kit's run options (`async`, `asyncRewake`, `timeout`),
 *   so a re-install picks up changes such as a hook moving to `async`.
 * - Hooks the kit no longer ships are removed when registered with the kit's command form.
 * - permissions.ask / permissions.deny: kit rules are appended to the user's (deduped, user order
 *   first). Other permission keys (allow, defaultMode, ...) are never touched.
 * - Other top-level keys are added only when missing — user values always win.
 * - All `node .claude/...` commands (hooks + statusLine) are canonicalized for the install mode.
 * Limitation: no install tracking, so a kit hook the user deleted is added back on re-install.
 */
const { canonicalizeHookCommand } = require('./kit-path-rewrite-for-install-mode.cjs');
const { stripRetiredKitHooks } = require('./retired-kit-hooks-and-files-cleanup.cjs');

// Permission lists merged rule by rule; the rest of `permissions` belongs to the user
const MERGED_PERMISSION_LISTS = ['ask', 'deny'];

/** Comparison key: unquoted, every root form collapsed to `$ROOT`, whitespace squashed. */
function commandKey(command) {
  return String(command || '')
    .replace(/"/g, '')
    .replace(/(\$\{?HOME\}?|\$\{?CLAUDE_PROJECT_DIR\}?|%USERPROFILE%|%CLAUDE_PROJECT_DIR%|~)\//g, '$ROOT/')
    .replace(/(^|\s)(?:\.\/)?\.claude\//g, '$1$ROOT/.claude/')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Identity of one hook: normalized command, or the whole object for prompt/agent/http hooks. */
function hookKey(hook) {
  if (typeof hook === 'string') return commandKey(hook);
  return hook.command ? commandKey(hook.command) : JSON.stringify(hook);
}

function entryHooks(entry) {
  if (Array.isArray(entry.hooks)) return entry.hooks;
  return entry.command ? [entry.command] : [];
}

function assertHookShape(settings, label) {
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    const ok = Array.isArray(entries) && entries.every((e) => e && typeof e === 'object' && (!e.hooks || (Array.isArray(e.hooks) && e.hooks.every((h) => h && typeof h === 'object'))));
    if (!ok) throw new Error(`${label} settings.json: hooks.${event} must be an array of { matcher?, hooks: [...] } entries`);
  }
}

// Run options owned by the kit for its own hooks: copied when set, removed when the kit drops them.
const KIT_RUN_OPTIONS = ['async', 'asyncRewake', 'timeout'];

/** Copies the kit hook's run options onto the installed copy; returns true when anything changed. */
function syncRunOptions(kitHook, installedHook) {
  if (typeof kitHook !== 'object' || typeof installedHook !== 'object' || !kitHook.command) return false;
  let changed = false;
  for (const key of KIT_RUN_OPTIONS) {
    if (key in kitHook) {
      if (installedHook[key] !== kitHook[key]) {
        installedHook[key] = kitHook[key];
        changed = true;
      }
    } else if (key in installedHook) {
      delete installedHook[key];
      changed = true;
    }
  }
  return changed;
}

function mergeHookEvent(sourceEntries, destEntries, stats) {
  const merged = structuredClone(destEntries || []);
  const installed = new Map();
  for (const h of merged.flatMap(entryHooks)) if (!installed.has(hookKey(h))) installed.set(hookKey(h), h);
  const known = new Set(installed.keys());
  for (const entry of sourceEntries || []) {
    for (const h of entryHooks(entry)) {
      if (installed.has(hookKey(h)) && syncRunOptions(h, installed.get(hookKey(h)))) stats.optionsUpdated++;
    }
    const fresh = entryHooks(entry).filter((h) => !known.has(hookKey(h)));
    if (fresh.length === 0) {
      stats.duplicates += entryHooks(entry).length;
      continue;
    }
    const sameMatcher = entry.matcher !== undefined && merged.find((e) => e.matcher === entry.matcher && Array.isArray(e.hooks));
    if (sameMatcher && Array.isArray(entry.hooks)) {
      sameMatcher.hooks.push(...structuredClone(fresh));
    } else {
      merged.push(Array.isArray(entry.hooks) ? { ...structuredClone(entry), hooks: structuredClone(fresh) } : structuredClone(entry));
    }
    for (const h of fresh) known.add(hookKey(h));
    stats.added += fresh.length;
  }
  return merged;
}

/** Appends kit ask/deny rules the user does not have yet; returns how many were added. */
function mergePermissions(source, merged) {
  if (!source.permissions || typeof source.permissions !== 'object') return 0;
  if (!merged.permissions || typeof merged.permissions !== 'object') merged.permissions = {};
  let added = 0;
  for (const list of MERGED_PERMISSION_LISTS) {
    const kitRules = source.permissions[list];
    if (!Array.isArray(kitRules)) continue;
    const current = Array.isArray(merged.permissions[list]) ? merged.permissions[list] : [];
    const fresh = kitRules.filter((rule, i) => !current.includes(rule) && kitRules.indexOf(rule) === i);
    if (fresh.length || !Array.isArray(merged.permissions[list])) merged.permissions[list] = [...current, ...fresh];
    added += fresh.length;
  }
  return added;
}

/** Rewrites every hook + statusLine command in-place; returns how many changed. */
function canonicalizeAllCommands(settings, isGlobal) {
  let changed = 0;
  const fix = (holder) => {
    const next = canonicalizeHookCommand(holder.command, isGlobal);
    if (next !== holder.command) {
      holder.command = next;
      changed++;
    }
  };
  for (const entries of Object.values(settings.hooks || {})) {
    for (const entry of entries) {
      if (entry.command) fix(entry);
      for (const hook of entry.hooks || []) if (hook.command) fix(hook);
    }
  }
  if (settings.statusLine && settings.statusLine.command) fix(settings.statusLine);
  return changed;
}

/**
 * @param {object} source kit settings (already path-rewritten for the mode)
 * @param {object|null} dest existing settings, or null when the target has none
 * @returns {{ merged: object, stats: { added: number, duplicates: number, optionsUpdated: number, keysAdded: string[], canonicalized: number, retiredRemoved: string[], permissionRulesAdded: number } }}
 */
function mergeKitSettings(source, dest, isGlobal) {
  const stats = { added: 0, duplicates: 0, optionsUpdated: 0, keysAdded: [], canonicalized: 0, retiredRemoved: [], permissionRulesAdded: 0 };
  assertHookShape(source, 'Kit');
  if (dest) assertHookShape(dest, 'Existing');
  let merged;
  if (!dest) {
    merged = structuredClone(source);
  } else {
    merged = structuredClone(dest);
    stats.retiredRemoved = stripRetiredKitHooks(merged);
    stats.permissionRulesAdded = mergePermissions(source, merged);
    if (source.hooks) {
      merged.hooks = merged.hooks || {};
      for (const [event, entries] of Object.entries(source.hooks)) {
        merged.hooks[event] = mergeHookEvent(entries, merged.hooks[event], stats);
      }
    }
    for (const key of Object.keys(source)) {
      if (key !== 'hooks' && key !== 'permissions' && !(key in dest)) {
        merged[key] = structuredClone(source[key]);
        stats.keysAdded.push(key);
      }
    }
  }
  stats.canonicalized = canonicalizeAllCommands(merged, isGlobal);
  return { merged, stats };
}

module.exports = { mergeKitSettings, commandKey };
