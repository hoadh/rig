#!/usr/bin/env node
/**
 * Upgrade path of the file installer: a project that holds a v1.1.0 install gets the 2.0 kit (plugins/rig ->
 * .claude) without stale skills, with `rig:`-prefixed skill names, a metadata.json version, non-duplicated
 * hooks, and nothing from the repo's dev-only `.claude/`.
 * Run: node --test scripts/install-kit/file-install-upgrade-from-v1.1.test.cjs
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { buildCopyPlan, prefixSkillName } = require('./kit-source-file-list-and-copy-plan.cjs');
const { readRigVersion } = require('../../plugins/rig/skills/remote/scripts/worker-commands/info-command.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'v1.1.0-installed-project');
const tmpDirs = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
};

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const hookCommands = (settings) => Object.values(settings.hooks).flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));

describe('upgrade from a v1.1.0 file install', () => {
  const project = tmp('rig-upgrade-');
  fs.cpSync(FIXTURE, project, { recursive: true });
  const before = JSON.parse(fs.readFileSync(path.join(project, '.claude', 'settings.json'), 'utf8'));
  const res = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'install-kit-from-local-repo.cjs'), '--dir', project, '--yes'], { encoding: 'utf8' });
  const claude = path.join(project, '.claude');

  it('the installer succeeds', () => {
    assert.strictEqual(res.status, 0, res.stderr + res.stdout);
  });

  it('the fixture really holds the 1.1 skills before the upgrade', () => {
    assert.ok(fs.existsSync(path.join(FIXTURE, '.claude', 'skills', 'rig-plan', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(FIXTURE, '.claude', 'skills', 'rig-debug', 'references', 'verification.md')));
  });

  it('leaves no rig-plan or rig-debug skill files behind', () => {
    const leftovers = walk(claude).filter((f) => /[\\/]skills[\\/]rig-(plan|debug)[\\/]/.test(f));
    assert.deepStrictEqual(leftovers, []);
    assert.ok(fs.existsSync(path.join(claude, 'skills', 'plan', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(claude, 'skills', 'debug', 'SKILL.md')));
  });

  it('every installed skill name carries the rig: prefix (and the plugin source stays unprefixed)', () => {
    const skills = fs.readdirSync(path.join(claude, 'skills')).filter((d) => fs.existsSync(path.join(claude, 'skills', d, 'SKILL.md')));
    assert.ok(skills.length > 20);
    for (const dir of skills) {
      const name = /^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(claude, 'skills', dir, 'SKILL.md'), 'utf8'));
      assert.strictEqual(name && name[1], `rig:${dir}`, dir);
      const src = /^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(REPO, 'plugins', 'rig', 'skills', dir, 'SKILL.md'), 'utf8'));
      assert.strictEqual(src && src[1], dir, `plugin source ${dir} must stay unprefixed`);
    }
  });

  it('merges the generated settings (permissions template, statusline) into the existing file', () => {
    assert.match(res.stdout, /settings\.json: /);
    const after = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const template = JSON.parse(fs.readFileSync(path.join(REPO, 'plugins', 'rig', 'file-install-settings-template.json'), 'utf8'));
    for (const rule of template.permissions.ask) assert.ok(after.permissions.ask.includes(rule), rule);
    assert.ok(after.statusLine && /statusline\.cjs/.test(after.statusLine.command));
  });

  it('does not duplicate hook registrations', () => {
    const after = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const cmds = hookCommands(after);
    assert.strictEqual(new Set(cmds).size, cmds.length, 'no command registered twice');
    assert.deepStrictEqual([...new Set(cmds)].sort(), [...new Set(hookCommands(before))].sort(), 'same hooks as the 1.1 install');
    for (const [event, entries] of Object.entries(after.hooks)) assert.strictEqual(entries.length, before.hooks[event].length, event);
  });

  it('writes metadata.json with name and version from plugin.json, and remote info reads it', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(claude, 'metadata.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(REPO, 'plugins', 'rig', '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.deepStrictEqual(meta, { name: plugin.name, version: plugin.version });
    assert.strictEqual(readRigVersion(claude), plugin.version, 'a file install never reports "unknown"');
  });

  it('ships no plugin-only files', () => {
    assert.ok(!fs.existsSync(path.join(claude, 'hooks', 'hooks.json')));
    assert.ok(!fs.existsSync(path.join(claude, '.claude-plugin')));
    assert.ok(!fs.existsSync(path.join(claude, 'file-install-settings-template.json')));
  });
});

describe('remote version without a manifest', () => {
  it('reads plugin.json first, then metadata.json, else unknown', () => {
    const d = tmp('rig-version-');
    assert.strictEqual(readRigVersion(d), 'unknown');
    fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({ version: '1.2.3' }));
    assert.strictEqual(readRigVersion(d), '1.2.3');
    fs.mkdirSync(path.join(d, '.claude-plugin'));
    fs.writeFileSync(path.join(d, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '9.9.9' }));
    assert.strictEqual(readRigVersion(d), '9.9.9');
  });
});

describe('prefixSkillName', () => {
  it('prefixes only the frontmatter name, once', () => {
    assert.strictEqual(prefixSkillName('---\nname: plan\ndescription: x\n---\nname: body\n'), '---\nname: rig:plan\ndescription: x\n---\nname: body\n');
    assert.strictEqual(prefixSkillName('---\nname: rig:plan\n---\n'), '---\nname: rig:plan\n---\n');
    assert.strictEqual(prefixSkillName('---\r\nname: fix\r\n---\r\n'), '---\r\nname: rig:fix\r\n---\r\n');
  });
});

describe('the repo dev-only .claude/ never ships', () => {
  /** A throwaway kit repo with dev-only files next to the shipped templates. */
  function fakeKit() {
    const kit = tmp('rig-fake-kit-');
    const put = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
      fs.writeFileSync(path.join(kit, rel), text);
    };
    put('plugins/rig/.claude-plugin/plugin.json', JSON.stringify({ name: 'rig', version: '3.0.0' }));
    put('plugins/rig/hooks/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/s.cjs'] }] }] } }));
    put('plugins/rig/hooks/s.cjs', '');
    put('plugins/rig/file-install-settings-template.json', JSON.stringify({ permissions: { ask: ['Read(**/.env)'] } }));
    put('plugins/rig/skills/x/SKILL.md', '---\nname: x\n---\n');
    put('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(rm -rf /)'] }, env: { DEV_ONLY: '1' }, hooks: {} }));
    put('.claude/CLAUDE.md', 'dev notes');
    put('.claude/agents/dev-only-agent.md', 'dev agent');
    put('.claude/rules/dev-rule.md', 'dev rule');
    put('.claude/.rig.json', '{}');
    put('.claude/.env.example', 'A=');
    execFileSync('git', ['init', '-q'], { cwd: kit });
    return kit;
  }

  it('copies only the template allowlist from the repo .claude/ and builds settings from the shipped template', () => {
    const kit = fakeKit();
    const target = tmp('rig-fake-target-');
    const plan = buildCopyPlan({ kitRoot: kit, targetRoot: target, isGlobal: false, fs });
    const dests = plan.map((i) => path.relative(target, i.dest).split(path.sep).join('/')).sort();
    assert.deepStrictEqual(dests, ['.claude/.env.example', '.claude/.rig.json', '.claude/hooks/s.cjs', '.claude/metadata.json', '.claude/settings.json', '.claude/skills/x/SKILL.md']);
    const settings = JSON.parse(plan.find((i) => i.kind === 'settings').content);
    assert.deepStrictEqual(settings.permissions, { ask: ['Read(**/.env)'] });
    assert.strictEqual(settings.permissions.allow, undefined);
    assert.strictEqual(settings.env, undefined, 'dev env never ships');
  });
});
