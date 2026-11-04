import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard } from './helpers.ts';

test('summary report lists in-progress tickets', () => {
  const { tickets, reports } = buildBoard(3);
  tickets.setStatus(1, 'in_progress');
  tickets.setStatus(2, 'in_progress');
  const out = reports.render();
  assert.match(out, /Total: 3/);
  assert.match(out, / {2}in_progress: 2/);
});
