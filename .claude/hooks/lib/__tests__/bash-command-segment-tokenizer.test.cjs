#!/usr/bin/env node
/**
 * Tests for bash-command-segment-tokenizer.cjs
 * Run: node --test .claude/hooks/lib/__tests__/bash-command-segment-tokenizer.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { tokenize, commandName } = require('../bash-command-segment-tokenizer.cjs');

const CWD = path.resolve('/work/proj');
const argvs = (cmd) => tokenize(cmd, { cwd: CWD }).map((s) => s.argv);

describe('splitting', () => {
  it('splits on ; && || | & and newline', () => {
    assert.deepStrictEqual(argvs('a 1; b 2 && c || d | e & f\ng'),
      [['a', '1'], ['b', '2'], ['c'], ['d'], ['e'], ['f'], ['g']]);
  });
  it('does not split inside quotes or after escapes', () => {
    assert.deepStrictEqual(argvs(`echo "a; b" 'c && d' e\\;f`), [['echo', 'a; b', 'c && d', 'e;f']]);
  });
  it('keeps redirections out of argv and does not split on >&', () => {
    assert.deepStrictEqual(argvs('cmd a > out 2>&1 &> all'), [['cmd', 'a']]);
    assert.deepStrictEqual(argvs('cmd a 2>/dev/null; b'), [['cmd', 'a'], ['b']]);
  });
  it('ignores comments', () => {
    assert.deepStrictEqual(argvs('echo hi # sed -i x link'), [['echo', 'hi']]);
  });
  it('handles line continuation', () => {
    assert.deepStrictEqual(argvs('echo a \\\n b'), [['echo', 'a', 'b']]);
  });
  it('returns [] for empty or non-string input', () => {
    assert.deepStrictEqual(tokenize('', {}), []);
    assert.deepStrictEqual(tokenize(undefined, {}), []);
  });
  it('records raw text and fullCommand per segment', () => {
    const segs = tokenize('a 1 ;  b 2', { cwd: CWD });
    assert.strictEqual(segs[0].raw, 'a 1');
    assert.strictEqual(segs[1].raw, 'b 2');
    assert.strictEqual(segs[1].fullCommand, 'a 1 ;  b 2');
  });
});

describe('opaque segments', () => {
  it('marks $( ), backticks, process substitution and unbalanced quotes opaque', () => {
    for (const cmd of ['cat $(x y)', 'cat `x`', 'diff <(a) b', 'echo "$(x)"', "echo 'unbalanced", 'echo "unbalanced']) {
      const segs = tokenize(cmd, { cwd: CWD });
      assert.ok(segs.length >= 1, cmd);
      assert.ok(segs.every((s) => s.opaque), cmd);
    }
  });
  it('keeps operators inside $( ) from splitting and exposes raw', () => {
    const segs = tokenize('echo $(a; b) ; c', { cwd: CWD });
    assert.strictEqual(segs.length, 2);
    assert.strictEqual(segs[0].opaque, true);
    assert.strictEqual(segs[0].raw, 'echo $(a; b)');
    assert.strictEqual(segs[1].opaque, false);
  });
  it('treats heredoc as opaque and skips its body', () => {
    const segs = tokenize('cat <<EOF\npkill -f x\nEOF\nls', { cwd: CWD });
    assert.deepStrictEqual(segs.map((s) => s.argv), [['cat'], ['ls']]);
    assert.strictEqual(segs[0].opaque, true);
    assert.match(segs[0].raw, /pkill -f x/);
    assert.strictEqual(segs[1].opaque, false);
  });
  it('handles heredoc in a pipeline and quoted delimiter', () => {
    const segs = tokenize("cat <<'EOF' | grep x\nbody ; rm\nEOF\nnext", { cwd: CWD });
    assert.deepStrictEqual(segs.map((s) => s.argv), [['cat'], ['grep', 'x'], ['next']]);
  });
  it('does not treat <<< here-string as heredoc', () => {
    const segs = tokenize('cat <<< hi', { cwd: CWD });
    assert.strictEqual(segs[0].opaque, false);
    assert.deepStrictEqual(segs[0].argv, ['cat']);
  });
});

describe('dynamic words', () => {
  it('flags variables, globs and brace expansion but not single-quoted text', () => {
    const [seg] = tokenize(`cmd $A "$B" *.c 'x$y' "plain" {a,b}`, { cwd: CWD });
    assert.deepStrictEqual(seg.dynamic, [false, true, true, true, false, false, true]);
  });
});

describe('prefix stripping', () => {
  const head = (cmd) => argvs(cmd)[0];
  it('strips sudo with flags and values', () => {
    assert.deepStrictEqual(head('sudo -E pkill -9 -f vite'), ['pkill', '-9', '-f', 'vite']);
    assert.deepStrictEqual(head('sudo -u root -H pkill x'), ['pkill', 'x']);
    assert.deepStrictEqual(head('sudo --user=root pkill x'), ['pkill', 'x']);
    assert.deepStrictEqual(head('sudo -Eu root pkill x'), ['pkill', 'x']);
  });
  it('strips env, nice, time, nohup, exec, command', () => {
    assert.deepStrictEqual(head('env -i A=1 B=2 cmd x'), ['cmd', 'x']);
    assert.deepStrictEqual(head('env -u FOO cmd'), ['cmd']);
    assert.deepStrictEqual(head('nice -n 10 cmd x'), ['cmd', 'x']);
    assert.deepStrictEqual(head('nice -5 cmd'), ['cmd']);
    assert.deepStrictEqual(head('time -p nohup exec command cmd'), ['cmd']);
    assert.deepStrictEqual(head('A=1 cmd'), ['cmd']);
  });
  it('strips timeout with options and duration', () => {
    assert.deepStrictEqual(head('timeout 5 pkill -f vite'), ['pkill', '-f', 'vite']);
    assert.deepStrictEqual(head('timeout -s KILL -k 3 10s cmd'), ['cmd']);
    assert.deepStrictEqual(head('timeout --signal=TERM 1 cmd'), ['cmd']);
  });
  it('strips xargs and watch options', () => {
    assert.deepStrictEqual(head('xargs -r -n 1 -I {} kill -9'), ['kill', '-9']);
    assert.deepStrictEqual(head('xargs -0 pkill -f x'), ['pkill', '-f', 'x']);
    assert.deepStrictEqual(head('watch -n 2 -d ls -l'), ['ls', '-l']);
  });
  it('strips repeated prefixes and absolute paths', () => {
    assert.deepStrictEqual(head('sudo nice -n 1 timeout 5 /usr/bin/env A=1 cmd'), ['cmd']);
  });
  it('strips shell reserved words', () => {
    assert.deepStrictEqual(head('! cmd'), ['cmd']);
    assert.deepStrictEqual(argvs('if x; then cmd; fi')[1], ['cmd']);
  });
  it('leaves `command -v` lookups alone', () => {
    assert.deepStrictEqual(head('command -v pkill'), ['command', '-v', 'pkill']);
  });
  it('does not loop or throw on bare prefixes', () => {
    assert.deepStrictEqual(tokenize('sudo', { cwd: CWD }).map((s) => s.argv), [[]]);
    assert.doesNotThrow(() => tokenize('timeout', { cwd: CWD }));
  });
});

describe('sh -c re-tokenization', () => {
  it('re-tokenizes literal scripts', () => {
    assert.deepStrictEqual(argvs(`bash -c 'sed -i x link; ls'`), [['sed', '-i', 'x', 'link'], ['ls']]);
    assert.deepStrictEqual(argvs(`sudo sh -lc "pkill -f a"`), [['pkill', '-f', 'a']]);
    assert.deepStrictEqual(argvs(`bash -c 'zsh -c "kill 0"'`), [['kill', '0']]);
  });
  it('keeps the outer full command for nested segments', () => {
    const [seg] = tokenize(`bash -c 'pkill -f a'`, { cwd: CWD });
    assert.strictEqual(seg.fullCommand, `bash -c 'pkill -f a'`);
  });
  it('does not treat a script file as -c', () => {
    assert.deepStrictEqual(argvs('bash script.sh -c x'), [['bash', 'script.sh', '-c', 'x']]);
  });
  it('caps nesting depth', () => {
    const cmd = `bash -c 'bash -c "bash -c \\"bash -c x\\""'`;
    assert.doesNotThrow(() => tokenize(cmd, { cwd: CWD }));
  });
});

describe('cwd tracking', () => {
  const segsOf = (cmd) => tokenize(cmd, { cwd: CWD }).filter((s) => s.argv[0] !== 'cd');
  it('starts at the given cwd', () => {
    assert.deepStrictEqual(segsOf('a').map((s) => [s.cwd, s.cwdUnknown]), [[CWD, false]]);
  });
  it('follows cd with relative and absolute literals', () => {
    assert.deepStrictEqual(segsOf('cd sub && a; cd /abs; b; cd ..; c').map((s) => s.cwd),
      [path.join(CWD, 'sub'), path.resolve('/abs'), path.resolve('/')]);
  });
  it('marks non-literal cd as unknown and recovers on absolute cd', () => {
    assert.deepStrictEqual(segsOf('cd "$D" && a; cd rel; b; cd /x; c').map((s) => s.cwdUnknown), [true, true, false]);
  });
  it('treats cd - as unknown', () => {
    assert.strictEqual(segsOf('cd - && a')[0].cwdUnknown, true);
  });
  it('scopes cd inside a subshell', () => {
    const byCmd = Object.fromEntries(segsOf('(cd sub; a); b').map((s) => [s.argv[0], s.cwd]));
    assert.strictEqual(byCmd.a, path.join(CWD, 'sub'));
    assert.strictEqual(byCmd.b, CWD);
  });
  it('does not apply cd that runs in a pipeline or background', () => {
    assert.strictEqual(segsOf('cd sub | a')[0].cwd, CWD);
    assert.strictEqual(segsOf('cd sub & a')[0].cwd, CWD);
  });
  it('sub-shell scripts inherit but do not leak cwd', () => {
    const segs = segsOf(`bash -c 'cd sub; a'; b`);
    assert.strictEqual(segs[segs.length - 1].cwd, CWD);
  });
});

describe('commandName', () => {
  it('returns the lower-cased basename of argv[0]', () => {
    assert.strictEqual(commandName({ argv: ['/usr/bin/PKill'] }), 'pkill');
    assert.strictEqual(commandName({ argv: ['node.exe'] }), 'node');
    assert.strictEqual(commandName({ argv: [] }), '');
    assert.strictEqual(commandName(null), '');
  });
});

describe('shell options before -c, eval, and segment operators', () => {
  it('looks inside bash -o pipefail -c and +o / -O option values', () => {
    assert.deepStrictEqual(argvs(`bash -o pipefail -c 'pkill -f node'`), [['pkill', '-f', 'node']]);
    assert.deepStrictEqual(argvs(`bash -eo pipefail -c 'a 1'`), [['a', '1']]);
    assert.deepStrictEqual(argvs(`bash +o history -O extglob -c 'b'`), [['b']]);
  });
  it('re-scans eval literals', () => {
    assert.deepStrictEqual(argvs(`eval 'pkill -f node'`), [['pkill', '-f', 'node']]);
    assert.deepStrictEqual(argvs('eval pkill -f node'), [['pkill', '-f', 'node']]);
  });
  it('respects the nesting depth cap for eval and bash -c', () => {
    const deep = `eval "eval \\"eval 'eval \\\\\\"pkill -f node\\\\\\"'\\""`;
    const out = argvs(deep);
    assert.ok(out.length >= 1);
    assert.ok(out.every((a) => a[0] !== 'pkill'), JSON.stringify(out));
  });
  it('reports the operator that ended each segment, also for bash -c bodies', () => {
    const ops = (cmd) => tokenize(cmd, { cwd: CWD }).map((s) => s.op);
    assert.deepStrictEqual(ops('a && b || c; d | e'), ['&&', '||', ';', '|', '']);
    assert.deepStrictEqual(ops(`bash -c 'a && b'; c`), ['&&', ';', '']);
    assert.deepStrictEqual(ops(`bash -c 'a' | tail`), ['|', '']);
  });
});
