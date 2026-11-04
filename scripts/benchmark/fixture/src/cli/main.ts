import { STATUSES } from '../models/types.ts';
import type { Status } from '../models/types.ts';
import type { ReportService } from '../services/report-service.ts';
import type { TicketService } from '../services/ticket-service.ts';
import { formatTable, pluralize, truncate } from '../util/text.ts';
import { intFlag, parseArgs } from './args.ts';

export interface CliContext {
  tickets: TicketService;
  reports: ReportService;
}

const USAGE = `Usage: taskboard <command> [options]
  list [--project N] [--status S] [--page N] [--page-size N]
  add --title T --project N
  status <ticketId> <status>
  summary [--project N]`;

function listCommand(ctx: CliContext, flags: ReturnType<typeof parseArgs>['flags']): string {
  const status = typeof flags.status === 'string' ? (flags.status as Status) : undefined;
  if (status && !STATUSES.includes(status)) {
    throw new Error(`--status must be one of ${STATUSES.join(', ')}`);
  }
  const page = ctx.tickets.list({
    projectId: intFlag(flags, 'project'),
    status,
    page: intFlag(flags, 'page'),
    pageSize: intFlag(flags, 'page-size'),
  });
  const rows = page.items.map((t) => [String(t.id), truncate(t.title, 40), t.status, t.priority, t.dueDate ?? '-']);
  const table = formatTable(['ID', 'TITLE', 'STATUS', 'PRIORITY', 'DUE'], rows);
  return `${table}\n\nPage ${page.page}/${page.totalPages} (${pluralize(page.total, 'ticket')})`;
}

/** Runs one CLI invocation and returns the text to print. Throws on usage errors. */
export function runCli(argv: string[], ctx: CliContext): string {
  const { command, positionals, flags } = parseArgs(argv);
  switch (command) {
    case 'list':
      return listCommand(ctx, flags);
    case 'add': {
      const projectId = intFlag(flags, 'project');
      if (projectId === undefined) throw new Error('--project is required');
      const ticket = ctx.tickets.create({ title: flags.title, projectId });
      return `Created ticket ${ticket.id}: ${ticket.title}`;
    }
    case 'status': {
      const [id, status] = positionals;
      const ticket = ctx.tickets.setStatus(Number(id), status as Status);
      return `Ticket ${ticket.id} is now ${ticket.status}`;
    }
    case 'summary':
      return ctx.reports.render(intFlag(flags, 'project'));
    case 'help':
      return USAGE;
    default:
      throw new Error(`Unknown command "${command}"\n${USAGE}`);
  }
}
