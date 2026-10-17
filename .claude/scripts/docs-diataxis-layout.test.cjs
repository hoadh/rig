const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const layout = require('./docs-diataxis-layout.cjs');

function scratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diataxis-layout-')));
}
function write(root, rel, content = '# x\n') {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('mapping is explicit and covers both roadmap names', () => {
  const m = Object.fromEntries(layout.LEGACY_FILE_MAP.map(p => [p.from, p.to]));
  assert.strictEqual(m['system-architecture.md'], 'explanation/architecture.md');
  assert.strictEqual(m['project-roadmap.md'], 'project/roadmap.md');
  assert.strictEqual(m['development-roadmap.md'], 'project/roadmap.md');
  assert.strictEqual(layout.LEGACY_FILE_MAP.length, 9);
  assert.deepStrictEqual(layout.LEGACY_DIR_MAP, [{ from: 'decisions', to: 'explanation/decisions' }]);
});

test('detectLegacyLayout finds legacy files and dirs only', () => {
  const root = scratch();
  const docs = path.join(root, 'docs');
  write(docs, 'code-standards.md');
  write(docs, 'decisions/0001-x.md');
  write(docs, 'reference/other.md');
  // a dir named like a legacy file must not count as a file
  fs.mkdirSync(path.join(docs, 'project-changelog.md'));
  const found = layout.detectLegacyLayout(docs);
  assert.deepStrictEqual(found.map(f => [f.from, f.type]), [['code-standards.md', 'file'], ['decisions', 'dir']]);
  assert.deepStrictEqual(layout.detectLegacyLayout(path.join(root, 'missing')), []);
});

test('findUnclassifiedRootDocs ignores README and legacy files', () => {
  const docs = path.join(scratch(), 'docs');
  write(docs, 'README.md');
  write(docs, 'code-standards.md');
  write(docs, 'random-notes.md');
  write(docs, 'reference/ok.md');
  assert.deepStrictEqual(layout.findUnclassifiedRootDocs(docs), ['random-notes.md']);
});

test('findMarkdownFilesRecursive recurses and skips devlog, legacy journals and dot-dirs', () => {
  const docs = path.join(scratch(), 'docs');
  write(docs, 'README.md');
  write(docs, 'reference/a.md');
  write(docs, 'explanation/decisions/b.md');
  write(docs, 'devlog/d.md');
  write(docs, 'journals/j.md');
  write(docs, '.hidden/h.md');
  write(docs, 'reference/not-md.txt');
  const names = layout.findMarkdownFilesRecursive(docs).map(f => path.relative(docs, f)).sort();
  assert.deepStrictEqual(names, ['README.md', 'explanation/decisions/b.md', 'reference/a.md']);
});

test('checkLayout warns on legacy, unclassified, and missing README', () => {
  const docs = path.join(scratch(), 'docs');
  write(docs, 'system-architecture.md');
  write(docs, 'stray.md');
  write(docs, 'guides/deploy.md');
  write(docs, 'devlog/d.md');
  write(docs, 'journals/j.md');
  write(docs, 'reference/x.md');
  const w = layout.checkLayout(docs).join('\n');
  assert.match(w, /docs\/system-architecture\.md should be docs\/explanation\/architecture\.md/);
  assert.match(w, /unclassified root doc: docs\/stray\.md/);
  assert.match(w, /unclassified docs dir: docs\/guides\//);
  assert.doesNotMatch(w, /journals|devlog/);
  assert.match(w, /docs\/README\.md missing/);
});

test('checkLayout is clean for a migrated layout', () => {
  const docs = path.join(scratch(), 'docs');
  write(docs, 'README.md');
  write(docs, 'reference/x.md');
  assert.deepStrictEqual(layout.checkLayout(docs), []);
});
