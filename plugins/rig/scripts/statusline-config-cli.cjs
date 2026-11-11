#!/usr/bin/env node
'use strict';

/**
 * rig-statusline: list, describe, preview and turn statusline items on or off.
 *
 *   rig-statusline [--list] [--json] [--project [dir]]
 *   rig-statusline --enable <ids> | --disable <ids> | --reset [ids]   [--project [dir]]
 *   rig-statusline --preview [--project [dir]]
 *
 * Writes `statuslineItems` in `~/.claude/.rig.json`, or with --project in `<dir>/.claude/.rig.json` (dir defaults to
 * $CLAUDE_PROJECT_DIR, else the current directory; the project file wins over the global one). Ids are comma separated. Nothing else in the file
 * changes; an unparsable file is never rewritten.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ITEMS, ITEM_IDS } = require('../hooks/lib/statusline-items.cjs');

const HELP = `Usage: rig-statusline [verb] [--project [dir]]
  --list [--json]      every item: id, row, on/off and where that is set, modes, sample, description (default);
                       with --project, the state in that project
  --enable <ids>       turn items on (comma separated ids)
  --disable <ids>      turn items off
  --reset [ids]        back to the default (on) for these ids, or for all
  --preview            render the statusline with sample data and the current settings
  --project [dir]      use <dir>/.claude/.rig.json instead of ~/.claude/.rig.json (default dir: $CLAUDE_PROJECT_DIR,
                       else the current dir)
Changes show at the next statusline refresh.`;

class UsageError extends Error {}

function parseArgs(argv) {
  const o = { verb: null, ids: null, json: false, project: undefined, help: false };
  const setVerb = (v) => {
    if (o.verb) throw new UsageError(o.verb === v ? `give ${v} once, with comma separated ids` : `use one verb at a time (${o.verb} and ${v})`);
    o.verb = v;
  };
  const optional = (i) => (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : null);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--list' || a === '--preview') setVerb(a);
    else if (a === '--enable' || a === '--disable' || a === '--reset') {
      setVerb(a);
      const v = optional(i);
      if (v === null && a !== '--reset') throw new UsageError(`${a} needs item ids, e.g. ${a} duration,version`);
      if (v !== null) {
        o.ids = [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
        if (!o.ids.length) throw new UsageError(`${a} needs item ids, e.g. ${a} duration,version`);
        i++;
      }
    } else if (a === '--project') {
      const v = optional(i);
      o.project = v; // null: the session's project dir, see projectDirOf()
      if (v !== null) i++;
    } else throw new UsageError(`unknown argument ${a}`);
  }
  o.verb = o.verb || '--list';
  if (o.json && o.verb !== '--list') throw new UsageError('--json goes with --list');
  if (o.ids) {
    const unknown = o.ids.filter((id) => !ITEM_IDS.includes(id));
    if (unknown.length) throw new UsageError(`unknown item ${unknown.join(', ')}; items: ${ITEM_IDS.join(', ')}`);
  }
  return o;
}

const globalFile = (home) => path.join(home, '.claude', '.rig.json');
const MODES = ['full', 'compact', 'minimal', 'none'];

/**
 * Dir whose `.claude/.rig.json` is "the project" for --project and --list: the given dir, else CLAUDE_PROJECT_DIR
 * (the session's project, which the Bash tool's cwd can drift away from after a `cd`), else the cwd. The home dir
 * is never a project: its `.claude/.rig.json` is the global file.
 */
function projectDirOf(given, { cwd, env, home }) {
  const dir = path.resolve(cwd, given || env.CLAUDE_PROJECT_DIR || '.');
  return path.resolve(dir) === path.resolve(home) ? null : dir;
}
const projectFile = (dir) => path.join(dir, '.claude', '.rig.json');

/** Parsed config object, {} when the file is missing; throws when it exists but is not a JSON object. */
function readConfig(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}); fix or remove it first, nothing was changed`, { cause: e });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} does not hold a JSON object; nothing was changed`);
  return data;
}

