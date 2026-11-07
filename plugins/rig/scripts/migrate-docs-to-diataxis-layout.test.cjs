const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { migrate } = require('./migrate-docs-to-diataxis-layout.cjs');

const SCRIPT = path.join(__dirname, 'migrate-docs-to-diataxis-layout.cjs');
const hasGit = spawnSync('git', ['--version']).status === 0;

function scratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diataxis-migrate-')));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function snapshot(root) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else out[path.relative(root, f)] = fs.readFileSync(f, 'utf8');
    }
  })(root);
  return out;
}

/** Legacy flat project with cross-links, anchors, external URLs, code fence. */
function legacyProject() {
  const root = scratch();
  write(root, 'README.md', 'See [arch](docs/system-architecture.md#flow) and [web](https://x.io/system-architecture.md).\nPath: docs/code-standards.md.\n');
  write(root, 'docs/system-architecture.md', 'Uses [summary](./codebase-summary.md#top) and [ext](https://a.b/c.md).\n```\n[no](./codebase-summary.md)\n```\n');
  write(root, 'docs/codebase-summary.md', 'Back to [arch](./system-architecture.md).\n');
  write(root, 'docs/project-roadmap.md', '# roadmap\n');
  write(root, 'docs/code-standards.md', '# cs\n');
  return root;
}

test('dry-run reports plan and changes nothing on disk', () => {
  const root = legacyProject();
  const before = snapshot(root);
  const s = migrate(path.join(root, 'docs'));
  assert.strictEqual(s.mode, 'dry-run');
  assert.strictEqual(s.moved.length, 4);
  assert.ok(s.filesRewritten.length >= 3);
  assert.deepStrictEqual(snapshot(root), before);
});

