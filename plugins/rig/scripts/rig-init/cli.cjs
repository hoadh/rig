'use strict';
/**
 * rig-init CLI (`bin/rig-init`). Read-only verb: --plan [--json]. Apply verbs: --migrate [--global|--project <dir>],
 * --resume, --restore <backup-dir>, --permissions, --runtime, --deps.
 *
 * Consent (red team: failure-modes #3, security #3): an apply verb never runs inside a Claude Code session
 * (CLAUDECODE is set) and never without a terminal; it prints the exact command to run instead. In a terminal it
 * shows what will change and asks y/N. There is no `--yes` and no environment switch that skips the question.
 * `main` takes its streams and answers as parameters so tests can drive it; the real entry point passes the process.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyRefusal, askYesNo, restoreBackup, describeRestore } = require('./backup-restore-standalone.cjs');
const { planAll, planTarget, describeTarget } = require('./migration-planner.cjs');
const { applyMigration, resumeMigration } = require('./migration-journal-applier.cjs');
const perms = require('./user-settings-permissions-and-runtime.cjs');
const { checkClaudeCodeVersion, describeVersionCheck } = require('./cc-version-check.cjs');
const { runSkillsInstaller } = require('./skills-dependency-installer-runner.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const HELP = `Usage: rig-init <verb>
  --plan [--json]                 show what the other verbs would change (read-only; also runs inside Claude Code)
  --migrate [--global|--project <dir>]   move 1.x Rig files out of ~/.claude and/or the project into a backup
  --resume [--global|--project <dir>]    finish an interrupted --migrate
  --restore <backup-dir>          put a migration backup back (disable the Rig plugin first)
  --permissions                   merge the reviewed ask/deny rules into ~/.claude/settings.json
  --runtime                       write ~/.claude/rig/runtime (statusline, remote worker) and the statusLine setting
  --deps                          run the skills dependency installer (system, npm and pip packages)
Every verb except --plan changes your configuration: it runs only in a terminal outside Claude Code and asks for
confirmation. There is no option to skip that.`;

const VERBS = ['--plan', '--migrate', '--permissions', '--runtime', '--deps'];

/** Strict parse: unknown flags are errors. `--resume` alone or with `--migrate` resumes an interrupted migration. */
function parseArgs(argv) {
  const o = { verb: null, resume: false, json: false, global: false, project: null, restoreDir: null, help: false };
  const setVerb = (v) => {
    if (o.verb && o.verb !== v) throw new Error(`use one verb at a time (${o.verb} and ${v})`);
    o.verb = v;
  };
  const valueOf = (i, flag, what) => {
    const v = argv[i];
    if (!v || v.startsWith('-')) throw new Error(`${flag} needs ${what}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--global') o.global = true;
    else if (a === '--project') o.project = valueOf(++i, a, 'a directory');
    else if (a === '--restore') { setVerb(a); o.restoreDir = valueOf(++i, a, 'a backup directory'); } else if (a === '--resume') { setVerb('--migrate'); o.resume = true; } else if (VERBS.includes(a)) setVerb(a);
    else throw new Error(`unknown option: ${a}`);
  }
  if (o.global && o.project) throw new Error('use --global or --project <dir>, not both');
  if ((o.global || o.project) && o.verb !== '--migrate') throw new Error('--global and --project go with --migrate or --resume');
  if (o.json && o.verb !== '--plan') throw new Error('--json goes with --plan');
  return o;
}

const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`);

/** Plan objects trimmed for JSON consumers (the /rig:setup skill): counts and a sample, not hundreds of paths. */
function summarizeTarget(plan) {
  const { moves, ...rest } = plan;
  return { ...rest, moves: { count: moves.length, bytes: plan.bytes, generated: moves.filter((m) => m.generated).map((m) => m.rel), sample: moves.filter((m) => !m.generated).slice(0, 10).map((m) => m.rel) } };
}

function readRigVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { return 'unknown'; }
}

function scopeTargets(o, { home, cwd }) {
  if (o.global) return [planTarget({ kind: 'global', root: home, home })].filter(Boolean);
  if (o.project) {
    const root = path.resolve(cwd, o.project);
    if (!fs.existsSync(root)) throw new Error(`project directory not found: ${root}`);
    return [planTarget({ kind: 'project', root: fs.realpathSync(root), home })].filter(Boolean);
  }
  return planAll({ home, cwd });
}

/**
 * Internal entry with injectable streams, env, TTY flags, answers and ancestry: for tests only. The bin and `main()` never
 * use it, and the apply path runs the same gate (CLAUDECODE, Claude Code ancestry, TTY, prompt) wherever it is called from.
 * @param {object} io { argv, env, home, cwd, stdout, stderr, stdinIsTTY, stdoutIsTTY, ask, ancestors, pluginRoot, checkVersion, hooks, runInstaller }
 * @returns {Promise<number>} exit code: 0 ok, 1 error, 2 refused (not a terminal / inside Claude Code) or bad usage, 3 migration incomplete
 */
async function mainWithIo(io = {}) {
  const {
    argv = process.argv.slice(2), env = process.env, home = os.homedir(), cwd = process.cwd(),
    stdout = (s) => process.stdout.write(`${s}\n`), stderr = (s) => process.stderr.write(`${s}\n`),
    stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY),
    ask = askYesNo, pluginRoot = PLUGIN_ROOT, checkVersion = checkClaudeCodeVersion, hooks = {}, runInstaller = runSkillsInstaller, ancestors,
  } = io;
  let o;
  try {
    o = parseArgs(argv);
  } catch (err) {
    stderr(`rig-init: ${err.message}\n${HELP}`);
    return 2;
  }
  if (o.help || !o.verb) { stdout(HELP); return o.help ? 0 : 2; }

  try {
    if (o.verb === '--plan') return await runPlan(o, { home, cwd, stdout, pluginRoot, checkVersion });

    const refusal = applyRefusal({ env, stdinIsTTY, stdoutIsTTY, ancestors, command: `rig-init ${argv.map(quote).join(' ')}` });
    if (refusal) { stderr(refusal.trimEnd()); return 2; }
    const versionWarning = describeVersionCheck(checkVersion());
    if (versionWarning) stderr(versionWarning);
    const confirm = async (question) => { if (!(await ask(question))) { stdout('Cancelled, nothing changed.'); return false; } return true; };
    const ctx = { o, home, cwd, stdout, stderr, confirm, pluginRoot, hooks, runInstaller };
    if (o.verb === '--migrate') return await runMigrate(ctx);
    if (o.verb === '--restore') return await runRestore(ctx);
    if (o.verb === '--permissions') return await runPermissions(ctx);
    if (o.verb === '--runtime') return await runRuntime(ctx);
    return await runDeps(ctx);
  } catch (err) {
    stderr(`rig-init: ${err.message}`);
    return 1;
  }
}

