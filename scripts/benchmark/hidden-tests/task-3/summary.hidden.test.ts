import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeTickets } from '../../src/store/aggregate.ts';
import { formatSummary } from '../../src/services/report-service.ts';
import { buildBoard, NOW } from '../helpers.ts';

test('summarizeTickets keys by the exact status and priority values', () => {
  const { tickets, project } = buildBoard();
  tickets.create({ title: 'One', projectId: project.id, priority: 'high' }, NOW);
  tickets.create({ title: 'Two', projectId: project.id, priority: 'low' }, NOW);
  tickets.setStatus(1, 'in_progress');
  tickets.setStatus(2, 'in_progress');
  const summary = summarizeTickets(tickets.filter(), NOW);
  assert.deepEqual(summary.byStatus, { in_progress: 2 });
  assert.deepEqual(summary.byPriority, { high: 1, low: 1 });
});

test('rendered report shows in_progress and blocked counts', () => {
  const { tickets, reports } = buildBoard(4);
  tickets.setStatus(1, 'in_progress');
  tickets.setStatus(2, 'in_progress');
  tickets.setStatus(3, 'blocked');
  assert.equal(
    reports.render(),
    ['Total: 4', 'Overdue: 0', 'By status:', '  open: 1', '  in_progress: 2', '  done: 0', '  blocked: 1'].join('\n'),
  );
});

test('formatSummary prints 0 for statuses without tickets', () => {
  const out = formatSummary({ total: 0, overdue: 0, byStatus: {}, byPriority: {} });
  assert.match(out, /in_progress: 0/);
});

test('overdue ignores done tickets', () => {
  const { tickets, project } = buildBoard();
  tickets.create({ title: 'Old done', projectId: project.id, dueDate: '2026-01-01' }, NOW);
  tickets.create({ title: 'Old open', projectId: project.id, dueDate: '2026-01-01' }, NOW);
  tickets.setStatus(1, 'done');
  assert.equal(summarizeTickets(tickets.filter(), NOW).overdue, 1);
});
