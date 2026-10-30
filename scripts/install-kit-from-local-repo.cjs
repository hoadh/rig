#!/usr/bin/env node
/**
 * Installs Rig from this local repo (no release download).
 *
 *   node scripts/install-kit-from-local-repo.cjs              # asks: global or this project
 *   node scripts/install-kit-from-local-repo.cjs --global     # → ~/.claude
 *   node scripts/install-kit-from-local-repo.cjs --dir ../app # → ../app/.claude + CLAUDE.md ...
 *
 * Global installs rewrite project-relative `.claude/` and `$CLAUDE_PROJECT_DIR` paths to
 * `$HOME/.claude/`; local installs pin hook commands to "$CLAUDE_PROJECT_DIR". settings.json is
 * merged (user hooks/keys kept, a timestamped backup written). CLAUDE.md, .gitignore, .rig.json,
 * ... are only created when missing. Hooks and files retired by the kit are removed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { buildCopyPlan } = require('./install-kit/kit-source-file-list-and-copy-plan.cjs');
const { isTransformableFile, rewriteContentForGlobalInstall } = require('./install-kit/kit-path-rewrite-for-install-mode.cjs');
const { mergeKitSettings } = require('./install-kit/settings-json-merge-preserving-user-hooks.cjs');
const { skillsInstallerCommand } = require('./install-kit/skills-installer-command.cjs');
const { deleteRetiredKitFiles } = require('./install-kit/retired-kit-hooks-and-files-cleanup.cjs');

const KIT_ROOT = path.resolve(__dirname, '..');
const HELP = `Usage: node scripts/install-kit-from-local-repo.cjs [options]
  -g, --global                 Install into ~/.claude (all projects)
  -d, --dir <path>             Install into a project directory (default: current directory)
  -y, --yes                    Skip prompts (defaults to a local install when --global is absent)
      --dry-run                Show what would change, write nothing
      --force-overwrite-settings  Replace settings.json instead of merging (backup kept)
      --install-skills         Run the skills dependency installer afterwards
  -h, --help                   Show this help`;

function parseArgs(argv) {
  const opts = { global: false, dir: null, yes: false, dryRun: false, forceSettings: false, installSkills: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-g' || a === '--global') opts.global = true;
    else if (a === '-d' || a === '--dir') opts.dir = argv[++i] && !argv[i].startsWith('-') ? argv[i] : undefined;
    else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force-overwrite-settings') opts.forceSettings = true;
    else if (a === '--install-skills') opts.installSkills = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (opts.dir === undefined) throw new Error('--dir needs a path');
  if (opts.global && opts.dir) throw new Error('Use either --global or --dir, not both');
  return opts;
}

// One shared interface: a second createInterface would lose lines the first one already buffered
let rl = null;
function ask(question) {
  rl = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function resolveMode(opts) {
  const interactive = process.stdin.isTTY && !opts.yes;
  if (!opts.global && !opts.dir && interactive) {
    const choice = await ask(`Install Rig:\n  1) Global  (~/.claude, every project)\n  2) Project (${process.cwd()})\nChoose [1/2]: `);
    if (choice === '1') opts.global = true;
    else if (choice !== '2') throw new Error('Cancelled: choose 1 or 2');
  }
  const targetRoot = opts.global ? path.join(os.homedir(), '.claude') : path.resolve(opts.dir || process.cwd());
  if (!opts.global && targetRoot === KIT_ROOT) throw new Error('Target is the kit repo itself; pass --dir <project> or --global');
  return { isGlobal: opts.global, targetRoot, interactive };
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readJsonOrNull(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot parse existing ${file} (${err.message}); fix it or use --force-overwrite-settings`);
  }
}

/** Writes `content` only when it differs; keeps the source file mode (executable scripts). */
function writeIfChanged(dest, content, mode, dryRun) {
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(Buffer.from(content))) return false;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    fs.chmodSync(dest, mode & 0o777);
  }
  return true;
}

/** Computes merged settings.json content; throws on a bad user file before anything is written. */
function prepareSettings(item, ctx) {
  let raw = fs.readFileSync(item.src, 'utf8');
  if (ctx.isGlobal) raw = rewriteContentForGlobalInstall(raw).content;
  const existing = ctx.forceSettings ? null : readJsonOrNull(item.dest);
  const { merged, stats } = mergeKitSettings(JSON.parse(raw), existing, ctx.isGlobal);
  return { item, content: `${JSON.stringify(merged, null, 2)}\n`, stats };
}

function writeSettings({ item, content, stats: s }, ctx, stats) {
  if (fs.existsSync(item.dest) && fs.readFileSync(item.dest, 'utf8') !== content && !ctx.dryRun) {
    // Never overwrite an earlier backup (two runs within the same second share a timestamp)
    const base = `${item.dest}.bak-${timestamp()}`;
    let n = 0;
    stats.backup = base;
    while (fs.existsSync(stats.backup)) stats.backup = `${base}-${++n}`;
    fs.copyFileSync(item.dest, stats.backup);
  }
  stats.settingsChanged = writeIfChanged(item.dest, content, fs.statSync(item.src).mode, ctx.dryRun);
  stats.settings = s;
}

