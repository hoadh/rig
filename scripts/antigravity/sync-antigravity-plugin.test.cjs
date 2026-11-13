// Run: node --test scripts/antigravity/sync-antigravity-plugin.test.cjs
// Builds a small fake repo in a temp dir and runs the generator on it (the real adapter files are not needed).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generate, checkFresh, checkLeftoversOnDisk, assertSafeOutDir } = require('../sync-antigravity-plugin.cjs');
const { gitTrackedFiles } = require('./build-antigravity-plugin.cjs');
const { collectHookFiles } = require('./hook-files-collector.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-agy-gen-'));
const root = path.join(tmp, 'repo');
const out = path.join(tmp, 'out');
const write = (rel, text, base = root) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); };
const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(out, rel));

function walk(dir, base = dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc.sort();
}
// The fake repo is not a git repo: list files by walking.
const listFiles = (r, prefix) => walk(path.join(r, prefix), r);

function buildFakeRepo() {
  const P = 'plugins/rig';
  write(`${P}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'rig', version: '2.5.1', description: 'Rig toolkit for Claude Code: things', license: 'MIT', homepage: 'https://example.com', repository: 'https://example.com/r' }));
  write(`${P}/skills/plan/SKILL.md`, '---\nname: rig:plan\ndescription: "Plan it"\ncontext: fork\neffort: high\n---\n\nRun `rig-set-active-plan {plan-dir}` and `python scripts/x.py`; see /rig:fix and plugins/rig/rules/core-rules.md\n');
  write(`${P}/skills/plan/scripts/x.py`, 'print("hi")\n# rig-resolve-env keeps its line\nprint(".claude/x")\n');
  write(`${P}/skills/plan/package.json`, '{ "scripts": { "start": "node plugins/rig/skills/plan/s.js" } }\n');
  write(`${P}/skills/fix/SKILL.md`, '---\nname: fix\ndescription: Fix it\n---\n\nbody\n');
  write(`${P}/skills/remote/SKILL.md`, '---\nname: remote\ndescription: remote\n---\n\nbody\n');
  write(`${P}/skills/team/SKILL.md`, '---\nname: team\ndescription: team\n---\n\nbody\n');
  write(`${P}/agents/planner.md`, '---\nname: planner\ndescription: Plans\nmodel: opus\ntools: Glob, Grep\nskills:\n  - rig:plan\n---\n\nPlanner body, load rig:plan\n');
  write(`${P}/rules/core-rules.md`, '# Core Rules\n\n## Principles\n\n- Use /rig:plan, see CLAUDE.md\n');
  write(`${P}/bin/rig-worktree`, '#!/bin/sh\n');
  for (const f of ['validate-docs', 'docs-diataxis-layout', 'migrate-docs-to-diataxis-layout', 'migrate-docs-custom-move-map-parser', 'migrate-docs-link-rewrite-helpers']) write(`${P}/scripts/${f}.cjs`, `// ${f}\n`);
  write(`${P}/hooks/session-init.cjs`, "const a = require('./lib/a.cjs');\nconst p = process.env.CLAUDE_PLUGIN_DATA; // .claude/.rig.json\n");
  write(`${P}/hooks/other-hook.cjs`, '// not ported\n');
  write(`${P}/hooks/lib/a.cjs`, "module.exports = require('./b.cjs');\ntry { require('../../scripts/venv-resolver.cjs'); } catch {}\n");
  write(`${P}/hooks/lib/b.cjs`, '// b\n');
  write(`${P}/hooks/lib/unused.cjs`, '// unused\n');
  write(`${P}/scripts/venv-resolver.cjs`, '// venv\n');
  const A = 'scripts/antigravity';
  write(`${A}/agy-version.json`, '{ "n": 2 }');
  write(`${A}/claude-code-concepts-in-antigravity.md`, '# Claude Code Concepts in Antigravity\n\n## Tools\n\nSendMessage is not available.\n');
  write(`${A}/hooks/antigravity-hooks-json.cjs`, "module.exports = { hooksJson: { hooks: { SessionStart: [] } }, portedHooks: ['session-init'] };\n");
  write(`${A}/hooks/adapter.cjs`, "// adapter .claude/ and CLAUDE_PLUGIN_DATA are fine here\nrequire('./lib/adapter-only.cjs');\n");
  write(`${P}/hooks/lib/adapter-only.cjs`, '// required only by the adapter\n');
  write(`${A}/hooks/adapter.test.cjs`, '// test\n');
  write(`${A}/scripts/set-active-plan-antigravity.cjs`, '// sets plan\n');
}

before(buildFakeRepo);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('generate', () => {
  it('writes the plugin layout with manifest, rules, readme', () => {
    generate({ root, outDir: out, listFiles });
    const manifest = JSON.parse(read('.antigravity-plugin/plugin.json'));
    assert.strictEqual(manifest.name, 'rig');
    assert.strictEqual(manifest.version, '2.5.1-agy.2');
    assert.match(manifest.description, /for Antigravity/);
    assert.deepStrictEqual([manifest.license, manifest.homepage, manifest.repository], ['MIT', 'https://example.com', 'https://example.com/r']);
    assert.match(read('rules/AGENTS.md'), /^# Rig for Antigravity[\s\S]*### Principles[\s\S]*Use \/plan, see AGENTS\.md[\s\S]*## Rig root[\s\S]*## Claude Code Concepts in Antigravity/);
    assert.match(read('README.md'), /tree\/v2\.5\.1\/antigravity\/rig/);
    assert.deepStrictEqual(JSON.parse(read('hooks.json')), { hooks: { SessionStart: [] } });
  });

  it('skill folder name equals the skill name; Claude-only skills are absent; text and frontmatter are rewritten', () => {
    assert.ok(exists('skills/plan/SKILL.md') && exists('skills/fix/SKILL.md') && exists('skills/plan/scripts/x.py'));
    assert.ok(!exists('skills/remote') && !exists('skills/team'));
    const md = read('skills/plan/SKILL.md');
    assert.match(md, /^---\nname: plan\ndescription: "Plan it"\n---/);
    assert.match(md, /node <Rig root>\/scripts\/set-active-plan-antigravity\.cjs \{plan-dir\}/);
    assert.match(md, /python <Rig root>\/skills\/plan\/scripts\/x\.py/);
    assert.match(md, /see \/fix and <Rig root>\/rules\/core-rules\.md/);
  });

  it('code and manifests are copied byte for byte; only Markdown is rewritten', () => {
    for (const rel of ['skills/plan/scripts/x.py', 'skills/plan/package.json']) {
      assert.ok(fs.readFileSync(path.join(root, 'plugins/rig', rel)).equals(fs.readFileSync(path.join(out, rel))), rel);
    }
  });

  it('agents get native frontmatter', () => {
    assert.strictEqual(read('agents/planner.md'), '---\nname: planner\ndescription: Plans\nmodel: inherit\nskills:\n  - plan\ntools:\n  - find_by_name\n  - grep_search\nsubagent: true\nmainAgent: false\n---\n\nPlanner body, load plan\n');
  });

  it('copies ported hooks and their require graph byte for byte, nothing else', () => {
    assert.deepStrictEqual(walk(path.join(out, 'hooks')), ['adapter.cjs', 'lib/a.cjs', 'lib/adapter-only.cjs', 'lib/b.cjs', 'session-init.cjs']);
    assert.ok(exists('scripts/venv-resolver.cjs') && exists('scripts/set-active-plan-antigravity.cjs') && exists('scripts/validate-docs.cjs'));
    for (const rel of ['hooks/session-init.cjs', 'hooks/lib/a.cjs']) {
      assert.ok(fs.readFileSync(path.join(root, 'plugins/rig', rel)).equals(fs.readFileSync(path.join(out, rel))), rel);
    }
    assert.ok(!exists('hooks/antigravity-hooks-json.cjs') && !exists('hooks/adapter.test.cjs') && !exists('hooks/other-hook.cjs'));
  });

  it('is deterministic and removes stale or hand-added files', () => {
    write('hand-added.md', 'x', out);
    write('skills/plan/stale.md', 'x', out);
    assert.strictEqual(checkFresh({ root, outDir: out, listFiles }).stale, true);
    const before = walk(out).filter((f) => !['hand-added.md', 'skills/plan/stale.md'].includes(f));
    generate({ root, outDir: out, listFiles });
    assert.ok(!exists('hand-added.md') && !exists('skills/plan/stale.md'));
    assert.deepStrictEqual(walk(out), before);
    assert.deepStrictEqual(checkFresh({ root, outDir: out, listFiles }), { stale: false, report: [] });
  });

  it('checkFresh reports changed and missing files', () => {
    write('skills/fix/SKILL.md', 'edited', out);
    fs.rmSync(path.join(out, 'README.md'));
    const { stale, report } = checkFresh({ root, outDir: out, listFiles });
    assert.ok(stale);
    assert.deepStrictEqual(report.sort(), ['changed  skills/fix/SKILL.md', 'missing  README.md']);
    generate({ root, outDir: out, listFiles });
  });

  it('fails on a Claude Code-only leftover and leaves the output untouched', () => {
    write('plugins/rig/skills/fix/SKILL.md', '---\nname: fix\ndescription: Fix it\n---\n\nSee ${CLAUDE_SKILL_DIR}x and TeamCreate and `rig-init`\n');
    const before = read('skills/fix/SKILL.md');
    assert.throws(() => generate({ root, outDir: out, listFiles }), /Claude Code-only reference/);
    assert.strictEqual(read('skills/fix/SKILL.md'), before);
    write('plugins/rig/skills/fix/SKILL.md', '---\nname: fix\ndescription: Fix it\n---\n\nbody\n');
  });

  it('fails when the adapter module has the wrong shape', () => {
    const good = fs.readFileSync(path.join(root, 'scripts/antigravity/hooks/antigravity-hooks-json.cjs'), 'utf8');
    write('scripts/antigravity/hooks/antigravity-hooks-json.cjs', 'module.exports = {};\n');
    assert.throws(() => generate({ root, outDir: out, listFiles }), /must export/);
    write('scripts/antigravity/hooks/antigravity-hooks-json.cjs', good);
  });
});

describe('L11: generator input and --check-leftovers --out', () => {
  it('ships only tracked adapter files: an untracked local .cjs in the adapter dirs is left out', () => {
    const repo = path.join(tmp, 'git-repo');
    fs.cpSync(root, repo, { recursive: true });
    const { execFileSync } = require('child_process');
    const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('add', '-A');
    write('scripts/antigravity/hooks/local-experiment.cjs', '// untracked\n', repo);
    write('scripts/antigravity/scripts/local-tool.cjs', '// untracked\n', repo);
    const gitOut = path.join(tmp, 'git-out');
    generate({ root: repo, outDir: gitOut, listFiles: gitTrackedFiles });
    assert.ok(fs.existsSync(path.join(gitOut, 'hooks', 'adapter.cjs')), 'tracked adapter file ships');
    assert.ok(fs.existsSync(path.join(gitOut, 'scripts', 'set-active-plan-antigravity.cjs')), 'tracked adapter script ships');
    assert.ok(!fs.existsSync(path.join(gitOut, 'hooks', 'local-experiment.cjs')), 'untracked hook stays out');
    assert.ok(!fs.existsSync(path.join(gitOut, 'scripts', 'local-tool.cjs')), 'untracked script stays out');
  });

  it('checkLeftoversOnDisk checks the files in outDir, not antigravity/rig', () => {
    const alt = path.join(tmp, 'alt-out');
    generate({ root, outDir: alt, listFiles });
    assert.doesNotThrow(() => checkLeftoversOnDisk({ root, outDir: alt, listFiles }));
    write('skills/plan/extra.md', 'Uses ${CLAUDE_PLUGIN_ROOT}/x\n', alt);
    assert.throws(() => checkLeftoversOnDisk({ root, outDir: alt, listFiles }), /leftover|Claude Code-only|CLAUDE_PLUGIN_ROOT/i);
    assert.throws(() => checkLeftoversOnDisk({ root, outDir: path.join(tmp, 'no-such-out'), listFiles }), /missing or empty/, 'reviewer L-d');
  });
});

describe('assertSafeOutDir', () => {
  it('refuses the repo root, its ancestors, foreign non-empty dirs and files; accepts new, empty and previous outputs', () => {
    assert.throws(() => assertSafeOutDir(root, root), /repo root or an ancestor/);
    assert.throws(() => assertSafeOutDir(tmp, root), /repo root or an ancestor/);
    assert.throws(() => assertSafeOutDir(path.parse(root).root, root), /repo root or an ancestor/);
    const foreign = path.join(tmp, 'foreign');
    write('keep.txt', 'x', foreign);
    assert.throws(() => assertSafeOutDir(foreign, root), /not a previous Antigravity plugin output/);
    assert.throws(() => generate({ root, outDir: foreign, listFiles }), /refusing to delete/);
    assert.ok(fs.existsSync(path.join(foreign, 'keep.txt')), 'foreign dir untouched');
    fs.writeFileSync(path.join(tmp, 'afile'), 'x');
    assert.throws(() => assertSafeOutDir(path.join(tmp, 'afile'), root), /not a directory/);
    fs.mkdirSync(path.join(tmp, 'empty'));
    assertSafeOutDir(path.join(tmp, 'empty'), root);
    assertSafeOutDir(path.join(tmp, 'nope'), root);
    assertSafeOutDir(out, root);
  });
});

describe('collectHookFiles', () => {
  it('fails on a missing ported hook', () => {
    assert.throws(() => collectHookFiles(path.join(root, 'plugins/rig'), ['nope']), /ported hook not found/);
  });
});