async function runPlan(o, { home, cwd, stdout, pluginRoot, checkVersion }) {
  const targets = planAll({ home, cwd });
  const permissions = perms.planPermissions({ home });
  const runtime = perms.planRuntime({ home, pluginRoot });
  const claudeCode = checkVersion();
  if (o.json) {
    stdout(JSON.stringify({ rigInitVersion: readRigVersion(), claudeCode, home, targets: targets.map(summarizeTarget), permissions, runtime }, null, 2));
    return 0;
  }
  const warning = describeVersionCheck(claudeCode);
  if (warning) stdout(warning);
  stdout(targets.length ? targets.map(describeTarget).join('\n\n') : 'No 1.x Rig install found in ~/.claude or the current project.');
  stdout(`\nPermissions (--permissions): ${permissions.needed ? `${permissions.needed} rule(s) to add` : 'up to date'}`);
  stdout(`Runtime (--runtime): ${runtime.installedVersion ? `installed ${runtime.installedVersion}` : 'not installed'}; statusLine ${runtime.statusLine === 'other' ? 'is your own and stays' : 'will point at the runtime copy'}`);
  return 0;
}

async function runMigrate({ o, home, cwd, stdout, stderr, confirm, hooks }) {
  const plans = scopeTargets(o, { home, cwd });
  const interrupted = plans.filter((p) => p.pendingBackup);
  if (!o.resume && interrupted.length) {
    stderr(`rig-init: an earlier migration was interrupted (${interrupted.map((p) => p.pendingBackup).join(', ')}). Finish it first: rig-init --migrate --resume`);
    return 1;
  }
  const todo = plans.filter((p) => (o.resume ? p.pendingBackup : p.detected));
  if (!todo.length) {
    const unmarked = plans.filter((p) => !p.identified && p.unmarkedMatches > 0);
    for (const p of unmarked) stdout(`${describeTarget(p)}\n`);
    stdout(o.resume ? 'No interrupted migration to resume.' : unmarked.length ? 'Nothing was migrated: no Rig 1.x install marker.' : 'No 1.x Rig files found, nothing to migrate.');
    return 0;
  }
  for (const p of todo) stdout(`${describeTarget(p)}\n`);
  if (todo.some((p) => p.blockers.length)) { stderr('rig-init: fix the blockers above first.'); return 1; }
  if (!(await confirm(o.resume ? 'Resume the interrupted migration?' : 'Apply this migration?'))) return 0;
  const rigVersion = readRigVersion();
  let code = 0;
  for (const p of todo) {
    const result = o.resume ? resumeMigration({ backupDir: p.pendingBackup, home, hooks }) : applyMigration({ plan: p, home, rigVersion, hooks });
    stdout(`${p.kind === 'global' ? 'Global' : `Project ${p.root}`}: ${result.status}, ${result.moved} path(s) moved to ${result.backupDir}`);
    if (result.listFile) stdout(`  full list of moved paths: ${result.listFile}`);
    if (result.blocked.length) {
      code = 3;
      stderr(`  ${result.blocked.length} path(s) are in use and stay in place: ${result.blocked.slice(0, 5).map((b) => `${b.rel} (${b.code})`).join(', ')}\n  Close Claude Code sessions that use them (an open statusline holds files on Windows), then run: rig-init --migrate --resume`);
    }
  }
  if (code === 0) stdout('\nNext: enable the Rig plugin, then run `rig-init --runtime` (statusline, remote worker) and `rig-init --permissions` in a terminal. To undo: `node <backup-dir>/restore.cjs` after disabling the plugin.');
  return code;
}

async function runRestore({ o, home, stdout, confirm }) {
  const dir = path.resolve(o.restoreDir);
  if (!(await confirm(`Restore the Rig 1.x files and hooks from ${dir}?`))) return 0;
  stdout(describeRestore(restoreBackup({ backupDir: dir, home })));
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

module.exports = { main, parseArgs, HELP, _mainWithIo: mainWithIo };
