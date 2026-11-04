import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli } from '../../src/cli/main.ts';
import { buildBoard } from '../helpers.ts';

test('list --format json prints the page object as JSON', () => {
  const { tickets, reports } = buildBoard(3);
  const out = runCli(['list', '--format', 'json'], { tickets, reports });
  const page = JSON.parse(out);
  assert.equal(page.total, 3);
  assert.equal(page.page, 1);
  assert.equal(page.totalPages, 1);
  assert.deepEqual(page.items.map((t: { title: string }) => t.title), ['Ticket 1', 'Ticket 2', 'Ticket 3']);
});

test('list --format=json works with filters and paging', () => {
  const { tickets, reports } = buildBoard(5);
  tickets.setStatus(4, 'done');
  const page = JSON.parse(runCli(['list', '--format=json', '--status', 'done'], { tickets, reports }));
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, 4);
  const paged = JSON.parse(runCli(['list', '--format', 'json', '--page-size', '2', '--page', '2'], { tickets, reports }));
  assert.deepEqual(paged.items.map((t: { id: number }) => t.id), [3, 4]);
});

test('JSON output is pretty-printed with two spaces and has no table footer', () => {
  const { tickets, reports } = buildBoard(1);
  const out = runCli(['list', '--format', 'json'], { tickets, reports });
  assert.ok(out.startsWith('{\n  "items"'), out.slice(0, 30));
  assert.doesNotMatch(out, /Page 1\//);
});

test('--format text keeps the table, unknown formats are rejected', () => {
  const { tickets, reports } = buildBoard(1);
  assert.match(runCli(['list', '--format', 'text'], { tickets, reports }), /^ID\s+TITLE/);
  assert.throws(() => runCli(['list', '--format', 'xml'], { tickets, reports }), /format must be text or json/);
});
