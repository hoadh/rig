import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginate } from '../src/util/paginate.ts';

test('paginate reports total pages', () => {
  const page = paginate([1, 2, 3, 4, 5], 1, 2);
  assert.equal(page.totalPages, 3);
  assert.equal(page.total, 5);
});

test('paginate returns everything when it fits on one page', () => {
  assert.deepEqual(paginate([1, 2, 3]).items, [1, 2, 3]);
});

test('paginate of an empty list has one empty page', () => {
  const page = paginate([]);
  assert.equal(page.totalPages, 1);
  assert.deepEqual(page.items, []);
});

test('paginate rejects invalid page and pageSize', () => {
  assert.throws(() => paginate([1], 0), RangeError);
  assert.throws(() => paginate([1], 1, 0), RangeError);
  assert.throws(() => paginate([1], 1, 101), RangeError);
});
