'use strict';
const { rigInitTerminalCommand } = require('../../hooks/lib/rig-init-terminal-command.cjs');
/**
 * rig-init CLI (`bin/rig-init`). Read-only verb: --plan [--json]. Apply verbs: --permissions, --runtime, --deps.
 * The 1.x migration verbs (--migrate, --resume, --restore, --global, --project) were removed in 2.1.0: they exit 2
 * with the route through Rig 2.0.10 (MIGRATION_REMOVED).
 *
 * Consent (red team: failure-modes #3, security #3): an apply verb never runs inside a Claude Code session
 * (CLAUDECODE is set) and never without a terminal; it prints the exact command to run instead. In a terminal it
 * shows what will change and asks y/N. There is no `--yes` and no environment switch that skips the question.
 * `main` takes its streams and answers as parameters so tests can drive it; the real entry point passes the process.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyRefusal, askYesNo } = require('./terminal-consent-gate.cjs');
const { readJsonFile, backupsDirFor } = require('./settings-json-io-and-backup-dir.cjs');
const perms = require('./user-settings-permissions-and-runtime.cjs');
const { checkClaudeCodeVersion, describeVersionCheck } = require('./cc-version-check.cjs');
const { runSkillsInstaller } = require('./skills-dependency-installer-runner.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const HELP = `Usage: rig-init <verb>
  --plan [--json]                 show what the other verbs would change (read-only; also runs inside Claude Code)
  --permissions                   merge the reviewed ask/deny rules into ~/.claude/settings.json
  --runtime                       write ~/.claude/rig/runtime (statusline, remote worker) and the statusLine setting
  --deps                          run the skills dependency installer (system, npm and pip packages)
Every verb except --plan changes your configuration: it runs only in a terminal outside Claude Code and asks for
confirmation. There is no option to skip that.`;

const VERBS = ['--plan', '--permissions', '--runtime', '--deps'];
const REMOVED = ['--migrate', '--resume', '--restore', '--global', '--project'];
const MIGRATION_DOC = 'https://github.com/hoadh/rig/blob/main/docs/how-to/migrate-from-rig-1x.md';
const MIGRATION_REMOVED = `1.x migration was removed in 2.1.0. To migrate a 1.x install, or to finish or undo a 2.0.x migration, use Rig 2.0.10: ${MIGRATION_DOC}`;

class RemovedVerbError extends Error {}

/** Strict parse: unknown flags are errors; a removed 1.x verb is its own error (exit 2 with the 2.0.10 route). */
function parseArgs(argv) {
  const o = { verb: null, json: false, help: false };
  for (const a of argv) {
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.json = true;
    else if (REMOVED.includes(a)) throw new RemovedVerbError(`${a}: ${MIGRATION_REMOVED}`);
    else if (VERBS.includes(a)) {
      if (o.verb && o.verb !== a) throw new Error(`use one verb at a time (${o.verb} and ${a})`);
      o.verb = a;
    } else throw new Error(`unknown option: ${a}`);
  }
  if (o.json && o.verb !== '--plan') throw new Error('--json goes with --plan');
  return o;
}

const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`);

function readRigVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { return 'unknown'; }
}

/**
 * Unfinished 2.0.x migrations: backup dirs under ~/.claude/rig-backups whose journal is not `done` and that were not
 * restored (restore.cjs writes restored.json but leaves the journal as it was). 2.1 cannot finish them; --plan names
 * them so the user can finish with 2.0.10 or undo with the backup's own restore.cjs.
 * @returns {{dir: string, kind: string, root: string|null}[]}
 */
function pendingMigrations(home) {
  const root = backupsDirFor(home);
  const found = [];
  let groups;
  try { groups = fs.readdirSync(root, { withFileTypes: true }); } catch { return found; }
  for (const group of groups) {
    if (!group.isDirectory() || group.name === 'user-settings') continue;
    let names;
    try { names = fs.readdirSync(path.join(root, group.name)); } catch { continue; }
    for (const name of names) {
      const dir = path.join(root, group.name, name);
      try {
        const journal = readJsonFile(path.join(dir, 'journal.json')).value;
        if (!journal || journal.status === 'done' || fs.existsSync(path.join(dir, 'restored.json'))) continue;
        found.push({ dir, kind: journal.kind === 'project' ? 'project' : 'global', root: typeof journal.root === 'string' ? journal.root : null });
      } catch { /* unreadable journal: not a migration we can describe */ }
    }
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** One line per unfinished migration: what it covers, the 2.0.10 resume command for that scope, and the undo. */
function describePending({ dir, kind, root }) {
  const scope = kind === 'project' && root ? `--project ${quote(root)}` : '--global';
  const what = kind === 'project' && root ? `the project ${root}` : '~/.claude';
  return `A 2.0.x migration of ${what} is unfinished (${dir}). Rig 2.1 cannot finish it. Install Rig 2.0.10 (${MIGRATION_DOC}) and run its \`rig-init --migrate --resume ${scope}\` in a terminal, or undo it: disable the Rig plugin, then node "${path.join(dir, 'restore.cjs')}".`;
}

/**
 * Internal entry with injectable streams, env, TTY flags, answers and ancestry: for tests only. The bin and `main()` never
 * use it, and the apply path runs the same gate (CLAUDECODE, TTY, Claude Code ancestry, prompt) wherever it is called from.
 * @param {object} io { argv, env, home, stdout, stderr, stdinIsTTY, stdoutIsTTY, ask, ancestors, pluginRoot, checkVersion, runInstaller }
 * @returns {Promise<number>} exit code: 0 ok, 1 error, 2 refused (not a terminal / inside Claude Code), bad usage or a removed 1.x verb
 */
