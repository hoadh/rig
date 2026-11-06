/**
 * bash-rig-init-destructive-verbs-rule.cjs - rule `rig-init-destructive-verbs`.
 *
 * `rig-init` changes the user's Claude Code configuration with the verbs --migrate, --resume, --restore, --permissions,
 * --runtime and --deps (and a restore.cjs inside a rig-backups dir does the same as --restore). Those verbs refuse to
 * run inside a Claude Code session and in anything but a terminal, so a model cannot apply them by itself; this rule is
 * the second layer: if a model still tries, the user is asked first. `--plan` is read-only and passes.
 * Matched: `rig-init <verb>` (also by path or with an env/sudo prefix), `node .../rig-init/cli.cjs <verb>`,
 * `node .../rig-backups/.../restore.cjs`, and the same text inside an opaque segment (`$(...)`, heredoc).
 * Any `--yes` / `-y` with rig-init asks too, even though rig-init has no such option.
 *
 * Contract: decision ask only, opaquePolicy 'inspect', crashPolicy 'allow'.
 */
const { commandName } = require('./bash-command-segment-tokenizer.cjs');

const VERBS = ['migrate', 'resume', 'restore', 'permissions', 'runtime', 'deps', 'yes'];
const VERB_WORD = new RegExp(`^--(${VERBS.join('|')})$`);
const RIG_INIT_PATH = /(^|[/\\])(rig-init(\.cmd|\.exe)?|rig-init[/\\]cli\.cjs)$/;
const RESTORE_COPY = /rig-backups[/\\].*[/\\]restore\.cjs$/;
// Opaque text: `rig-init ... --verb` or `rig-init/cli.cjs ... --verb` on one line
const OPAQUE_TEXT = new RegExp(String.raw`rig-init(?:[/\\]cli\.cjs)?\b[^\n;|&]*\s--(?:${VERBS.join('|')})\b|rig-backups[/\\]\S*restore\.cjs`);

const REASON = 'rig-init changes your Claude Code configuration (hooks, settings, files in ~/.claude). It normally runs only in your own terminal. Run it there yourself, or confirm that you want this session to run it.';

function check(segment) {
  const args = segment.argv.slice(1);
  if (segment.opaque) return OPAQUE_TEXT.test(segment.raw || '') ? { decision: 'ask', reason: REASON, context: REASON } : null;
  const name = commandName(segment);
  const direct = name === 'rig-init';
  const viaNode = name === 'node' && args.some((a) => RIG_INIT_PATH.test(a));
  if ((direct || viaNode) && segment.argv.some((w) => VERB_WORD.test(w) || w === '-y')) return { decision: 'ask', reason: REASON, context: REASON };
  if (name === 'node' && args.some((a) => RESTORE_COPY.test(a))) return { decision: 'ask', reason: REASON, context: REASON };
  return null;
}

module.exports = { id: 'rig-init-destructive-verbs', configKey: 'rigInitDestructiveVerbs', opaquePolicy: 'inspect', crashPolicy: 'allow', check };