function runInstall(ctx) {
  const plan = buildCopyPlan({ kitRoot: KIT_ROOT, targetRoot: ctx.targetRoot, isGlobal: ctx.isGlobal, fs });
  const stats = { written: 0, unchanged: 0, preserved: [], rewritten: 0 };
  const settingsItem = plan.find((item) => item.kind === 'settings');
  const settings = settingsItem && prepareSettings(settingsItem, ctx);
  for (const item of plan) {
    if (item.kind === 'settings') continue;
    if (item.kind === 'preserve' && fs.existsSync(item.dest)) {
      stats.preserved.push(path.relative(ctx.targetRoot, item.dest));
      continue;
    }
    let content = fs.readFileSync(item.src);
    if (ctx.isGlobal && isTransformableFile(item.src)) {
      const result = rewriteContentForGlobalInstall(content.toString('utf8'));
      if (result.changes > 0) {
        content = Buffer.from(result.content);
        stats.rewritten++;
      }
    }
    if (writeIfChanged(item.dest, content, fs.statSync(item.src).mode, ctx.dryRun)) stats.written++;
    else stats.unchanged++;
  }
  if (settings) writeSettings(settings, ctx, stats);
  const claudeDir = ctx.isGlobal ? ctx.targetRoot : path.join(ctx.targetRoot, '.claude');
  const retired = deleteRetiredKitFiles({ claudeDir, fs, dryRun: ctx.dryRun });
  stats.retiredFiles = retired.deleted;
  stats.retiredKeptReferenced = retired.keptReferenced;
  return { plan, stats };
}

function printSummary(ctx, { plan, stats }) {
  const verb = ctx.dryRun ? 'Would write' : 'Wrote';
  console.log(`\n${ctx.dryRun ? '[dry-run] ' : ''}Rig ${ctx.isGlobal ? 'global' : 'project'} install → ${ctx.targetRoot}`);
  console.log(`  ${plan.length} kit files: ${verb.toLowerCase()} ${stats.written}, unchanged ${stats.unchanged}, kept existing ${stats.preserved.length}`);
  if (ctx.isGlobal) console.log(`  .claude/ paths mapped to $HOME/.claude/ in ${stats.rewritten} kit file(s)`);
  if (stats.preserved.length) console.log(`  Kept your existing: ${stats.preserved.join(', ')}`);
  if (stats.settings) {
    const s = stats.settings;
    console.log(`  settings.json: ${stats.settingsChanged ? verb.toLowerCase() : 'unchanged'} — ${s.added} hook(s) added, ${s.duplicates} already present (${s.optionsUpdated} with updated run options), ` +
      `${s.canonicalized} command path(s) normalized, ${s.permissionRulesAdded} permission rule(s) added` +
      `${s.keysAdded.length ? `, keys added: ${s.keysAdded.join(', ')}` : ''}`);
    if (s.retiredRemoved.length) console.log(`  Retired hook registrations removed: ${[...new Set(s.retiredRemoved)].join(', ')}`);
  }
  if (stats.retiredFiles.length) {
    console.log(`  ${ctx.dryRun ? 'Would delete' : 'Deleted'} ${stats.retiredFiles.length} retired kit file(s): ${stats.retiredFiles.join(', ')}`);
  }
  if (stats.retiredKeptReferenced.length) {
    console.log(`  Kept retired hook file(s) still run by your settings: ${stats.retiredKeptReferenced.join(', ')}. ` +
      'Remove those registrations from settings.json / settings.local.json, then re-install.');
  }
  if (stats.backup) console.log(`  Backup: ${stats.backup}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const ctx = { ...(await resolveMode(opts)), dryRun: opts.dryRun, forceSettings: opts.forceSettings };
  if (ctx.interactive && !ctx.dryRun) {
    const ok = await ask(`Install into ${ctx.targetRoot}? Existing kit files will be overwritten [y/N]: `);
    if (!/^y(es)?$/i.test(ok)) return console.log('Cancelled.');
  }
  if (rl) rl.close(); // release stdin before the long copy and the skills installer
  printSummary(ctx, runInstall(ctx));
  if (opts.installSkills && !ctx.dryRun) {
    const skillsDir = ctx.isGlobal ? path.join(ctx.targetRoot, 'skills') : path.join(ctx.targetRoot, '.claude', 'skills');
    const { cmd, args } = skillsInstallerCommand(process.platform, skillsDir, opts.yes);
    const res = spawnSync(cmd, args, { cwd: skillsDir, stdio: 'inherit' });
    if (res.error) throw new Error(`Could not start skills installer (${cmd}): ${res.error.message}`);
    if (res.status !== 0) throw new Error(`Skills installer exited with code ${res.status}`);
  }
}

main()
  .catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl && rl.close());
