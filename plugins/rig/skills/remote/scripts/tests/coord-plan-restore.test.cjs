'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const R = require('../lib/coord-plan-restore.cjs');

const entry = (p, mode = '100644', type = 'blob') => ({ mode, type, sha: 'a'.repeat(40), path: p });
const fm = (body) => Buffer.from(`---\n${body}\n---\nx\n`);
const planOk = () => new Map([['plan.md', fm('orchestrator: mac')]]);
const rejects = (fn) => t.throwsRemote(fn, { exitCode: 1, cls: 'coord-invalid' });

t.test('parseLsTreeZ parses records incl. odd names', () => {
  const sha = 'b'.repeat(40);
  const e = R.parseLsTreeZ(`100644 blob ${sha}\ta.md\x00120000 blob ${sha}\tlink\x00`);
  t.eq(e.map((x) => [x.mode, x.path]), [['100644', 'a.md'], ['120000', 'link']]);
});

t.test('rejects traversal, absolute, drive, symlink, gitlink, odd chars', () => {
  for (const p of ['../x', 'a/../b', '/abs', 'C:/x', 'a//b', 'a b.md', 'a\\b', '.', 'x/..']) rejects(() => R.validateEntries([entry(p)]));
  rejects(() => R.validateEntries([entry('link', '120000')]));
  rejects(() => R.validateEntries([entry('sub', '160000', 'commit')]));
  R.validateEntries([entry('plan.md'), entry('sub/phase-01-x.md', '100755')]);
});

t.test('frontmatter ids validated', () => {
  R.validateFrontmatterIds(planOk());
  rejects(() => R.validateFrontmatterIds(new Map([['plan.md', fm('orchestrator: "a;b"')]])));
  rejects(() => R.validateFrontmatterIds(new Map()));
  const withPhase = (body, name = 'phase-01-x.md') => new Map([...planOk(), [name, fm(body)]]);
  R.validateFrontmatterIds(withPhase('machine: waso\nowns: [src/**, a/b.md]'));
  rejects(() => R.validateFrontmatterIds(withPhase('machine: "w;rm"')));
  rejects(() => R.validateFrontmatterIds(withPhase('owns: [src/$(x)]')));
  rejects(() => R.validateFrontmatterIds(withPhase('owns: [../x]')));
  rejects(() => R.validateFrontmatterIds(withPhase('machine: waso', 'phase-1-x.md')));
});

t.test('readCoordTree from real git: ok tree, then symlink tree rejected', () => {
  const env = makeRepoWithBareRemote({ clones: ['a'] });
  try {
    const a = env.clone('a');
    fs.writeFileSync(path.join(a, 'plan.md'), '---\norchestrator: mac\n---\nhi\r\n');
    env.git(a, 'add', '-A'); env.git(a, 'commit', '-q', '-m', 'p');
    const files = R.readCoordTree(a, 'HEAD');
    t.eq(files.get('plan.md').toString(), '---\norchestrator: mac\n---\nhi\r\n');
    fs.symlinkSync('/etc/passwd', path.join(a, 'evil'));
    env.git(a, 'add', '-A'); env.git(a, 'commit', '-q', '-m', 'evil');
    rejects(() => R.readCoordTree(a, 'HEAD'));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-restore-'));
    R.writeRestoredFiles(dest, files);
    t.ok(fs.existsSync(path.join(dest, 'plan.md')));
    fs.rmSync(dest, { recursive: true, force: true });
  } finally { env.cleanup(); }
});

t.done();
