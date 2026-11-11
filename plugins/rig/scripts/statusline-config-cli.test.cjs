'use strict';

/** rig-statusline CLI: list, enable/disable/reset round trips, --project, refusals. Temp HOME and project only. */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('./statusline-config-cli.cjs');

let root, home, cwd;
const globalFile = () => path.join(home, '.claude', '.rig.json');
const projectFile = () => path.join(cwd, '.claude', '.rig.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
let extraEnv = {};
function cli(...argv) {
  const out = [];
  const errs = [];
  const status = run(argv, { home, cwd, log: (m) => out.push(m), err: (m) => errs.push(m), env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', CLAUDE_PROJECT_DIR: '', ...extraEnv } });
  return { status, out: out.join('\n'), err: errs.join('\n') };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-sl-cli-'));
  home = path.join(root, 'home');
  cwd = path.join(root, 'proj');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
});
afterEach(() => { extraEnv = {}; fs.rmSync(root, { recursive: true, force: true }); });

describe('rig-statusline', () => {
  it('--disable then --enable writes the global file and keeps the other keys', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(globalFile(), JSON.stringify({ statusline: 'compact', plan: { x: 1 } }));
    let r = cli('--disable', 'cost, duration');
    assert.strictEqual(r.status, 0, r.err);
    assert.match(r.out, /off: cost, duration/);
    assert.deepStrictEqual(readJson(globalFile()), { statusline: 'compact', plan: { x: 1 }, statuslineItems: { cost: false, duration: false } });
    r = cli('--enable', 'cost');
    assert.strictEqual(r.status, 0, r.err);
    assert.deepStrictEqual(readJson(globalFile()).statuslineItems, { cost: true, duration: false });
    assert.ok(!fs.existsSync(projectFile()), 'no project file without --project');
  });

  it('--reset ids removes them; --reset alone removes the key', () => {
    cli('--disable', 'cost,duration,version');
    cli('--reset', 'cost');
    assert.deepStrictEqual(readJson(globalFile()).statuslineItems, { duration: false, version: false });
    const r = cli('--reset');
    assert.match(r.out, /all items/);
    assert.deepStrictEqual(readJson(globalFile()), {});
  });

  it('--project writes the project file; --list shows where each value comes from', () => {
    cli('--disable', 'version,cost');
    assert.strictEqual(cli('--project', '--enable', 'cost').status, 0);
    assert.deepStrictEqual(readJson(projectFile()).statuslineItems, { cost: true });
    const list = JSON.parse(cli('--list', '--json').out);
    const byId = Object.fromEntries(list.items.map((i) => [i.id, i]));
    assert.deepStrictEqual([byId.cost.on, byId.cost.source], [true, 'project']);
    assert.deepStrictEqual([byId.version.on, byId.version.source], [false, 'global']);
    assert.deepStrictEqual([byId.model.on, byId.model.source], [true, 'default']);
    assert.strictEqual(byId.version.shownInMode, false);
  });

  it('--project <dir> targets that dir', () => {
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    assert.strictEqual(cli('--disable', 'git', '--project', other).status, 0);
    assert.deepStrictEqual(readJson(path.join(other, '.claude', '.rig.json')), { statuslineItems: { git: false } });
  });

  it('notes a project override when a global change will not show here', () => {
    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(projectFile(), JSON.stringify({ statuslineItems: { cost: true } }));
    assert.match(cli('--disable', 'cost').out, /also sets cost and wins in this project/);
  });

  it('text list groups items by row with descriptions and the mode', () => {
    const r = cli();
    assert.strictEqual(r.status, 0);
    assert.match(r.out, /Statusline mode: full/);
    assert.match(r.out, /SESSION ROW[\s\S]*WORKSPACE ROW[\s\S]*ACTIVITY ROW/);
    assert.match(r.out, /on {2}limit-5h/);
    assert.match(r.out, /5-hour plan usage/);
  });

  it('refuses unknown ids, bad flags and two verbs with exit 2, writing nothing', () => {
    for (const argv of [['--disable', 'bogus'], ['--disable'], ['--enable', 'cost', '--disable', 'git'], ['--enable', 'cost', '--json'], ['--nope']]) {
      const r = cli(...argv);
      assert.strictEqual(r.status, 2, argv.join(' '));
      assert.match(r.err, /Usage: rig-statusline/);
    }
    assert.match(cli('--disable', 'bogus').err, /unknown item bogus; items: model, agent/);
    assert.ok(!fs.existsSync(globalFile()));
  });

  it('never rewrites an unparsable or non-object config', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    for (const text of ['{bad', '[1]']) {
      fs.writeFileSync(globalFile(), text);
      const r = cli('--disable', 'cost');
      assert.strictEqual(r.status, 1);
      assert.match(r.err, /nothing was changed/);
      assert.strictEqual(fs.readFileSync(globalFile(), 'utf8'), text);
    }
  });

  it('--preview renders the real statusline with the settings applied', () => {
    cli('--disable', 'version');
    const r = cli('--preview');
    assert.strictEqual(r.status, 0, r.err);
    assert.match(r.out, /Opus 5\.5/);
    assert.match(r.out, /\$0\.420/);
    assert.doesNotMatch(r.out, /v2\.1\.330/);
    assert.match(r.out, /Sample data/);
  });

  it('the bin runs by name with --help', () => {
    const res = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'bin', 'rig-statusline'), '--help'], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /Usage: rig-statusline/);
  });
});

