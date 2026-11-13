#!/usr/bin/env node
/** Tests for plugin-copy-detector.cjs: isPluginCopy and the one-line notice about a leftover Rig 1.x install. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { find1xCopies, rig1xHooksNotice, isPluginCopy } = require('../plugin-copy-detector.cjs');

const PLUGIN_HOOK = path.join(__dirname, '..', '..', 'session-init.cjs');

const roots = [];
const mk = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-notice-'))); roots.push(d); return d; };
after(() => roots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const touch = (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '// hook\n'); };
const SENTINEL = ['.claude', 'hooks', 'session-init.cjs'];
// A Rig 1.x install marker beside the hook: without it the file belongs to another kit
const marked = (root) => touch(path.join(root, '.claude', 'hooks', 'lib', 'rig-config-utils.cjs'));

describe('isPluginCopy', () => {
  it('is true in plugins/rig and false in a copy without .claude-plugin (the generated Antigravity plugin)', () => {
    assert.strictEqual(isPluginCopy(PLUGIN_HOOK), true);
    const root = mk();
    touch(path.join(root, 'agy', 'hooks', 'session-init.cjs'));
    assert.strictEqual(isPluginCopy(path.join(root, 'agy', 'hooks', 'session-init.cjs')), false);
    touch(path.join(root, 'agy', '.antigravity-plugin', 'plugin.json'));
    assert.strictEqual(isPluginCopy(path.join(root, 'agy', 'hooks', 'session-init.cjs')), false);
  });
});

describe('rig1xHooksNotice', () => {
  it('is empty without a 1.x copy', () => {
    const root = mk();
    assert.strictEqual(rig1xHooksNotice({ self: path.join(root, 'plugin', 'hooks', 'session-init.cjs'), home: path.join(root, 'home'), projectDir: path.join(root, 'proj') }), '');
  });

  it('names the global and the project copy, says hooks run twice, and points at the 2.0.10 route (no rig-init command)', () => {
    const root = mk();
    touch(path.join(root, 'home', ...SENTINEL));
    touch(path.join(root, 'proj', ...SENTINEL));
    marked(path.join(root, 'home'));
    fs.writeFileSync(path.join(root, 'proj', '.claude', 'metadata.json'), '{"name":"rig"}');
    const opts = { self: path.join(root, 'plugin', 'hooks', 'session-init.cjs'), home: path.join(root, 'home'), projectDir: path.join(root, 'proj') };
    assert.deepStrictEqual(find1xCopies(opts), ['global', 'project']);
    const notice = rig1xHooksNotice(opts);
    assert.match(notice, /~\/\.claude and this project \.claude[\s\S]*runs twice[\s\S]*Rig 2\.0\.10: https:\/\/github\.com\/hoadh\/rig\/blob\/main\/docs\/how-to\/migrate-from-rig-1x\.md/);
    assert.doesNotMatch(notice, /--migrate/);
  });

  it('does not count the hook file that is running as a 1.x copy, and a project that is the home dir counts once', () => {
    const root = mk();
    const self = path.join(root, 'home', ...SENTINEL);
    touch(self);
    marked(path.join(root, 'home'));
    assert.deepStrictEqual(find1xCopies({ self, home: path.join(root, 'home'), projectDir: path.join(root, 'proj') }), []);
    touch(path.join(root, 'other', ...SENTINEL));
    marked(path.join(root, 'other'));
    assert.deepStrictEqual(find1xCopies({ self: path.join(root, 'p', 'x.cjs'), home: path.join(root, 'other'), projectDir: path.join(root, 'other') }), ['global']);
  });
});

describe('Rig identity marker', () => {
  it('stays silent for another kit that ships the same hook name (no Rig marker)', () => {
    const root = mk();
    touch(path.join(root, 'home', ...SENTINEL));
    fs.writeFileSync(path.join(root, 'home', '.claude', 'metadata.json'), '{"name":"claudekit-engineer"}');
    const opts = { self: path.join(root, 'plugin', 'hooks', 'session-init.cjs'), home: path.join(root, 'home'), projectDir: path.join(root, 'proj') };
    assert.deepStrictEqual(find1xCopies(opts), []);
    assert.strictEqual(rig1xHooksNotice(opts), '');
  });
});

describe('no 1.x dedupe or 1.x reads left in the plugin (2.1.0)', () => {
  const PLUGIN = path.join(__dirname, '..', '..', '..');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.venv', '__tests__', 'tests', '.logs'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(c?js|mjs)$/.test(e.name)) files.push(full);
    }
  };
  walk(PLUGIN);

  it('no yieldsToProjectCopy, yieldTarget, GLOBAL_COPY_NOTICE or global-hook-yields-to-project-copy', () => {
    const hits = files.filter((f) => /yieldsToProjectCopy|yieldTarget|GLOBAL_COPY_NOTICE|global-hook-yields-to-project-copy|rig-1x-copy-notice/.test(fs.readFileSync(f, 'utf8')));
    assert.deepStrictEqual(hits.map((f) => path.relative(PLUGIN, f)), []);
  });

  it('only plugin-copy-detector reads a 1.x metadata.json', () => {
    const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes('metadata.json')).map((f) => path.relative(PLUGIN, f).replace(/\\/g, '/'));
    assert.deepStrictEqual(hits, ['hooks/lib/plugin-copy-detector.cjs']);
  });
});