test('apply moves files, rewrites inbound/outbound links, keeps anchors', () => {
  const root = legacyProject();
  const s = migrate(path.join(root, 'docs'), { apply: true });
  assert.strictEqual(s.conflicts.length, 0);
  assert.ok(fs.existsSync(path.join(root, 'docs/explanation/architecture.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs/project/roadmap.md')));
  assert.ok(!fs.existsSync(path.join(root, 'docs/system-architecture.md')));
  // inbound from root README (anchor kept, external untouched, plain text rewritten)
  const readme = read(root, 'README.md');
  assert.match(readme, /\(docs\/explanation\/architecture\.md#flow\)/);
  assert.match(readme, /https:\/\/x\.io\/system-architecture\.md/);
  assert.match(readme, /docs\/reference\/code-standards\.md\./);
  // outbound from moved file; code fence + external untouched
  const arch = read(root, 'docs/explanation/architecture.md');
  assert.match(arch, /\(\.\.\/reference\/codebase-summary\.md#top\)/);
  assert.match(arch, /\[no\]\(\.\/codebase-summary\.md\)/);
  assert.match(arch, /https:\/\/a\.b\/c\.md/);
  // both ends moved: sibling dir link
  assert.match(read(root, 'docs/reference/codebase-summary.md'), /\(\.\.\/explanation\/architecture\.md\)/);
});

test('decisions dir moves as a whole and links into it are rewritten', () => {
  const root = scratch();
  write(root, 'docs/decisions/0001-x.md', 'Back to [idx](../README.md)\n');
  write(root, 'docs/README.md', '[adr](./decisions/0001-x.md) and [all](decisions/)\nSee docs/decisions/ for ADRs.\n');
  const s = migrate(path.join(root, 'docs'), { apply: true });
  assert.deepStrictEqual(s.moved, [{ from: 'docs/decisions', to: 'docs/explanation/decisions' }]);
  assert.ok(fs.existsSync(path.join(root, 'docs/explanation/decisions/0001-x.md')));
  const idx = read(root, 'docs/README.md');
  assert.match(idx, /\(\.\/explanation\/decisions\/0001-x\.md\)/);
  assert.match(idx, /\(explanation\/decisions\/\)/);
  assert.match(idx, /docs\/explanation\/decisions\/ for ADRs/);
  assert.match(read(root, 'docs/explanation/decisions/0001-x.md'), /\(\.\.\/\.\.\/README\.md\)/);
});

test('decisions dir conflict when target exists: nothing moved', () => {
  const root = scratch();
  write(root, 'docs/decisions/a.md', 'a\n');
  write(root, 'docs/explanation/decisions/b.md', 'b\n');
  const s = migrate(path.join(root, 'docs'), { apply: true });
  assert.strictEqual(s.moved.length, 0);
  assert.strictEqual(s.conflicts[0].reason, 'target exists');
  assert.ok(fs.existsSync(path.join(root, 'docs/decisions/a.md')));
});

test('both roadmap files: first moves, second reported as conflict', () => {
  const root = scratch();
  write(root, 'docs/project-roadmap.md', 'one\n');
  write(root, 'docs/development-roadmap.md', 'two\n');
  const s = migrate(path.join(root, 'docs'), { apply: true });
  assert.deepStrictEqual(s.moved.map(m => m.from), ['docs/project-roadmap.md']);
  assert.strictEqual(s.conflicts[0].from, 'docs/development-roadmap.md');
  assert.strictEqual(read(root, 'docs/project/roadmap.md'), 'one\n');
  assert.strictEqual(read(root, 'docs/development-roadmap.md'), 'two\n');
});

test('existing target is never overwritten', () => {
  const root = scratch();
  write(root, 'docs/code-standards.md', 'legacy\n');
  write(root, 'docs/reference/code-standards.md', 'new\n');
  write(root, 'README.md', '[cs](docs/code-standards.md)\n');
  const s = migrate(path.join(root, 'docs'), { apply: true });
  assert.strictEqual(s.conflicts.length, 1);
  assert.strictEqual(read(root, 'docs/reference/code-standards.md'), 'new\n');
  assert.strictEqual(read(root, 'README.md'), '[cs](docs/code-standards.md)\n');
});

test('git work tree: uses git mv (staged renames)', { skip: !hasGit }, () => {
  const root = legacyProject();
  assert.strictEqual(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  spawnSync('git', ['add', '-A'], { cwd: root });
  const id = ['-c', 'user.name=t', '-c', 'user.email=t@t.t', '-c', 'commit.gpgsign=false'];
  assert.strictEqual(spawnSync('git', [...id, 'commit', '-q', '-m', 'init'], { cwd: root }).status, 0);
  migrate(path.join(root, 'docs'), { apply: true });
  const st = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.match(st, /^R.*docs\/system-architecture\.md -> docs\/explanation\/architecture\.md/m);
});

test('CLI: dry-run default exits 0; rejects docs dir outside cwd', () => {
  const root = legacyProject();
  const before = snapshot(root);
  const ok = spawnSync('node', [SCRIPT, 'docs'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0);
  assert.match(ok.stdout, /dry-run/);
  assert.deepStrictEqual(snapshot(root), before);
  const bad = spawnSync('node', [SCRIPT, '../elsewhere'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /outside cwd/);
});

test('CLI: docs dir equal to cwd exits 1 and never touches parent README', () => {
  const parent = scratch();
  write(parent, 'README.md', 'See docs/code-standards.md\n');
  write(parent, 'proj/code-standards.md', '# cs\n');
  const before = snapshot(parent);
  const r = spawnSync('node', [SCRIPT, '.', '--apply'], { cwd: path.join(parent, 'proj'), encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(snapshot(parent), before);
});

test('rewrites reference definitions, titled links, and HTML href/src (inbound + outbound)', () => {
  const root = scratch();
  write(root, 'README.md', [
    '[a]: docs/code-standards.md "Std"',
    '[b]: ./docs/code-standards.md#x',
    '[t](docs/code-standards.md "Title")',
    '[t2](docs/code-standards.md#h \'T\')',
    '<a href="docs/code-standards.md#z">x</a> <img src=\'docs/code-standards.md\'>',
    '[fn]: not a path',
    'Plain ./docs/code-standards.md here',
    ''
  ].join('\n'));
  write(root, 'docs/code-standards.md', [
    '[r]: ../README.md "Root"',
    '[t](../README.md "Root")',
    '<a href="../README.md#q">r</a>',
    ''
  ].join('\n'));
  migrate(path.join(root, 'docs'), { apply: true });
  const readme = read(root, 'README.md');
  assert.match(readme, /^\[a\]: docs\/reference\/code-standards\.md "Std"$/m);
  assert.match(readme, /^\[b\]: \.\/docs\/reference\/code-standards\.md#x$/m);
  assert.match(readme, /\[t\]\(docs\/reference\/code-standards\.md "Title"\)/);
  assert.match(readme, /\(docs\/reference\/code-standards\.md#h 'T'\)/);
  assert.match(readme, /href="docs\/reference\/code-standards\.md#z"/);
  assert.match(readme, /src='docs\/reference\/code-standards\.md'/);
  assert.match(readme, /^\[fn\]: not a path$/m);
  assert.match(readme, /Plain \.\/docs\/reference\/code-standards\.md here/);
  const cs = read(root, 'docs/reference/code-standards.md');
  assert.match(cs, /^\[r\]: \.\.\/\.\.\/README\.md "Root"$/m);
  assert.match(cs, /\[t\]\(\.\.\/\.\.\/README\.md "Root"\)/);
  assert.match(cs, /href="\.\.\/\.\.\/README\.md#q"/);
});

test('longer fence is not closed by a shorter one', () => {
  const root = scratch();
  write(root, 'docs/README.md', '````\n```\n[x](./code-standards.md)\n```\n````\n[y](./code-standards.md)\n');
  write(root, 'docs/code-standards.md', '# cs\n');
  migrate(path.join(root, 'docs'), { apply: true });
  const idx = read(root, 'docs/README.md');
  assert.match(idx, /\[x\]\(\.\/code-standards\.md\)/);
  assert.match(idx, /\[y\]\(\.\/reference\/code-standards\.md\)/);
});

test('apply aborts with nothing moved when a target parent is a file', () => {
  const root = scratch();
  write(root, 'docs/code-standards.md', '# cs\n');
  write(root, 'docs/project-roadmap.md', '# rm\n');
  write(root, 'docs/reference', 'i am a file\n');
  const before = snapshot(root);
  assert.throws(() => migrate(path.join(root, 'docs'), { apply: true }), /nothing moved/);
  assert.deepStrictEqual(snapshot(root), before);
});