async function mainWithIo(io = {}) {
  const {
    argv = process.argv.slice(2), env = process.env, home = os.homedir(),
    stdout = (s) => process.stdout.write(`${s}\n`), stderr = (s) => process.stderr.write(`${s}\n`),
    stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY),
    ask = askYesNo, pluginRoot = PLUGIN_ROOT, checkVersion = checkClaudeCodeVersion, runInstaller = runSkillsInstaller, ancestors,
  } = io;
  let o;
  try {
    o = parseArgs(argv);
  } catch (err) {
    stderr(err instanceof RemovedVerbError ? `rig-init ${err.message}` : `rig-init: ${err.message}\n${HELP}`);
    return 2;
  }
  if (o.help || !o.verb) { stdout(HELP); return o.help ? 0 : 2; }

  try {
    if (o.verb === '--plan') return await runPlan(o, { home, stdout, pluginRoot, checkVersion });

    const refusal = applyRefusal({ env, stdinIsTTY, stdoutIsTTY, ancestors, command: `${rigInitTerminalCommand(path.resolve(__dirname, '..', '..'))} ${argv.map(quote).join(' ')}` });
    if (refusal) { stderr(refusal.trimEnd()); return 2; }
    const versionWarning = describeVersionCheck(checkVersion());
    if (versionWarning) stderr(versionWarning);
    const confirm = async (question) => { if (!(await ask(question))) { stdout('Cancelled, nothing changed.'); return false; } return true; };
    const ctx = { o, home, stdout, stderr, confirm, pluginRoot, runInstaller };
    if (o.verb === '--permissions') return await runPermissions(ctx);
    if (o.verb === '--runtime') return await runRuntime(ctx);
    return await runDeps(ctx);
  } catch (err) {
    stderr(`rig-init: ${err.message}`);
    return 1;
  }
}

async function runPlan(o, { home, stdout, pluginRoot, checkVersion }) {
  const permissions = perms.planPermissions({ home });
  const runtime = perms.planRuntime({ home, pluginRoot });
  const claudeCode = checkVersion();
  const pending = pendingMigrations(home);
  if (o.json) {
    stdout(JSON.stringify({ rigInitVersion: readRigVersion(), claudeCode, home, permissions, runtime, pendingMigrations: pending }, null, 2));
    return 0;
  }
  const warning = describeVersionCheck(claudeCode);
  if (warning) stdout(warning);
  for (const p of pending) stdout(describePending(p));
  stdout(`Permissions (--permissions): ${permissions.needed ? `${permissions.needed} rule(s) to add` : 'up to date'}`);
  stdout(`Runtime (--runtime): ${runtime.installedVersion ? `installed ${runtime.installedVersion}` : 'not installed'}; statusLine ${runtime.statusLine === 'other' ? 'is your own and stays' : 'will point at the runtime copy'}`);
  return 0;
}

async function runPermissions({ home, stdout, confirm }) {
  const plan = perms.planPermissions({ home });
  if (!plan.needed) { stdout('Permissions already include every rule of the template.'); return 0; }
  stdout(`Add ${plan.missing.ask.length} ask and ${plan.missing.deny.length} deny rule(s) to ${plan.file} (a copy of the file is saved first; nothing is removed):`);
  for (const rule of [...plan.missing.ask.map((r) => `ask  ${r}`), ...plan.missing.deny.map((r) => `deny ${r}`)]) stdout(`  ${rule}`);
  if (!(await confirm('Add these rules?'))) return 0;
  const res = perms.applyPermissions({ home });
  stdout(`Added ${res.added} rule(s).${res.backup ? ` Backup: ${res.backup}` : ''}`);
  return 0;
}

async function runRuntime({ home, stdout, confirm, pluginRoot }) {
  const plan = perms.planRuntime({ home, pluginRoot });
  stdout(`Copy the Rig runtime (statusline, remote worker) to ${plan.runtimeDir}${plan.willSetStatusLine ? ' and set statusLine in ~/.claude/settings.json to use it' : '; your own statusLine stays'}.`);
  if (!(await confirm('Write the runtime copy?'))) return 0;
  const res = perms.applyRuntime({ home, pluginRoot });
  stdout(`Runtime ${res.runtime.status} (${res.runtime.version}). statusLine: ${res.statusLine}.${res.backup ? ` Backup: ${res.backup}` : ''}`);
  return 0;
}

async function runDeps({ stdout, stderr, confirm, pluginRoot, runInstaller }) {
  stdout('This runs the skills installer (skills/install.sh, install.ps1 on Windows). It can install system packages (ffmpeg, imagemagick), global npm tools, npm dependencies of some skills and Python packages, and it asks before each step. It never uses sudo unless you rerun it yourself with --with-sudo.');
  if (!(await confirm('Run the skills dependency installer?'))) return 0;
  const status = runInstaller({ pluginRoot });
  if (status !== 0) { stderr(`rig-init: the installer exited with status ${status}`); return 1; }
  stdout('Done. The npm dependencies were installed inside the plugin directory: run `rig-init --deps` again after every plugin update.');
  return 0;
}

/** The real CLI: process argv, env, TTY and prompt, whatever the caller passes. */
function main() {
  return mainWithIo({});
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { main, parseArgs, pendingMigrations, HELP, MIGRATION_REMOVED, _mainWithIo: mainWithIo };
