#!/usr/bin/env node
/** Tests for rig-1x-copy-notice.cjs: the one-line migration notice of the plugin session-init. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { find1xCopies, rig1xCopyNotice } = require('../rig-1x-copy-notice.cjs');

const roots = [];
const mk = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-notice-'))); roots.push(d); return d; };
after(() => roots.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const touch = (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '// hook\n'); };
const SENTINEL = ['.claude', 'hooks', 'session-init.cjs'];

describe('rig1xCopyNotice', () => {
  it('is empty without a 1.x copy', () => {
    const root = mk();
    assert.strictEqual(rig1xCopyNotice({ self: path.join(root, 'plugin', 'hooks', 'session-init.cjs'), home: path.join(root, 'home'), projectDir: path.join(root, 'proj') }), '');
  });

  it('names the global and the project copy and the command to run', () => {
    const root = mk();
    touch(path.join(root, 'home', ...SENTINEL));
    touch(path.join(root, 'proj', ...SENTINEL));
    const opts = { self: path.join(root, 'plugin', 'hooks', 'session-init.cjs'), home: path.join(root, 'home'), projectDir: path.join(root, 'proj') };
    assert.deepStrictEqual(find1xCopies(opts), ['global', 'project']);
    assert.match(rig1xCopyNotice(opts), /~\/\.claude and this project \.claude[\s\S]*`rig-init --migrate` in a terminal/);
  });

  it('does not count the hook file that is running as a 1.x copy, and a project that is the home dir counts once', () => {
    const root = mk();
    const self = path.join(root, 'home', ...SENTINEL);
    touch(self);
    assert.deepStrictEqual(find1xCopies({ self, home: path.join(root, 'home'), projectDir: path.join(root, 'proj') }), []);
    touch(path.join(root, 'other', ...SENTINEL));
    assert.deepStrictEqual(find1xCopies({ self: path.join(root, 'p', 'x.cjs'), home: path.join(root, 'other'), projectDir: path.join(root, 'other') }), ['global']);
  });
});
