#!/usr/bin/env node
/**
 * Tests for bash-in-place-edit-symlink-rule.cjs (run through the rule engine).
 * Run: node --test .claude/hooks/lib/__tests__/bash-in-place-edit-symlink-rule.test.cjs
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rule = require('../bash-in-place-edit-symlink-rule.cjs');
const { evaluateCommand } = require('../bash-safety-rule-engine.cjs');

let root;
let canSymlink = true;

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-symlink-rule-')));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'real.conf'), 'a\n');
  fs.writeFileSync(path.join(root, 'sub', 'real2.conf'), 'a\n');
  try {
    fs.symlinkSync(path.join(root, 'real.conf'), path.join(root, 'link.conf'));
    fs.symlinkSync(path.join(root, 'sub', 'real2.conf'), path.join(root, 'sub', 'link2.conf'));
  } catch {
    canSymlink = false; // e.g. Windows without symlink privilege
  }
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

function run(command, platform = process.platform) {
  return evaluateCommand(command, { rules: [rule], cwd: root, platform });
}
const decision = (command, platform) => {
  const { result } = run(command, platform);
  return result ? result.decision : null;
};

describe('in-place-edit-symlink rule', () => {
  it('denies sed -i on a symlink with the GNU remedy on linux', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    const { result } = run(`sed -i 's/a/b/' link.conf`, 'linux');
    assert.strictEqual(result.decision, 'deny');
    assert.strictEqual(result.ruleId, 'in-place-edit-symlink');
    assert.match(result.reason, /--follow-symlinks/);
    assert.ok(result.reason.includes(path.join(root, 'real.conf')));
    assert.ok(result.reason.length <= 300);
  });

  it('gives the readlink remedy on darwin and for perl', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    const mac = run(`sed -i '' 's/a/b/' link.conf`, 'darwin').result;
    assert.strictEqual(mac.decision, 'deny');
    assert.doesNotMatch(mac.reason, /--follow-symlinks/);
    assert.match(mac.reason, /real\.conf/);
    const perl = run(`perl -pi -e 's/a/b/' link.conf`, 'linux').result;
    assert.strictEqual(perl.decision, 'deny');
    assert.doesNotMatch(perl.reason, /--follow-symlinks/);
  });

  it('gsed on darwin still gets the GNU remedy', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    assert.match(run(`gsed -i x link.conf`, 'darwin').result.reason, /gsed --follow-symlinks/);
  });

  it('asks (never denies) on win32', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    const { result } = run(`sed -i x link.conf`, 'win32');
    assert.strictEqual(result.decision, 'ask');
    assert.ok(result.context);
  });

  it('allows --follow-symlinks, regular files and non in-place sed', (t) => {
    assert.strictEqual(decision(`sed --follow-symlinks -i x link.conf`, 'linux'), null);
    assert.strictEqual(decision(`sed -i x real.conf`, 'linux'), null);
    assert.strictEqual(decision(`sed x link.conf`, 'linux'), null);
    assert.strictEqual(decision(`perl -pe x link.conf`, 'linux'), null);
    assert.strictEqual(decision(`sed -i x missing.conf`, 'linux'), null);
  });

  it('handles option clusters and the --in-place form', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    for (const cmd of [`sed -ni 'p' link.conf`, `sed -Ei 's/a/b/' link.conf`, `sed --in-place=.bak x link.conf`,
      `sed -i.bak x link.conf`, `sed -e x -i link.conf`, `perl -i.bak -pe x link.conf`, `perl -i -pe x link.conf`]) {
      assert.strictEqual(decision(cmd, 'linux'), 'deny', cmd);
    }
  });

  it('does not mistake the sed script or -e value for a file operand', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    // a symlink named like the script must not trigger when it is actually the script
    fs.symlinkSync(path.join(root, 'real.conf'), path.join(root, 'p'));
    assert.strictEqual(decision(`sed -i p real.conf`, 'linux'), null);
    assert.strictEqual(decision(`sed -i -e p real.conf`, 'linux'), null);
    assert.strictEqual(decision(`sed -i -e p p`, 'linux'), 'deny');
  });

  it('follows cd and handles unknown cwd', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    assert.strictEqual(decision(`cd sub && sed -i x link2.conf`, 'linux'), 'deny');
    assert.strictEqual(decision(`cd sub && sed -i x link.conf`, 'linux'), null);
    assert.strictEqual(decision(`cd "$D" && sed -i x link.conf`, 'linux'), 'ask');
    // absolute operand is certain even when cwd is not
    assert.strictEqual(decision(`cd "$D" && sed -i x '${path.join(root, 'link.conf')}'`, 'linux'), 'deny');
  });

  it('skips globs and variables, and quoted/echoed text', () => {
    assert.strictEqual(decision(`sed -i x *.conf`, 'linux'), null);
    assert.strictEqual(decision(`sed -i x $F`, 'linux'), null);
    assert.strictEqual(decision(`echo "sed -i x link.conf"`, 'linux'), null);
  });

  it('sees through prefixes and bash -c', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    assert.strictEqual(decision(`bash -c 'sed -i x link.conf'`, 'linux'), 'deny');
    assert.strictEqual(decision(`sudo -E sed -i x link.conf`, 'linux'), 'deny');
    assert.strictEqual(decision(`ls | xargs sed -i x link.conf`, 'linux'), 'deny');
  });

  it('expands ~/ against HOME', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = root;
    process.env.USERPROFILE = root;
    try {
      assert.strictEqual(decision(`sed -i x ~/link.conf`, 'linux'), 'deny');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('is skipped on opaque segments (policy skip)', (t) => {
    if (!canSymlink) return t.skip('no symlink support');
    assert.strictEqual(decision(`sed -i x link.conf $(date)`, 'linux'), null);
  });
});