describe('rig-statusline file handling (review fixes)', () => {
  it('a broken project file does not fail a global write, and --list warns and goes on', () => {
    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(projectFile(), '{bad');
    const w = cli('--disable', 'cost');
    assert.strictEqual(w.status, 0, w.err);
    assert.deepStrictEqual(readJson(globalFile()).statuslineItems, { cost: false });
    const l = cli('--list', '--json');
    assert.strictEqual(l.status, 0, l.err);
    assert.match(l.err, /warning: .*not valid JSON.*ignored/);
    assert.strictEqual(JSON.parse(l.out).items.find((i) => i.id === 'cost').on, false);
  });

  it('follows a symlinked config and keeps its file mode', { skip: process.platform === 'win32' }, () => {
    const real = path.join(root, 'dotfiles-rig.json');
    fs.writeFileSync(real, JSON.stringify({ statusline: 'full' }), { mode: 0o600 });
    fs.chmodSync(real, 0o600);
    fs.mkdirSync(path.join(home, '.claude'));
    fs.symlinkSync(real, globalFile());
    assert.strictEqual(cli('--disable', 'cost').status, 0);
    assert.ok(fs.lstatSync(globalFile()).isSymbolicLink(), 'the link stays a link');
    assert.deepStrictEqual(readJson(real), { statusline: 'full', statuslineItems: { cost: false } });
    assert.strictEqual(fs.statSync(real).mode & 0o777, 0o600);
    assert.deepStrictEqual(fs.readdirSync(root).filter((f) => f.includes('.tmp-')), [], 'no temp file left');
  });

  it('a no-op change writes nothing', () => {
    assert.match(cli('--reset').out, /already so/);
    assert.ok(!fs.existsSync(globalFile()), 'reset on a missing file creates nothing');
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(globalFile(), '{"statusline":"full"}');
    cli('--reset');
    assert.strictEqual(fs.readFileSync(globalFile(), 'utf8'), '{"statusline":"full"}', 'not reformatted');
  });

  it('rejects empty ids and a repeated verb', () => {
    for (const argv of [['--enable', ','], ['--disable', ' '], ['--disable', 'cost', '--disable', 'git']]) {
      assert.strictEqual(cli(...argv).status, 2, argv.join(' '));
    }
    assert.match(cli('--disable', 'cost', '--disable', 'git').err, /give --disable once/);
  });

  it('in the home dir there is no project: values are global and --project is refused', () => {
    cwd = home;
    cli('--disable', 'cost');
    const l = JSON.parse(cli('--list', '--json').out);
    assert.strictEqual(l.items.find((i) => i.id === 'cost').source, 'global');
    assert.doesNotMatch(cli('--disable', 'version').out, /Note:/);
    const r = cli('--project', '--disable', 'git');
    assert.strictEqual(r.status, 2);
    assert.match(r.err, /global file/);
    assert.strictEqual(cli('--project', '--list', '--json').status, 0, 'listing from the home dir still works');
  });

  it('an unknown mode is listed as full, as the statusline renders it', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(globalFile(), JSON.stringify({ statusline: 'tiny' }));
    const l = JSON.parse(cli('--list', '--json').out);
    assert.strictEqual(l.mode, 'full');
    assert.ok(l.items.every((i) => i.shownInMode));
  });

  it('a bare --project uses CLAUDE_PROJECT_DIR when set', () => {
    const proj = path.join(root, 'session-proj');
    fs.mkdirSync(proj);
    extraEnv = { CLAUDE_PROJECT_DIR: proj };
    assert.strictEqual(cli('--project', '--disable', 'plan').status, 0);
    assert.deepStrictEqual(readJson(path.join(proj, '.claude', '.rig.json')).statuslineItems, { plan: false });
    assert.ok(!fs.existsSync(projectFile()));
  });
});
