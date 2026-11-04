import type { Priority, Status, Ticket } from '../models/types.ts';
import { isOverdue } from '../util/dates.ts';

export interface TicketSummary {
  total: number;
  overdue: number;
  byStatus: Partial<Record<Status, number>>;
  byPriority: Partial<Record<Priority, number>>;
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

export function summarizeTickets(tickets: Ticket[], now: Date): TicketSummary {
  return {
    total: tickets.length,
    overdue: tickets.filter((t) => t.status !== 'done' && isOverdue(t.dueDate, now)).length,
    byStatus: countBy(tickets, (t) => t.status),
    byPriority: countBy(tickets, (t) => t.priority),
  };
}
