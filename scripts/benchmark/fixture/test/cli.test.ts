import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/cli/args.ts';
import { runCli } from '../src/cli/main.ts';
import { buildBoard } from './helpers.ts';

test('parseArgs handles positionals, --k v, --k=v and bare flags', () => {
  const parsed = parseArgs(['list', 'extra', '--page', '2', '--status=open', '--verbose']);
  assert.equal(parsed.command, 'list');
  assert.deepEqual(parsed.positionals, ['extra']);
  assert.deepEqual(parsed.flags, { page: '2', status: 'open', verbose: true });
});

test('list prints a table with a page footer', () => {
  const { tickets, reports } = buildBoard(2);
  const out = runCli(['list'], { tickets, reports });
  assert.match(out, /^ID\s+TITLE\s+STATUS\s+PRIORITY\s+DUE/);
  assert.match(out, /Ticket 1\s+open\s+medium/);
  assert.match(out, /Page 1\/1 \(2 tickets\)/);
});

test('add creates a ticket and status updates it', () => {
  const { tickets, reports, project } = buildBoard();
  assert.equal(runCli(['add', '--title', 'Write docs', '--project', String(project.id)], { tickets, reports }), 'Created ticket 1: Write docs');
  assert.equal(runCli(['status', '1', 'done'], { tickets, reports }), 'Ticket 1 is now done');
});

test('unknown commands and bad flags throw', () => {
  const { tickets, reports } = buildBoard();
  assert.throws(() => runCli(['frobnicate'], { tickets, reports }), /Unknown command/);
  assert.throws(() => runCli(['list', '--status', 'nope'], { tickets, reports }), /--status must be one of/);
  assert.throws(() => runCli(['list', '--page', 'x'], { tickets, reports }), /--page must be an integer/);
});
