'use strict';
const fs = require('fs');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');
const G = require('../lib/owns-denylist-push-guard.cjs');

t.test('glob matcher: ** crosses dirs, * and ? do not, **/ may match zero dirs', () => {
  t.ok(G.globMatches('src/**', 'src/a/b.js'));
  t.ok(!G.globMatches('src/*', 'src/a/b.js'));
  t.ok(G.globMatches('src/*', 'src/b.js'));
  t.ok(G.globMatches('src/?.js', 'src/b.js'));
  t.ok(!G.globMatches('src/?.js', 'src/bc.js'));
  t.ok(G.globMatches('**/x.md', 'x.md'));
  t.ok(G.globMatches('**/x.md', 'a/b/x.md'));
  t.ok(G.globMatches('docs/**/*.md', 'docs/a/b.md'));
  t.ok(!G.globMatches('src/**', 'srcx/a.js'));
  t.ok(G.globMatches('a.b', 'a.b') && !G.globMatches('a.b', 'aXb')); // dot is literal
  t.ok(G.globMatches('**', '.github/x.yml'));
});

t.test('M1: case-insensitive owns + denylist, backslash folded', () => {
  const rules = (paths, owns) => G.evaluateChanges(paths.map((x) => ch(x)), owns).map((v) => v.rule);
  t.eq(rules(['.GITHUB/workflows/ci.yml', '.Claude/settings.json', '.GitHub\\x.yml'], ['**']), ['denylisted', 'denylisted', 'denylisted']);
  t.eq(rules(['SRC/A.js'], ['src/**']), []);
  t.eq(rules(['.Github/workflows/ci.yml'], ['.github/workflows/**']), []); // explicit grant still works, any case
});

t.test('M1: newline / control chars in path rejected outright', () => {
  const v = G.evaluateChanges([ch('src/a\n.github/x'), ch('src/b\u0000c'), ch('.git' + '\nhub/x')], ['**']);
  t.eq(v.map((x) => x.rule), ['control-chars', 'control-chars', 'control-chars']);
  t.ok(G.globMatches('src/**', 'src/a\nb')); // [\s\S]: wildcard spans newline
});

t.test('M1: new denylist entries (any dir) need explicit owns', () => {
  const paths = ['.mcp.json', 'CLAUDE.md', 'docs/sub/CLAUDE.md', 'claude.MD', '.vscode/tasks.json', 'a/.cursor/rules', '.envrc', 'x/.npmrc', '.yarnrc.yml', '.yarnrc'];
  for (const p of paths) t.eq(G.evaluateChanges([ch(p)], ['**']).map((v) => v.rule), ['denylisted'], p);
  t.eq(G.evaluateChanges([ch('docs/sub/CLAUDE.md')], ['docs/sub/CLAUDE.md']), []);
  t.eq(G.evaluateChanges([ch('README.md')], ['**']), []);
});

t.test('M1: repeated ** does not backtrack catastrophically', () => {
  const start = Date.now();
  const g = '**/**/**/**/**/**/**/**/x';
  t.ok(!G.globMatches(g, `${'a/'.repeat(40)}y`));
  t.ok(G.globMatches(g, 'a/b/x'));
  t.ok(!G.globMatches('******/******y', 'a'.repeat(5000)));
  t.ok(Date.now() - start < 1000, 'regex time');
});

t.test('ownsGrantsDenylisted: explicit prefix inside area counts, catch-alls never', () => {
  t.ok(G.ownsGrantsDenylisted('.github/workflows/**', '.github/**'));
  t.ok(G.ownsGrantsDenylisted('.github/**', '.github/**'));
  t.ok(G.ownsGrantsDenylisted('.gitattributes', '.gitattributes'));
  t.ok(!G.ownsGrantsDenylisted('**', '.github/**'));
  t.ok(!G.ownsGrantsDenylisted('*', '.gitattributes'));
  t.ok(!G.ownsGrantsDenylisted('src/**', '.github/**'));
});

