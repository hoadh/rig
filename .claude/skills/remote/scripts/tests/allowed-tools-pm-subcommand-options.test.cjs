'use strict';
/** Review round 3 (low): options before the npm/pnpm/yarn subcommand must be known, else exec/dlx can hide behind a value. */
const t = require('./minimal-test-harness.cjs');
const P = require('../lib/allowed-tools-policy.cjs');

t.test('unknown option before the subcommand is rejected (npm --otp 1 exec)', () => {
  for (const e of ['Bash(npm --otp 1 exec:*)', 'Bash(npm --foo test:*)', 'Bash(pnpm --bogus dlx x:*)', 'Bash(yarn -Z exec:*)', 'Bash(npm --otp=1 exec:*)']) {
    const p = P.toolProblem(e);
    t.ok(p && /not recognised/.test(p), `${e} -> ${p}`);
  }
});

t.test('known value and boolean options still reach the subcommand check', () => {
  t.ok(/downloads and runs/.test(P.toolProblem('Bash(npm --prefix a exec:*)')));
  t.ok(/downloads and runs/.test(P.toolProblem('Bash(npm --silent --workspace=w exec:*)')));
  t.ok(/downloads and runs/.test(P.toolProblem('Bash(pnpm -r dlx x:*)')));
  for (const e of ['Bash(npm test:*)', 'Bash(npm run init:*)', 'Bash(npm --prefix a test:*)', 'Bash(npm --silent run build:*)', 'Bash(npm:*)', 'Bash(pnpm run exec:*)']) t.eq(P.toolProblem(e), null, e);
});

t.test('R4-L3: boolean options never swallow the subcommand; per-PM semantics (npm -w value, pnpm -w boolean)', () => {
  const exec = (e) => /downloads and runs/.test(P.toolProblem(e) || '');
  t.ok(exec('Bash(npm --workspaces-update exec:*)')); // boolean in npm: `exec` is the subcommand
  t.ok(exec('Bash(pnpm -w dlx x:*)'));                // pnpm -w = --workspace-root (boolean)
  t.ok(exec('Bash(pnpm --workspace-root exec:*)'));
  t.ok(exec('Bash(npm -w web exec:*)'));              // npm -w takes a value
  t.ok(exec('Bash(npm --workspace web exec:*)'));
  t.ok(exec('Bash(pnpm --filter web dlx x:*)'));
  t.eq(P.toolProblem('Bash(npm -w web test:*)'), null);
  t.eq(P.toolProblem('Bash(pnpm -w test:*)'), null);
});

t.test('R4-L3: options whose value-arity differs per PM or is unknown are rejected, not guessed (--config, --color, --config.k=v, yarn -w)', () => {
  for (const e of ['Bash(npm --config exec:*)', 'Bash(npm --config x exec:*)', 'Bash(pnpm --config.registry=x exec:*)', 'Bash(npm --color always exec:*)', 'Bash(yarn -w exec:*)', 'Bash(npm --dir x exec:*)']) {
    t.ok(/not recognised/.test(P.toolProblem(e) || ''), e);
  }
});

t.test('R5-L4: npm explore/rebuild and yarn workspace(s) can run arbitrary subcommands and are rejected', () => {
  for (const e of ['Bash(npm explore:*)', 'Bash(npm rebuild:*)', 'Bash(npm rb:*)', 'Bash(npm --silent explore:*)', 'Bash(yarn workspace:*)', 'Bash(yarn workspaces:*)', 'Bash(yarn workspaces foreach exec:*)']) {
    t.ok(/arbitrary code/.test(P.toolProblem(e) || ''), e);
  }
  for (const e of ['Bash(yarn install:*)', 'Bash(pnpm rebuild:*)', 'Bash(npm ci:*)']) t.eq(P.toolProblem(e), null, e);
});

t.done();
