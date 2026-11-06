const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { migrate } = require('./migrate-docs-to-diataxis-layout.cjs');
const { extractMapArgs, parseCustomMoves } = require('./migrate-docs-custom-move-map-parser.cjs');

const SCRIPT = path.join(__dirname, 'migrate-docs-to-diataxis-layout.cjs');

function scratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diataxis-map-')));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Non-standard project: ad-hoc names, a guides/ dir, a misfiled reference page. */
function adHocProject() {
  const root = scratch();
  write(root, 'README.md', 'Start: [setup](docs/setup.md). Also docs/guides/release.md\n');
  write(root, 'docs/setup.md', '# Setup\nSee [api](./api.md#auth) and [release](guides/release.md).\n');
  write(root, 'docs/api.md', '# API\nBack to [setup](setup.md).\n');
  write(root, 'docs/guides/release.md', '# Release\n[api](../api.md)\n');
  write(root, 'docs/system-architecture.md', '# Arch\n');
  return root;
}

test('extractMapArgs supports both flag forms and leaves other args', () => {
  const r = extractMapArgs(['docs/', '--map', 'a.md=how-to/a.md', '--map=b.md=reference/b.md', '--apply']);
  assert.deepStrictEqual(r.maps, ['a.md=how-to/a.md', 'b.md=reference/b.md']);
  assert.deepStrictEqual(r.rest, ['docs/', '--apply']);
  assert.throws(() => extractMapArgs(['--map']), /needs a value/);
});

test('parseCustomMoves rejects unsafe or non-standard targets', () => {
  const docs = path.join(adHocProject(), 'docs');
  assert.throws(() => parseCustomMoves(['setup.md=../x.md'], docs), /no "\.\."/);
  assert.throws(() => parseCustomMoves(['/etc/x.md=how-to/x.md'], docs), /relative/);
  assert.throws(() => parseCustomMoves(['setup.md=guides/setup.md'], docs), /must be under/);
  assert.throws(() => parseCustomMoves(['setup.md=how-to'], docs), /must be under/);
  assert.throws(() => parseCustomMoves(['missing.md=how-to/m.md'], docs), /not found/);
  assert.throws(() => parseCustomMoves(['setup.md=how-to/setup.txt'], docs), /\.md -> \.md/);
  assert.throws(() => parseCustomMoves(['setup.md=devlog/x.md'], docs), /must be under|skipped/);
  assert.throws(() => parseCustomMoves(['setup.md'], docs), /expected <from>=<to>/);
  assert.throws(() => parseCustomMoves(['setup.md=how-to/a.md', 'setup.md=how-to/b.md'], docs), /duplicate/);
  assert.strictEqual(parseCustomMoves(['guides=how-to'], docs)[0].type, 'dir');
});

test('custom moves + legacy moves apply together and rewrite links both ways', () => {
  const root = adHocProject();
  const docs = path.join(root, 'docs');
  const customMoves = parseCustomMoves(['setup.md=tutorials/getting-started.md', 'api.md=reference/api.md'], docs);
  const s = migrate(docs, { apply: true, customMoves });
  assert.strictEqual(s.conflicts.length, 0);
  assert.strictEqual(s.moved.length, 3); // 2 custom + legacy system-architecture.md
  assert.match(read(root, 'README.md'), /\[setup\]\(docs\/tutorials\/getting-started\.md\)/);
  const tut = read(root, 'docs/tutorials/getting-started.md');
  assert.match(tut, /\[api\]\(\.\.\/reference\/api\.md#auth\)/);
  assert.match(tut, /\[release\]\(\.\.\/guides\/release\.md\)/);
  assert.match(read(root, 'docs/reference/api.md'), /\[setup\]\(\.\.\/tutorials\/getting-started\.md\)/);
  assert.match(read(root, 'docs/guides/release.md'), /\[api\]\(\.\.\/reference\/api\.md\)/);
  assert.ok(fs.existsSync(path.join(docs, 'explanation/architecture.md')));
});

test('custom map overrides legacy default target', () => {
  const root = adHocProject();
  const docs = path.join(root, 'docs');
  const customMoves = parseCustomMoves(['system-architecture.md=explanation/system-design.md'], docs);
  const s = migrate(docs, { customMoves });
  assert.deepStrictEqual(s.moved.map(m => m.to), ['docs/explanation/system-design.md']);
});

test('directory map moves whole dir; nested file map conflicts', () => {
  const root = adHocProject();
  const docs = path.join(root, 'docs');
  const customMoves = parseCustomMoves(['guides=how-to', 'guides/release.md=how-to/ship.md'], docs);
  const s = migrate(docs, { apply: true, customMoves });
  assert.deepStrictEqual(s.conflicts.map(c => c.from), ['docs/guides/release.md']);
  assert.ok(fs.existsSync(path.join(docs, 'how-to/release.md')));
  assert.match(read(root, 'README.md'), /docs\/how-to\/release\.md/);
});

test('CLI: --map dry-run prints custom move; bad map exits 1 and changes nothing', () => {
  const root = adHocProject();
  const ok = spawnSync('node', [SCRIPT, 'docs', '--map', 'api.md=reference/api.md'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /move {5}docs\/api\.md -> docs\/reference\/api\.md/);
  assert.ok(fs.existsSync(path.join(root, 'docs/api.md')));
  const bad = spawnSync('node', [SCRIPT, 'docs', '--map', 'api.md=../api.md', '--apply'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.ok(fs.existsSync(path.join(root, 'docs/api.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs/system-architecture.md')));
});

test('file target inside a moved dir target conflicts instead of overwriting', () => {
  const root = scratch();
  write(root, 'docs/a/b.md', 'A');
  write(root, 'docs/b.md', 'B');
  const docs = path.join(root, 'docs');
  const customMoves = parseCustomMoves(['b.md=how-to/x/b.md', 'a=how-to/x'], docs);
  const s = migrate(docs, { apply: true, customMoves });
  assert.deepStrictEqual(s.conflicts.map(c => c.from), ['docs/b.md']);
  assert.strictEqual(read(root, 'docs/how-to/x/b.md'), 'A');
  assert.strictEqual(read(root, 'docs/b.md'), 'B');
});

test('dir move does not rewrite a sibling file with the same stem', () => {
  const root = scratch();
  write(root, 'docs/api/x.md', '# X\n');
  write(root, 'docs/api.md', '# API\n');
  write(root, 'docs/ref.md', 'See docs/api.md and docs/api/x.md\n');
  const docs = path.join(root, 'docs');
  const customMoves = parseCustomMoves(['api=reference/api', 'api.md=reference/api-overview.md'], docs);
  migrate(docs, { apply: true, customMoves });
  assert.match(read(root, 'docs/ref.md'), /docs\/reference\/api-overview\.md and docs\/reference\/api\/x\.md/);
});

test('conflicted dir move does not block files inside it', () => {
  const root = adHocProject();
  write(root, 'docs/how-to/existing.md', '# E\n');
  const docs = path.join(root, 'docs');
  const customMoves = parseCustomMoves(['guides=how-to', 'guides/release.md=how-to/release.md'], docs);
  const s = migrate(docs, { customMoves });
  assert.deepStrictEqual(s.conflicts.map(c => [c.from, c.reason]), [['docs/guides', 'target exists']]);
  assert.ok(s.moved.some(m => m.to === 'docs/how-to/release.md'));
});
