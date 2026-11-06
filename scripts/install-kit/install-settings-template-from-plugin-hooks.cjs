/**
 * Settings template for the file installer (`install-kit-from-local-repo.cjs`) until the plugin replaces it.
 *
 * Since Rig 2.0 the repo's `.claude/settings.json` holds Rig-development permissions only, the hooks
 * live in `plugins/rig/hooks/hooks.json` (exec form with ${CLAUDE_PLUGIN_ROOT}) and the shipped permissions
 * in `plugins/rig/file-install-settings-template.json`. A file install still
 * needs the 1.x shape: `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/<x>.cjs` entries plus the statusline.
 * This builds that settings object from the two sources so the installer output stays what 1.x users
 * already have registered (the merge then sees duplicates, not new hooks).
 */
const path = require('path');

const ROOT_VAR = '${CLAUDE_PLUGIN_ROOT}/';
// 1.x registered SubagentStart with an explicit "*"; keep it so merging deduplicates against existing installs.
const EXPLICIT_MATCHER = { SubagentStart: '*' };

function fileHookCommand(handler, event) {
  if (handler.type !== 'command' || handler.command !== 'node' || !Array.isArray(handler.args) || handler.args.length !== 1
    || typeof handler.args[0] !== 'string' || !handler.args[0].startsWith(ROOT_VAR)) {
    throw new Error(`hooks.json ${event}: only exec-form node handlers under ${ROOT_VAR} can be installed as files`);
  }
  const rel = handler.args[0].slice(ROOT_VAR.length);
  const out = { type: 'command', command: `node "$CLAUDE_PROJECT_DIR"/.claude/${rel}` };
  if (handler.timeout !== undefined) out.timeout = handler.timeout;
  return out;
}

/** hooks.json `hooks` object -> settings.json `hooks` object with file-install commands. */
function convertHooks(pluginHooks) {
  const out = {};
  for (const [event, entries] of Object.entries(pluginHooks)) {
    out[event] = entries.map((entry) => {
      const matcher = entry.matcher !== undefined ? entry.matcher : EXPLICIT_MATCHER[event];
      return { ...(matcher !== undefined ? { matcher } : {}), hooks: entry.hooks.map((h) => fileHookCommand(h, event)) };
    });
  }
  return out;
}

/**
 * @param {{ kitRoot: string, fs: typeof import('fs') }} args
 * @returns {string} settings.json content for the install (JSON text)
 */
function buildInstallSettingsTemplate({ kitRoot, fs }) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(kitRoot, rel), 'utf8'));
  // Permissions come from a shipped template, never from the repo's dev-only .claude/settings.json.
  const template = read('plugins/rig/file-install-settings-template.json');
  const pluginHooks = read('plugins/rig/hooks/hooks.json').hooks;
  const { $schema, attribution, permissions } = template;
  const settings = {
    ...($schema ? { $schema } : {}),
    ...(attribution ? { attribution } : {}),
    statusLine: { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/.claude/statusline.cjs', padding: 0 },
    hooks: convertHooks(pluginHooks),
    ...(permissions ? { permissions } : {}),
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

module.exports = { buildInstallSettingsTemplate, convertHooks };