const ch = (p, o = '100644', n = '100644', s = 'M') => ({ path: p, oldMode: o, newMode: n, status: s });

t.test('evaluateChanges: not-owned, denylisted, symlink/gitlink', () => {
  const owns = ['src/**', '.github/workflows/**'];
  t.eq(G.evaluateChanges([ch('src/a.js'), ch('.github/workflows/ci.yml')], owns), []);
  t.eq(G.evaluateChanges([ch('lib/x.js')], owns).map((v) => v.rule), ['not-owned']);
  t.eq(G.evaluateChanges([ch('.github/CODEOWNERS')], owns).map((v) => v.rule), ['not-owned']); // owned? no: only workflows/
  t.eq(G.evaluateChanges([ch('.github/x.yml')], ['**']).map((v) => v.rule), ['denylisted']);
  t.eq(G.evaluateChanges([ch('.claude/settings.json')], ['.claude/**']), []); // explicit grant
  t.eq(G.evaluateChanges([ch('src/link', '000000', '120000', 'A')], owns).map((v) => v.rule), ['symlink-or-gitlink']);
  t.eq(G.evaluateChanges([ch('src/sub', '000000', '160000', 'A')], ['**']).map((v) => v.rule), ['symlink-or-gitlink']);
  t.eq(G.evaluateChanges([ch('src/link', '120000', '000000', 'D')], owns).map((v) => v.rule), ['symlink-or-gitlink']);
  t.eq(G.evaluateChanges([ch('.husky/pre-commit'), ch('Jenkinsfile'), ch('.gitmodules')], ['**']).length, 3);
});

t.test('parseRawDiff parses git diff --raw -z', () => {
  const raw = ':100644 100644 aaa bbb M\0src/a.js\0:000000 120000 000 ccc A\0src/l\0';
  t.eq(G.parseRawDiff(raw).map((c) => [c.path, c.status, c.newMode]), [['src/a.js', 'M', '100644'], ['src/l', 'A', '120000']]);
});

t.test('checkOwnsAndDenylist on a real repo (fixtures from the success criteria)', () => {
  const env = makeRepoWithBareRemote({ clones: ['w'] });
  try {
    const repo = env.clone('w');
    const base = env.git(repo, 'rev-parse', 'HEAD');
    env.commitFile('w', 'src/a.js', '1');
    env.commitFile('w', '.github/x.yml', 'on: push');
    const head = env.git(repo, 'rev-parse', 'HEAD');
    const v1 = G.checkOwnsAndDenylist(repo, base, head, ['src/**', '.github/**']); // .github/** explicit -> ok
    t.eq(v1, []);
    const v2 = G.checkOwnsAndDenylist(repo, base, head, ['**']); // catch-all does not unlock denylist
    t.eq(v2.map((v) => [v.path, v.rule]), [['.github/x.yml', 'denylisted']]);
    const v3 = G.checkOwnsAndDenylist(repo, base, head, ['src/**']);
    t.eq(v3.map((v) => v.rule), ['not-owned']);
    fs.symlinkSync('/etc/passwd', path.join(repo, 'src', 'pw'));
    env.git(repo, 'add', '-A'); env.git(repo, 'commit', '-q', '-m', 'link');
    const head2 = env.git(repo, 'rev-parse', 'HEAD');
    t.eq(G.checkOwnsAndDenylist(repo, head, head2, ['src/**']).map((v) => v.rule), ['symlink-or-gitlink']);
    // delete of an unowned file is also a violation
    env.git(repo, 'rm', '-q', 'README.md'); env.git(repo, 'commit', '-q', '-m', 'rm');
    const head3 = env.git(repo, 'rev-parse', 'HEAD');
    t.eq(G.checkOwnsAndDenylist(repo, head2, head3, ['src/**']).map((v) => v.path), ['README.md']);
  } finally { env.cleanup(); }
});

t.done();
