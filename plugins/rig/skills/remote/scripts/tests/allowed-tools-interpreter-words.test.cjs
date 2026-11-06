'use strict';
/**
 * Gap fill for allowed-tools-policy: every forbidden interpreter first word that
 * the older test table did not name, plus git push spelling variants. Covers both
 * the orchestrator-side --allowed-tools path and the registry path.
 * Also: command wrappers (env, xargs, sudo ...) and path/.exe/quote-disguised first words.
 */
const t = require('./minimal-test-harness.cjs');
const P = require('../lib/allowed-tools-policy.cjs');

const UNTESTED_INTERPRETERS = ['zsh', 'pwsh', 'python', 'perl', 'ruby', 'deno', 'bun', 'wget', 'scp', 'cmd'];

t.test('forbidden interpreter first words are rejected in every Bash form', () => {
  for (const w of UNTESTED_INTERPRETERS) {
    for (const entry of [`Bash(${w}:*)`, `Bash(${w} -c x:*)`, `Bash(${w})`]) {
      t.ok(P.toolProblem(entry), `should reject ${entry}`);
    }
  }
});

t.test('forbidden interpreters are refused on the orchestrator flag and the registry path', () => {
  for (const w of UNTESTED_INTERPRETERS) {
    t.throwsRemote(() => P.resolveAllowedTools(`Bash(${w}:*)`, [`Bash(npm test:*)`]), { exitCode: 2 });
    t.throwsRemote(() => P.resolveAllowedTools(null, [`Bash(${w}:*)`]), { exitCode: 2 });
  }
});

t.test('git push / config / remote are rejected regardless of spacing or git path or case', () => {
  for (const entry of ['Bash(git  push:*)', 'Bash(/usr/bin/git push:*)', 'Bash(GIT push:*)', 'Bash(git push)', 'Bash(git config --global x:*)']) {
    t.ok(P.toolProblem(entry), `should reject ${entry}`);
  }
});

t.test('plain git read/add/commit subcommands stay allowed', () => {
  for (const entry of ['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)']) {
    t.eq(P.toolProblem(entry), null, entry);
  }
});

t.test('command wrappers and disguised first words are rejected', () => {
  const bad = ['env node:*', '/usr/bin/env sh:*', 'env -i sh:*', 'xargs sh:*', 'env git:*', 'env', 'nice node:*', 'nohup sh:*',
    'timeout 5 sh:*', 'stdbuf -o0 sh:*', 'command sh:*', 'exec sh:*', 'sudo git status:*', 'doas sh:*', 'su root:*', 'time sh:*',
    'ionice sh:*', 'setsid sh:*', 'script -c x:*', 'busybox sh:*', 'C:\\Windows\\System32\\ENV.EXE node:*', '/bin/NODE:*',
    'node.exe:*', '"sh":*', "'env' node:*"];
  for (const b of bad) t.ok(P.toolProblem(`Bash(${b})`), `should reject Bash(${b})`);
  t.throwsRemote(() => P.resolveAllowedTools('Bash(env node:*)', []), { exitCode: 2 });
  t.throwsRemote(() => P.resolveAllowedTools(null, ['Bash(xargs sh:*)']), { exitCode: 2 });
  t.throwsRemote(() => P.validateAllowedTools(['Bash(env git:*)'], ['Bash(env git:*)']), { exitCode: 2 });
});

t.test('M3: package runners, find, make, awk, windows script hosts, more interpreters are rejected', () => {
  const bad = ['npx cowsay:*', 'npm exec foo:*', 'npm x foo:*', 'npm --prefix a exec foo:*', 'npm create vite:*', 'npm init x:*', 'pnpm dlx x:*', 'pnpm exec x:*',
    'yarn dlx x:*', 'bunx x:*', 'bun x y:*', 'bun run x:*', 'find . -exec sh {} ;:*', 'find:*', 'make:*', 'make test:*', 'awk BEGIN:*', 'gawk x:*',
    'osascript -e x:*', 'mshta x:*', 'rundll32 x:*', 'cscript x:*', 'wscript x:*', 'regsvr32 x:*', 'php -r x:*', 'lua x:*', 'tsx x.ts:*',
    'ts-node x:*', 'deno run x:*', 'pip install x:*', 'pipx run x:*', 'uvx x:*', 'python3.12 -c x:*', 'python3.12:*', 'python2:*', 'php8.2 x:*',
    'node18 x:*', 'nodejs x:*', 'pypy3 x:*', 'ruby3.3 x:*', 'perl5.38 x:*', 'FOO=1 node x:*', 'FOO=1 npm test:*', '_X=y cargo test:*', '"A=b" cargo:*'];
  for (const b of bad) t.ok(P.toolProblem(`Bash(${b})`), `should reject Bash(${b})`);
  t.eq(P.toolProblem('Bash(npm test)'), null);
  // L5: only the subcommand position counts; script names after `run` are fine
  ['npm run init:*', 'npm run exec:*', 'npm run create:*', 'pnpm run exec:*', 'yarn run dlx:*', 'npm test init:*'].forEach((e) => t.eq(P.toolProblem(`Bash(${e})`), null, e));
  t.ok(/npm exec downloads/.test(P.toolProblem('Bash(npm --prefix a exec foo:*)')), 'message names the real subcommand');
  t.ok(/pnpm dlx/.test(P.toolProblem('Bash(pnpm --filter x dlx y:*)')));
  t.eq(P.toolProblem('Bash(pnpm test:*)'), null);
  t.eq(P.toolProblem('Bash(cargo test:*)'), null);
});

t.test('M3: git subcommand allowlist (anything else rejected, incl. bare git)', () => {
  for (const s of ['add', 'commit', 'status', 'diff', 'log', 'show', 'restore', 'rm', 'mv']) t.eq(P.toolProblem(`Bash(git ${s}:*)`), null, s);
  for (const s of ['rebase', 'fetch', 'pull', 'clone', 'submodule', 'filter-branch', 'am', 'bisect', 'checkout', 'reset', 'merge', 'cherry-pick', 'stash',
    'tag', 'branch', 'switch', 'worktree', 'gc', 'apply', 'archive', 'push', 'config', 'remote', 'daemon', 'difftool', 'mergetool', 'instaweb', 'Add']) {
    t.ok(P.toolProblem(`Bash(git ${s}:*)`), `should reject git ${s}`);
  }
  for (const e of ['Bash(git:*)', 'Bash(git)', 'Bash(git -c core.pager=x status:*)', 'Bash(git --exec-path=x status:*)', 'Bash(git rebase --exec x:*)']) {
    t.ok(P.toolProblem(e), `should reject ${e}`);
  }
  t.throwsRemote(() => P.resolveAllowedTools(null, ['Bash(git fetch:*)']), { exitCode: 2 });
  t.throwsRemote(() => P.resolveAllowedTools('Bash(git rebase:*)', []), { exitCode: 2 });
});

t.test('sed/gsed rejected (GNU sed e executes shell); tar/rsync stay allowed', () => {
  for (const e of ['sed:*', 'sed -i:*', 'gsed:*', '/usr/bin/sed -n:*', 'SED:*']) {
    t.throwsRemote(() => P.validateAllowedTools([`Bash(${e})`], [`Bash(${e})`]), { exitCode: 2 });
  }
  t.eq(P.toolProblem('Bash(tar -tf:*)'), null);
  t.eq(P.toolProblem('Bash(rsync -n:*)'), null);
});

t.done();
