#!/usr/bin/env node
/** Tests for verify-command-detector: command-word anchoring, masking, package scripts, runners. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectVerifyCommand, detectPackageManager } = require('../verify-command-detector.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-vcd-'));
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x', 'test:unit': 'x', build: 'x', start: 'x', lint: 'x' } }));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const v = (cmd, extra = {}) => detectVerifyCommand(cmd, { projectDir: dir, cwd: dir, ...extra });

test('real verification commands count', () => {
  const yes = [
    'npm test', 'npm run test:unit', 'pnpm build', 'yarn lint', 'bun test', 'cd sub && npm test', 'sudo -u x npm test',
    'node --test a.js', 'node .claude/hooks/__tests__/x.test.cjs', 'node scripts/run-hook-tests.cjs',
    'node .claude/skills/remote/scripts/tests/run-all-remote-tests.cjs', 'npx tsc --noEmit', 'npx -y vitest run', 'pnpm dlx eslint .',
    'pytest -q', 'python3 -m pytest', 'go test ./...', 'cargo clippy', 'make test', 'make -j4 build', './gradlew test', 'mvn clean verify',
    'dotnet test', 'flutter test', 'php artisan test', 'deno lint', 'ruff check .', 'tsc -p .', 'FOO=1 npm test',
  ];
  for (const c of yes) assert.ok(v(c).isVerify, c);
});

test('non-verification and lookalikes do not count', () => {
  const no = [
    'echo "npm test"', 'grep test README.md', 'git commit -m "npm test"', 'ls', 'make clean', 'make', 'npm install', 'npm run start',
    'npm run deploy', 'yarn add jest', 'cat package.json', 'tsc --init', 'ruff format .', 'node server.js', 'git log --grep=test',
  ];
  for (const c of no) assert.ok(!v(c).isVerify, c);
});

test('script names are whole tokens that exist in package.json', () => {
  assert.ok(!v('npm run testing').isVerify);
  assert.ok(!v('npm run e2e').isVerify, 'e2e not defined in this package.json');
  assert.ok(v('npm run test; echo done').masked);
});

test('masked chains are flagged', () => {
  for (const c of ['npm test || true', 'npm test; true', 'npm test || :', 'npm test || exit 0', 'npm test ||true;']) {
    const r = v(c);
    assert.ok(r.isVerify && r.masked, c);
  }
  assert.ok(!v('npm test && echo ok').masked);
});

test('trailing ; || | & after a verify command mask its exit status (M1)', () => {
  const masked = [
    'npm test; echo done', 'npm test && echo ok || echo fail', 'npm test | tail', 'npm test 2>&1 | tail -20',
    'npm test\necho done', 'npm test &', "bash -c 'npm test' | cat", "bash -c 'npm test'; echo x", 'npm test; npm run lint | tail',
  ];
  for (const c of masked) {
    const r = v(c);
    assert.ok(r.isVerify && r.masked, c);
  }
  const clean = ['npm test', 'npm test;', 'npm test\n', 'npm test && echo ok', 'cd sub && npm test && npm run build', 'echo x; npm test', 'npm test && echo a && echo b', "bash -c 'npm test && echo ok'"];
  for (const c of clean) {
    const r = v(c);
    assert.ok(r.isVerify && !r.masked, c);
  }
});

test('extraPatterns match against the segment words', () => {
  assert.ok(v('./ci/e2e.sh --fast', { extraPatterns: [/^\.\/ci\/e2e\.sh/] }).isVerify);
  assert.ok(!v('./ci/e2e.sh --fast').isVerify);
});

test('garbage and empty input never throw', () => {
  for (const c of [undefined, null, '', '   ', '"unterminated', '$(echo npm) test']) assert.doesNotThrow(() => v(c));
});

test('detectPackageManager reads lockfiles under projectDir', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-pm-'));
  try {
    assert.strictEqual(detectPackageManager(d), null);
    fs.writeFileSync(path.join(d, 'bun.lock'), '');
    assert.strictEqual(detectPackageManager(d), 'bun');
    fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), '');
    assert.strictEqual(detectPackageManager(d), 'pnpm');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
