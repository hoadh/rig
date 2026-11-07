// Run: node --test scripts/antigravity/claude-code-only-frontmatter-filter.test.cjs
const { test } = require('node:test');
const assert = require('node:assert');
const { filterClaudeCodeOnlyFrontmatter: filter, CLAUDE_CODE_ONLY_KEYS } = require('./claude-code-only-frontmatter-filter.cjs');

test('drops listed keys, keeps name, description, argument-hint and user-invocable', () => {
  const src = '---\nname: fix\ndescription: Fix it\nargument-hint: "[issue]"\nuser-invocable: true\nmodel: opus\neffort: high\nallowed-tools: Bash, Read\n---\nbody\n';
  assert.strictEqual(filter(src), '---\nname: fix\ndescription: Fix it\nargument-hint: "[issue]"\nuser-invocable: true\n---\nbody\n');
});

test('drops a whole block scalar and keeps the key after it', () => {
  const src = '---\nname: a\nhooks: |\n  line one\n\n  line two\ndescription: >-\n  folded\n  text\n---\nbody';
  assert.strictEqual(filter(src), '---\nname: a\ndescription: >-\n  folded\n  text\n---\nbody');
});

test('drops indented and same-column lists and nested maps of a stripped key', () => {
  const src = '---\nname: a\nskills:\n  - one\n  - two\npaths:\n- "src/**"\n- docs\nhooks:\n  PreToolUse:\n    - matcher: Bash\ndescription: d\n---\n';
  assert.strictEqual(filter(src), '---\nname: a\ndescription: d\n---\n');
});

test('keeps unknown keys with their lists and nested values, including a nested key named like a stripped one', () => {
  const src = '---\nname: a\nmetadata:\n  model: keep-me\n  tags:\n    - x\nlanguages:\n- py\nlicense: MIT\ndescription: d\n---\n';
  assert.strictEqual(filter(src), src);
});

test('does not touch the body or a second --- block', () => {
  const src = '---\nname: a\nmodel: x\n---\nmodel: body line\n\n---\nmodel: other\n---\n';
  assert.strictEqual(filter(src), '---\nname: a\n---\nmodel: body line\n\n---\nmodel: other\n---\n');
});

test('keeps CRLF line endings', () => {
  assert.strictEqual(filter('---\r\nname: a\r\nmodel: x\r\ndescription: d\r\n---\r\nbody\r\n'), '---\r\nname: a\r\ndescription: d\r\n---\r\nbody\r\n');
});

test('text without frontmatter and an empty result are handled', () => {
  assert.strictEqual(filter('# title\nmodel: x\n'), '# title\nmodel: x\n');
  assert.strictEqual(filter('---\nmodel: x\n---\nbody'), '---\n---\nbody');
});

test('the strip list matches the spec', () => {
  for (const k of ['context', 'agent', 'background', 'isolation', 'effort', 'skills', 'omitClaudeMd', 'hooks', 'disable-model-invocation', 'paths', 'memory', 'disallowedTools', 'maxTurns', 'model', 'allowed-tools']) assert.ok(CLAUDE_CODE_ONLY_KEYS.has(k), k);
  for (const k of ['name', 'description', 'argument-hint', 'user-invocable']) assert.ok(!CLAUDE_CODE_ONLY_KEYS.has(k), k);
});
