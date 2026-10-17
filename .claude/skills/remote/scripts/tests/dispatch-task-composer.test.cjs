'use strict';
const t = require('./minimal-test-harness.cjs');
const { composeTask, stripFrontmatter } = require('../lib/dispatch-task-composer.cjs');
const { BASELINE } = require('../lib/allowed-tools-policy.cjs');

const SHA = 'c'.repeat(40);
const args = { slug: 'plan-a', phase: '02', machine: 'waso', branch: 'rig/waso/plan-a', baseSha: SHA, owns: ['src/**', 'docs/*.md'], phaseText: '---\nmachine: waso\nowns: [src/**]\n---\n# Phase 02\nDo the thing.\n', testHint: 'npm test' };

t.test('header, rules, steps incl. self-review, phase body without frontmatter', () => {
  const task = composeTask(args);
  t.ok(task.includes('plan plan-a, phase 02 on machine waso'));
  t.ok(task.includes(`Base commit: \`${SHA}\``) && task.includes('`rig/waso/plan-a`'));
  t.ok(task.includes('`src/**`, `docs/*.md`'));
  t.ok(task.includes('Do NOT push') && task.includes('100% pass'));
  t.ok(task.includes(`git diff ${SHA}...HEAD`) && /Self-review/.test(task));
  t.ok(task.includes('`git show origin/rig-coord/plan-a:plan.md`'));
  t.ok(BASELINE.includes('Bash(git show:*)')); // every git command the prompt names must be in the baseline
  t.ok(task.includes('# Phase 02\nDo the thing.'));
  t.ok(!task.includes('machine: waso\nowns'));
  t.ok(/informational/.test(task));
  const rules = task.slice(task.indexOf('## Rules'), task.indexOf('## Steps'));
  for (const s of ['permission prompts', 'Write/Edit', 'git -C', 'cd ... &&', 'pipes', 'redirects']) t.ok(rules.includes(s), s);
});

t.test('stripFrontmatter handles CRLF and absent frontmatter', () => {
  t.eq(stripFrontmatter('---\r\na: b\r\n---\r\nbody\r\n'), 'body');
  t.eq(stripFrontmatter('plain'), 'plain');
});

t.test('testHint is named as an allowed prefix', () => {
  t.ok(composeTask(args).includes('allowed test command prefixes: `npm test`; arguments may follow'));
});

t.test('no testHint -> no empty parentheses', () => {
  t.ok(!composeTask({ ...args, testHint: undefined }).includes('pass ()'));
});

t.done();
