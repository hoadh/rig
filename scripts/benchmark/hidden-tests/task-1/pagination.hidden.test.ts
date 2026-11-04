import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginate } from '../../src/util/paginate.ts';
import { buildBoard } from '../helpers.ts';

const numbers = Array.from({ length: 25 }, (_, i) => i + 1);

test('a full page holds exactly pageSize items', () => {
  assert.equal(paginate(numbers, 1, 10).items.length, 10);
  assert.deepEqual(paginate(numbers, 2, 10).items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

test('the last page holds the remainder', () => {
  assert.deepEqual(paginate(numbers, 3, 10).items, [21, 22, 23, 24, 25]);
});

test('pages concatenate back to the original list', () => {
  const rebuilt = [1, 2, 3].flatMap((p) => paginate(numbers, p, 10).items);
  assert.deepEqual(rebuilt, numbers);
});

test('page beyond the end is empty', () => {
  assert.deepEqual(paginate(numbers, 4, 10).items, []);
});

test('ticket list returns pageSize tickets per page', () => {
  const { tickets } = buildBoard(12);
  const page = tickets.list({ page: 1, pageSize: 5 });
  assert.deepEqual(page.items.map((t) => t.id), [1, 2, 3, 4, 5]);
  assert.equal(tickets.list({ page: 3, pageSize: 5 }).items.length, 2);
});
