import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from '../src/store/memory-store.ts';
import { countBy } from '../src/store/aggregate.ts';
import { addDays, daysBetween, isOverdue } from '../src/util/dates.ts';
import { formatTable, padRight, pluralize, truncate } from '../src/util/text.ts';

test('text helpers', () => {
  assert.equal(truncate('abcdef', 4), 'abc~');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(padRight('ab', 4), 'ab  ');
  assert.equal(pluralize(1, 'ticket'), '1 ticket');
  assert.equal(pluralize(2, 'ticket'), '2 tickets');
  assert.equal(formatTable(['A', 'B'], [['1', 'xx']]), 'A  B\n-  --\n1  xx');
});

test('date helpers', () => {
  const now = new Date('2026-03-10T08:00:00Z');
  assert.equal(isOverdue('2026-03-09', now), true);
  assert.equal(isOverdue('2026-03-10', now), false);
  assert.equal(isOverdue(null, now), false);
  assert.equal(daysBetween('2026-03-01', '2026-03-10'), 9);
  assert.equal(addDays('2026-03-31', 1), '2026-04-01');
});

test('MemoryStore create, update, delete', () => {
  const store = new MemoryStore<{ id: number; v: string }>('thing');
  const a = store.create({ v: 'a' });
  assert.equal(a.id, 1);
  assert.equal(store.update(1, { v: 'b' }).v, 'b');
  store.delete(1);
  assert.equal(store.find(1), undefined);
  assert.throws(() => store.require(1), /thing 1 not found/);
});

test('countBy counts keys', () => {
  assert.deepEqual(countBy(['a', 'b', 'a'], (x) => x), { a: 2, b: 1 });
});
