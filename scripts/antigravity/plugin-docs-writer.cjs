/** Text of the two hand-assembled files of the Antigravity plugin: rules/AGENTS.md and README.md. Pure. */

const REPO = 'https://github.com/hoadh/rig';

/** Demote markdown headings by one level (`##` -> `###`) outside code fences, so a file can nest under a heading. */
function demoteHeadings(text) {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
  }).join('\n');
}

const stripTitle = (text) => text.replace(/^# .*\n+/, '').trim();

const ROOT_NOTE = [
  '## Rig root',
  '',
  'The session start context prints `Rig root: <absolute path>`: the directory of this plugin. Wherever a skill, agent or rule',
  'names `<Rig root>/...`, replace `<Rig root>` with that path before you run the command or read the file.',
  'Paths are always absolute; never resolve them against the workspace.',
].join('\n');

/**
 * rules/AGENTS.md: the always-on rule file of an Antigravity plugin (core-rules.md alone is not picked up).
 * @param {{coreRules: string, conceptNote: string}} input rewritten core rules and the concept note
 */
function buildRulesFile({ coreRules, conceptNote }) {
  return [
    '# Rig for Antigravity',
    '',
    'Generated from the Rig plugin core rules by `scripts/sync-antigravity-plugin.cjs`. Do not edit by hand.',
    '',
    '## Core rules',
    '',
    demoteHeadings(stripTitle(coreRules)),
    '',
    ROOT_NOTE,
    '',
    demoteHeadings(conceptNote.trim()),
    '',
  ].join('\n');
}

/** README.md of the plugin: install, update and where the feature map lives. */
function buildReadme({ version, agyVersion }) {
  return [
    '# Rig for Antigravity',
    '',
    `Rig ${version} as an Antigravity plugin (plugin version \`${agyVersion}\`). Generated from \`plugins/rig/\` by \`scripts/sync-antigravity-plugin.cjs\`; do not edit by hand.`,
    '',
    'It carries the Rig skills, subagents, always-on rules and the hooks that have an Antigravity equivalent.',
    'Claude-only parts (statusline, setup, `remote`, `team`, Agent Teams hooks) are not included.',
    '',
    '## Install',
    '',
    'Pin the install to a release tag:',
    '',
    '```bash',
    `agy plugin install ${REPO}/tree/v${version}/antigravity/rig`,
    '```',
    '',
    'If you installed the Claude plugin natively under the same name `rig`, uninstall it first.',
    '',
    '## Update',
    '',
    '`agy` has no `update` command: uninstall the plugin, then install the new tag.',
    '',
    '## Safety guard limit',
    '',
    'Rig asks before risky shell commands and secret reads, and its ask wins over another plugin\'s `allow`. A hook file',
    'in a workspace\'s `.agents/` directory can still rewrite a command after Rig checked it (Antigravity applies its',
    '`overwrite` last and does not ask again). Review the `.agents/` hooks of repositories you do not trust, as you would',
    'review their code.',
    '',
    '## Feature map',
    '',
    `What works, what is partial and what is missing: ${REPO}/blob/main/docs/reference/antigravity-feature-map.md`,
    '',
  ].join('\n');
}

module.exports = { buildRulesFile, buildReadme, demoteHeadings };
