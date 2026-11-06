/**
 * bash-rig-init-destructive-verbs-rule.cjs - rule `rig-init-destructive-verbs`.
 *
 * `rig-init` changes the user's Claude Code configuration with the verbs --migrate, --resume, --restore, --permissions,
 * --runtime and --deps (and a restore.cjs of a rig-backups dir does the same as --restore). The CLI itself refuses to run
 * inside a Claude Code session, under a Claude Code parent process and without a terminal; this rule is the second layer
 * and is advisory: if a model still tries, the user is asked first. Consent against a determined agent is defense in depth,
 * not a guarantee.
 *
 * The rule reads the WHOLE command text, not just the command word, so every way of reaching rig-init is covered: a script
 * (`script -qc '...'`), xargs, npx, a variable (`V=--migrate; rig-init $V`), `python3 -c`, `node -e require('.../cli.cjs')`,
 * `bash /p/bin/rig-init`, `rig-init.cmd`, `cd <backup> && node restore.cjs`. It asks when the text mentions `rig-init`
 * (also as `rig-init/cli.cjs`) together with an apply verb, or mentions a `restore.cjs`. `--plan` alone passes. False
 * positives (a commit message or an echo that names both) are accepted: ask costs one click.
 *
 * Contract: decision ask only, opaquePolicy 'inspect', crashPolicy 'allow'.
 */
const VERBS = ['migrate', 'resume', 'restore', 'permissions', 'runtime', 'deps', 'yes'];
const MENTIONS_RIG_INIT = /rig-init/;
const APPLY_VERB = new RegExp(`--(?:${VERBS.join('|')})\\b|(?:^|\\s)-y(?:\\s|$)`);
const RESTORE_COPY = /restore\.cjs|rig-backups[/\\][^\s'"]*restore/;

const REASON = 'rig-init changes your Claude Code configuration (hooks, settings, files in ~/.claude). It normally runs only in your own terminal. Run it there yourself, or confirm that you want this session to run it.';

function check(segment, ctx) {
  const text = (ctx && ctx.fullCommand) || segment.raw || segment.argv.join(' ');
  const hit = (MENTIONS_RIG_INIT.test(text) && APPLY_VERB.test(text)) || RESTORE_COPY.test(text);
  return hit ? { decision: 'ask', reason: REASON, context: REASON } : null;
}

module.exports = { id: 'rig-init-destructive-verbs', configKey: 'rigInitDestructiveVerbs', opaquePolicy: 'inspect', crashPolicy: 'allow', check };
