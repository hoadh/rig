'use strict';
const t = require('./minimal-test-harness.cjs');
const V = require('../lib/identifier-validators.cjs');

const table = (fn, good, bad) => {
  good.forEach((v) => t.ok(fn(v), `should accept ${JSON.stringify(v)}`));
  bad.forEach((v) => t.ok(!fn(v), `should reject ${JSON.stringify(v)}`));
};

t.test('machine names', () => table(V.isMachineName, ['waso', 'laco-staging', 'a'], ['', 'Waso', '-x', 'a_b', 'a'.repeat(33), 'a b', '../x', null]));
t.test('slugs', () => table(V.isSlug, ['my-plan', 'p1.2_x', '261015-rig'], ['', '..', 'a..b', 'x.lock', '-a', '.a', 'a/b', 'a b', 'a'.repeat(101)]));
t.test('run ids', () => table(V.isRunId, ['abcd1234', 'run-01-xyz-abc'], ['abc', 'ABCD1234', '-abcd1234', 'abcd 1234', 'a'.repeat(81)]));
t.test('phase ids + shas', () => {
  table(V.isPhaseId, ['01', '99'], ['1', '001', 'ab']);
  table(V.isSha, ['a'.repeat(40)], ['a'.repeat(39), 'A'.repeat(40), 'g'.repeat(40)]);
});
t.test('ssh targets block option injection', () => table(V.isSshTarget,
  ['dev@waso', 'host', 'ubuntu@laco-staging', 'u@1.2.3.4'],
  ['-oProxyCommand=x', 'a@-o', 'dev@-oProxyCommand=x', '', 'a b', 'a;b', 'a$(x)', '@host', 'a\nb']));
t.test('invocation tokens', () => table(V.isInvocationToken,
  ['abc', '--slug=x', 'a/b.cjs', 'C:\\x\\y', '--n=1'], ['', 'a b', 'a;b', 'a&b', '$x', '`x`', 'a|b', "a'b", 'a"b']));
t.test('abs paths posix', () => {
  table((p) => V.isAbsPath(p, 'linux'), ['/home/u/repo', '/a/b-c_d.e'], ['rel/p', '~/x', '/a b', '/a%b', '/a&b', '/a|b', '/a"b', '/a!b', '/a/../b', '/a$b', '/a\\b', '/a\tb', '']);
});
t.test('abs paths windows', () => {
  const w = (p) => V.isAbsPath(p, 'windows');
  table(w, ['C:\\rig\\fsync-native', 'D:/x/y', 'C:\\Users\\dev\\.cargo\\bin'], ['C:\\a b', 'C:\\a%b', 'C:\\x&y', 'C:\\a^b', 'C:\\a<b', 'C:\\a!b', 'rel\\x', '\\\\unc\\x', 'C:\\a\\..\\b', 'C:\\a"b']);
  t.ok(V.isAbsPath('C:\\Program Files\\nodejs\\node.exe', 'windows', { allowSpaces: true }));
  t.ok(!V.isAbsPath('C:\\Program Files (x86)\\nodejs\\node.exe', 'windows', { allowSpaces: true }));
  t.ok(/short path/.test(V.pathProblem('C:\\Program Files (x86)\\n.exe', 'windows', { allowSpaces: true })));
  t.ok(V.isAbsPath('C:\\repo(x)\\r', 'windows')); // repo paths are never shell-quoted
  t.ok(!V.isAbsPath('C:\\Program Files\\n&x.exe', 'windows', { allowSpaces: true }));
  t.ok(!V.isAbsPath('C:\\Program\tFiles\\n.exe', 'windows', { allowSpaces: true }));
});
t.test('assert* throws exit 2 naming the field', () => {
  const e = t.throwsRemote(() => V.assertSlug('x.lock', 'slug'), { exitCode: 2 });
  t.ok(e.message.includes('slug'));
  t.throwsRemote(() => V.assertSshTarget('a@-o'), { exitCode: 2 });
  t.throwsRemote(() => V.assertAbsPath('C:\\a b', 'windows', 'repo'), { exitCode: 2 });
  t.eq(V.assertMachineName('waso'), 'waso');
});

t.done();