/** Replace `file` atomically. A symlink is followed (the link stays, its target changes) and the file mode is kept. */
function writeConfigAtomic(file, data) {
  let target = file;
  let mode;
  try {
    target = fs.realpathSync(file);
    mode = fs.statSync(target).mode & 0o777;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', mode === undefined ? undefined : { mode });
    fs.renameSync(tmp, target);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Like readConfig, but an unreadable file counts as empty and is reported through `warn` (advisory reads only). */
function readConfigLenient(file, warn) {
  try { return readConfig(file); } catch (e) {
    warn(`warning: ${e.message.replace(/; (fix or remove it first, )?nothing was changed$/, '')}; ignored, as the statusline does`);
    return {};
  }
}

const itemsOf = (cfg) => (cfg.statuslineItems && typeof cfg.statuslineItems === 'object' && !Array.isArray(cfg.statuslineItems) ? cfg.statuslineItems : {});

/** Effective state of every item: project file over global file over the default (on). */
function effectiveItems({ home, projectDir, warn = () => {} }) {
  const gCfg = readConfigLenient(globalFile(home), warn);
  const pCfg = projectDir ? readConfigLenient(projectFile(projectDir), warn) : {};
  const g = itemsOf(gCfg);
  const p = itemsOf(pCfg);
  // The statusline renders an unknown mode as full
  const named = pCfg.statusline || gCfg.statusline || 'full';
  const mode = MODES.includes(named) ? named : 'full';
  const items = ITEMS.map((item) => {
    const source = typeof p[item.id] === 'boolean' ? 'project' : typeof g[item.id] === 'boolean' ? 'global' : 'default';
    const on = source === 'project' ? p[item.id] : source === 'global' ? g[item.id] : true;
    return { ...item, on, source, shownInMode: on && item.modes.includes(mode) };
  });
  return { mode, items };
}

function formatList({ mode, items }, files) {
  const lines = [`Statusline mode: ${mode}${mode === 'none' ? ' (nothing is shown)' : ''}. Config: ${files.join(', ')}`, ''];
  let row = '';
  for (const it of items) {
    if (it.row !== row) { row = it.row; lines.push(`${row.toUpperCase()} ROW`); }
    const state = it.on ? 'on ' : 'off';
    const where = it.source === 'default' ? '' : ` (${it.source})`;
    const modes = it.modes.length === 3 ? 'all modes' : it.modes.join('/');
    lines.push(`  ${state} ${it.id.padEnd(13)}${it.sample}`);
    lines.push(`      ${it.description} [${modes}]${where}`);
  }
  lines.push('', 'Turn items off or on: rig-statusline --disable <ids> | --enable <ids> [--project]');
  return lines.join('\n');
}

/** Sample stdin for --preview: every session field set, so each session and workspace item that is on shows. */
function previewInput(cwd) {
  const resets = Math.floor(Date.now() / 1000) + 2 * 3600 + 15 * 60;
  return JSON.stringify({
    model: { display_name: 'Opus 5.5' }, effort: { level: 'high' }, version: '2.1.330',
    output_style: { name: 'explanatory' }, vim: { mode: 'NORMAL' },
    workspace: { current_dir: cwd },
    context_window: { context_window_size: 200000, used_percentage: 42, current_usage: { input_tokens: 84000 }, total_input_tokens: 120000, total_output_tokens: 18000 },
    cost: { total_cost_usd: 0.42, total_duration_ms: 1500000, total_api_duration_ms: 480000, total_lines_added: 120, total_lines_removed: 34 },
    rate_limits: { five_hour: { used_percentage: 38, resets_at: resets }, seven_day: { used_percentage: 61, resets_at: resets + 3 * 86400 } },
  });
}

function preview({ cwd, env }) {
  const script = path.resolve(__dirname, '..', 'statusline.cjs');
  // CLAUDE_BILLING_MODE=api so the cost item shows next to the plan limits
  const res = spawnSync(process.execPath, [script], { cwd, input: previewInput(cwd), encoding: 'utf8', env: { ...env, CLAUDE_BILLING_MODE: 'api' } });
  if (res.error) throw res.error;
  return `${res.stdout.replace(/\n+$/, '')}\n\n(Sample data. Tools, agents and todos rows show only while they are active.)`;
}

function run(argv, io = {}) {
  const home = io.home || os.homedir();
  const cwd = io.cwd || process.cwd();
  const log = io.log || ((m) => process.stdout.write(m + '\n'));
  const err = io.err || ((m) => process.stderr.write(m + '\n'));
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`rig-statusline: ${e.message}\n${HELP}`);
    return 2;
  }
  if (o.help) { log(HELP); return 0; }
  const env = io.env || process.env;
  const sessionProject = projectDirOf(o.project, { cwd, env, home });
  const writes = ['--enable', '--disable', '--reset'].includes(o.verb);
  if (writes && o.project !== undefined && !sessionProject) {
    err('rig-statusline: --project points at the home dir, whose .claude/.rig.json is the global file; drop --project');
    return 2;
  }
  const projectDir = o.project === undefined ? null : sessionProject; // the write target
  try {
    if (o.verb === '--list') {
      const state = effectiveItems({ home, projectDir: sessionProject, warn: err });
      if (o.json) log(JSON.stringify({ mode: state.mode, items: state.items.map(({ id, row, on, source, modes, shownInMode, sample, description }) => ({ id, row, on, source, modes, shownInMode, sample, description })) }, null, 2));
      else log(formatList(state, [globalFile(home), ...(sessionProject ? [projectFile(sessionProject)] : [])]));
      return 0;
    }
    if (o.verb === '--preview') { log(preview({ cwd: sessionProject || cwd, env })); return 0; }

    const file = projectDir ? projectFile(projectDir) : globalFile(home);
    const cfg = readConfig(file);
    const items = { ...itemsOf(cfg) };
    const ids = o.ids || ITEM_IDS;
    for (const id of ids) {
      if (o.verb === '--reset') delete items[id];
      else items[id] = o.verb === '--enable';
    }
    const changed = JSON.stringify(items) !== JSON.stringify(itemsOf(cfg));
    if (Object.keys(items).length) cfg.statuslineItems = items;
    else delete cfg.statuslineItems;
    if (changed) writeConfigAtomic(file, cfg);
    const what = o.verb === '--reset' ? `reset to default (on): ${o.ids ? ids.join(', ') : 'all items'}` : `${o.verb === '--enable' ? 'on' : 'off'}: ${ids.join(', ')}`;
    log(changed ? `${what} (${file}). Shows at the next statusline refresh.` : `${what}: already so, ${file} not changed.`);
    if (!projectDir && sessionProject && o.verb !== '--reset') {
      // Advisory only: the global file is already written, so a broken project file must not fail the command
      const local = itemsOf(readConfigLenient(projectFile(sessionProject), () => {}));
      const overridden = ids.filter((id) => typeof local[id] === 'boolean');
      if (overridden.length) log(`Note: ${projectFile(sessionProject)} also sets ${overridden.join(', ')} and wins in this project.`);
    }
    return 0;
  } catch (e) {
    err(`rig-statusline: ${e.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(run(process.argv.slice(2)));

module.exports = { run, parseArgs, effectiveItems, readConfig, previewInput };
