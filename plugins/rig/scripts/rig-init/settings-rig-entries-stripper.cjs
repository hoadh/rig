'use strict';
/**
 * Removes the 1.x Rig registrations from a settings object and records exactly what was removed (the journal keeps
 * it, so a restore can put back those entries and nothing else). Only handlers whose command is the full 1.x kit
 * form for this target are removed (see rigCommandRel); user hooks, other keys and permissions are never touched.
 */
const { rigCommandRel } = require('./rig-1x-owned-paths.cjs');

/**
 * @param {object} settings parsed settings.json (not modified)
 * @param {{kind: 'global'|'project', root: string}} target
 * @returns {{settings: object, removedHooks: Array<{event: string, entry: object, handler: object, rel: string}>, removedStatusLine: object|null}}
 */
function stripRigSettings(settings, target) {
  const next = structuredClone(settings);
  const removedHooks = [];
  if (next.hooks && typeof next.hooks === 'object') {
    for (const [event, entries] of Object.entries(next.hooks)) {
      if (!Array.isArray(entries)) continue;
      const kept = [];
      for (const entry of entries) {
        if (!entry || !Array.isArray(entry.hooks)) { kept.push(entry); continue; }
        const { hooks: handlers, ...entryRest } = entry;
        const left = handlers.filter((h) => {
          const rel = h && rigCommandRel(h.command, target);
          if (!rel) return true;
          removedHooks.push({ event, entry: entryRest, handler: h, rel });
          return false;
        });
        // An entry that only held Rig handlers goes away; a mixed one keeps the user's handlers
        if (left.length === 0 && handlers.length > 0) continue;
        kept.push({ ...entryRest, hooks: left });
      }
      if (kept.length === 0) delete next.hooks[event];
      else next.hooks[event] = kept;
    }
    if (Object.keys(next.hooks).length === 0 && removedHooks.length > 0) delete next.hooks;
  }
  let removedStatusLine = null;
  if (next.statusLine && typeof next.statusLine === 'object' && rigCommandRel(next.statusLine.command, target) === 'statusline.cjs') {
    removedStatusLine = next.statusLine;
    delete next.statusLine;
  }
  return { settings: next, removedHooks, removedStatusLine };
}

module.exports = { stripRigSettings };
