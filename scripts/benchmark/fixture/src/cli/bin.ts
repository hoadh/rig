import { ProjectService } from '../services/project-service.ts';
import { ReportService } from '../services/report-service.ts';
import { TicketService } from '../services/ticket-service.ts';
import { UserService } from '../services/user-service.ts';
import { runCli } from './main.ts';

// Demo wiring: an empty in-memory board seeded with one user and project.

const users = new UserService();
const projects = new ProjectService(users);
const tickets = new TicketService(projects, users);
const owner = users.create({ name: 'Demo User', email: 'demo@example.com' });
projects.create({ name: 'Demo', description: 'Seed project', ownerId: owner.id });

try {
  console.log(runCli(process.argv.slice(2), { tickets, reports: new ReportService(tickets) }));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
