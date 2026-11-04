import { STATUSES } from '../models/types.ts';
import { summarizeTickets } from '../store/aggregate.ts';
import type { TicketSummary } from '../store/aggregate.ts';
import type { TicketService } from './ticket-service.ts';

export function formatSummary(summary: TicketSummary): string {
  const lines = [`Total: ${summary.total}`, `Overdue: ${summary.overdue}`, 'By status:'];
  for (const status of STATUSES) {
    lines.push(`  ${status}: ${summary.byStatus[status] ?? 0}`);
  }
  return lines.join('\n');
}

export class ReportService {
  private tickets: TicketService;
  private clock: () => Date;

  constructor(tickets: TicketService, clock: () => Date = () => new Date()) {
    this.tickets = tickets;
    this.clock = clock;
  }

  summary(projectId?: number): TicketSummary {
    return summarizeTickets(this.tickets.filter({ projectId }), this.clock());
  }

  render(projectId?: number): string {
    return formatSummary(this.summary(projectId));
  }
}
