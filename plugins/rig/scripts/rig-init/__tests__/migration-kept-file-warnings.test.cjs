#!/usr/bin/env node
/** Tests for the read-only warnings about kept files: CLAUDE.md references to moved paths, kept skills shadowing plugin skills. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keptFileWarnings, movedPathsReferenced, pluginSkillNames, skillName } = require('../migration-kept-file-warnings.cjs');
const { planTarget, describeTarget } = require('../migration-planner.cjs');
const { makeMachine } = require('./rig-init-fixtures.cjs');

const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const moves = ['rules/primary-workflow.md', 'rules/development-rules.md', 'skills/fix/SKILL.md', 'skills/fix/references/a.md', 'statusline.cjs']
  .map((rel) => ({ rel, type: 'file' })).concat([{ rel: 'hooks/.logs', type: 'dir' }]);
const GLOBAL = { kind: 'global', home: '/home/u', root: '/home/u' };
const PROJECT = { kind: 'project', root: '/work/app' };

describe('movedPathsReferenced', () => {
  it('reports each distinct reference once, with how many moved files it covers', () => {
    const text = [
      '- Primary: `$HOME/.claude/rules/primary-workflow.md`',
      '- Dev: ~/.claude/rules/development-rules.md, also $HOME/.claude/rules/development-rules.md',
      '- All: `$HOME/.claude/rules/*`',
      'Scripts in $HOME/.claude/skills/.',
      'Unrelated: ~/.claude/settings.json and ~/.claude/rules/my-own.md',
      'Project-relative, not this target: .claude/statusline.cjs',
    ].join('\n');
    assert.deepStrictEqual(movedPathsReferenced(text, moves, GLOBAL), [
      { ref: 'rules/primary-workflow.md', moved: 1 },
      { ref: 'rules/development-rules.md', moved: 1 },
      { ref: 'rules/*', moved: 2 },
      { ref: 'skills/', moved: 2 },
    ]);
  });
  it('returns nothing for a CLAUDE.md without moved references', () => {
    assert.deepStrictEqual(movedPathsReferenced('Run `rig-python x.py`. See ~/.claude/settings.json', moves, GLOBAL), []);
  });
  it('matches only references that point at the target install', () => {
    const text = 'Global: ~/.claude/statusline.cjs. Project: .claude/rules/primary-workflow.md and /work/app/.claude/statusline.cjs. Elsewhere: /srv/x/.claude/statusline.cjs';
    assert.deepStrictEqual(movedPathsReferenced(text, moves, GLOBAL), [{ ref: 'statusline.cjs', moved: 1 }]);
    assert.deepStrictEqual(movedPathsReferenced(text, moves, PROJECT), [{ ref: 'rules/primary-workflow.md', moved: 1 }, { ref: 'statusline.cjs', moved: 1 }]);
    assert.deepStrictEqual(movedPathsReferenced('$HOME/.claude/rules/x.md and C:\\Users\\u\\.claude\\statusline.cjs', moves, { kind: 'global', home: 'C:\\Users\\u' }).map((r) => r.ref), ['statusline.cjs']);
  });
  it('counts a file inside a moved directory, and survives long punctuation runs', () => {
    assert.deepStrictEqual(movedPathsReferenced('See ~/.claude/hooks/.logs/hook-log.jsonl', moves, GLOBAL), [{ ref: 'hooks/.logs/hook-log.jsonl', moved: 1 }]);
    const t0 = Date.now();
    movedPathsReferenced(`~/.claude/x${'.'.repeat(40000)}`, moves, GLOBAL);
    assert.ok(Date.now() - t0 < 500, 'linear trailing trim');
  });
});

describe('keptFileWarnings', () => {
  function target(claudeMd, skills = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-kept-warn-'));
    dirs.push(root);
    const claudeDir = path.join(root, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    if (claudeMd !== null) fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), claudeMd);
    for (const [dir, name] of Object.entries(skills)) {
      fs.mkdirSync(path.join(claudeDir, 'skills', dir), { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'skills', dir, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\nbody\n`);
    }
    return { kind: 'global', root, claudeDir, moves };
  }
  const pluginSkills = new Set(['rig:mcp', 'rig:fix']);

  it('warns about a CLAUDE.md that points at moved rules and about a kept skill named like a plugin skill', () => {
    const plan = target('Rules: `$HOME/.claude/rules/primary-workflow.md`\n', { 'rig-mcp': 'rig:mcp', mine: 'my-tool' });
    plan.claudeDir = path.join(plan.root, '.claude'); // global target: home = parent of claudeDir
    const w = keptFileWarnings(plan, { pluginSkills });
    assert.strictEqual(w.length, 2);
    assert.match(w[0], /CLAUDE\.md refers to 1 path\(s\) this migration moves: rules\/primary-workflow\.md\. Edit it/);
    assert.match(w[1], /kept skill skills\/rig-mcp is named rig:mcp/);
  });
  it('skips a skill the migration moves, and stays quiet without CLAUDE.md or collisions', () => {
    assert.deepStrictEqual(keptFileWarnings(target(null, { fix: 'rig:fix', mine: 'my-tool' }), { pluginSkills }), []);
  });
  it('plugin skill names come from the plugin skills dir as rig:<name>', () => {
    const names = pluginSkillNames();
    for (const n of ['rig:git', 'rig:mcp', 'rig:debug']) assert.ok(names.has(n), n);
    assert.strictEqual(skillName('---\nname: "rig:mcp"\n---\n'), 'rig:mcp');
    assert.strictEqual(skillName('\uFEFF---\r\nname: rig:mcp # old copy\r\n---\r\n'), 'rig:mcp');
  });
});

describe('planner integration', () => {
  it('a 1.x global install whose CLAUDE.md lists the rules files gets the warning in the plan text and JSON field', () => {
    const m = makeMachine({ project: false });
    dirs.push(m.root);
    const claudeDir = path.join(m.home, '.claude');
    fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), '- Workflows: `$HOME/.claude/rules/*`\n');
    const plan = planTarget({ kind: 'global', root: m.home, home: m.home });
    assert.ok(plan.moves.some((mv) => mv.rel.startsWith('rules/')), 'fixture has 1.x rules files');
    assert.ok(plan.warnings.some((w) => /refers to 1 path\(s\) this migration moves: rules\/\* \(\d+ files\)/.test(w)), plan.warnings.join('\n'));
    assert.match(describeTarget(plan), /\n {2}warning: .*CLAUDE\.md refers to/);
  });
});

describe('project target', () => {
  it('reads each real CLAUDE.md once when the project has a symlinked second copy', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-kept-proj-'));
    dirs.push(root);
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'See .claude/statusline.cjs\n');
    try { fs.symlinkSync(path.join(root, 'CLAUDE.md'), path.join(root, '.claude', 'CLAUDE.md')); } catch (e) { t.skip(`no symlink (${e.code})`); return; }
    const w = keptFileWarnings({ kind: 'project', root, claudeDir: path.join(root, '.claude'), moves }, { pluginSkills: new Set() });
    assert.strictEqual(w.length, 1, w.join('\n'));
  });
});
