import { ProjectService } from '../src/services/project-service.ts';
import { ReportService } from '../src/services/report-service.ts';
import { TicketService } from '../src/services/ticket-service.ts';
import { UserService } from '../src/services/user-service.ts';

export const NOW = new Date('2026-03-10T12:00:00Z');

/** Builds a board with one user, one project and `ticketCount` tickets. */
export function buildBoard(ticketCount = 0) {
  const users = new UserService();
  const projects = new ProjectService(users);
  const tickets = new TicketService(projects, users);
  const owner = users.create({ name: 'Ada Owner', email: 'ada@example.com' }, NOW);
  const project = projects.create({ name: 'Alpha', description: 'First project', ownerId: owner.id });
  for (let i = 1; i <= ticketCount; i++) {
    tickets.create({ title: `Ticket ${i}`, projectId: project.id }, NOW);
  }
  const reports = new ReportService(tickets, () => NOW);
  return { users, projects, tickets, reports, owner, project };
}
