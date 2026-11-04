import { PRIORITIES, STATUSES } from '../models/types.ts';
import type { Priority, Status, Ticket } from '../models/types.ts';
import { MemoryStore } from '../store/memory-store.ts';
import { ValidationError } from '../util/errors.ts';
import { paginate } from '../util/paginate.ts';
import type { Page } from '../util/paginate.ts';
import type { ProjectService } from './project-service.ts';
import type { UserService } from './user-service.ts';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(field, `${field} is required`);
  }
  return value.trim();
}

function checkLength(value: string, field: string, min: number, max: number): void {
  if (value.length < min || value.length > max) {
    throw new ValidationError(field, `${field} must be between ${min} and ${max} characters`);
  }
}

export interface TicketInput {
  title: unknown;
  description?: unknown;
  projectId: number;
  assigneeId?: number | null;
  priority?: Priority;
  dueDate?: string | null;
}

export interface TicketQuery {
  projectId?: number;
  status?: Status;
  page?: number;
  pageSize?: number;
}

export class TicketService {
  private store: MemoryStore<Ticket>;
  private projects: ProjectService;
  private users: UserService;

  constructor(projects: ProjectService, users: UserService, store = new MemoryStore<Ticket>('ticket')) {
    this.projects = projects;
    this.users = users;
    this.store = store;
  }

  create(input: TicketInput, now = new Date()): Ticket {
    const title = requireString(input.title, 'title');
    checkLength(title, 'title', 3, 100);
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    checkLength(description, 'description', 0, 1000);
    this.projects.get(input.projectId);
    if (input.assigneeId != null) this.users.get(input.assigneeId);
    const priority = input.priority ?? 'medium';
    if (!PRIORITIES.includes(priority)) {
      throw new ValidationError('priority', `priority must be one of ${PRIORITIES.join(', ')}`);
    }
    return this.store.create({
      title,
      description,
      projectId: input.projectId,
      assigneeId: input.assigneeId ?? null,
      status: 'open',
      priority,
      dueDate: input.dueDate ?? null,
      createdAt: now.toISOString(),
    });
  }

  get(id: number): Ticket {
    return this.store.require(id);
  }

  setStatus(id: number, status: Status): Ticket {
    if (!STATUSES.includes(status)) {
      throw new ValidationError('status', `status must be one of ${STATUSES.join(', ')}`);
    }
    return this.store.update(id, { status });
  }

  /** All tickets matching the filters, oldest first. */
  filter(query: Pick<TicketQuery, 'projectId' | 'status'> = {}): Ticket[] {
    return this.store
      .all()
      .filter((t) => query.projectId === undefined || t.projectId === query.projectId)
      .filter((t) => query.status === undefined || t.status === query.status);
  }

  list(query: TicketQuery = {}): Page<Ticket> {
    return paginate(this.filter(query), query.page, query.pageSize);
  }
}
