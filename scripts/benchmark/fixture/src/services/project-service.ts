import type { Project } from '../models/types.ts';
import { MemoryStore } from '../store/memory-store.ts';
import { ValidationError } from '../util/errors.ts';
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

export interface ProjectInput {
  name: unknown;
  description?: unknown;
  ownerId: number;
}

export class ProjectService {
  private store: MemoryStore<Project>;
  private users: UserService;

  constructor(users: UserService, store = new MemoryStore<Project>('project')) {
    this.users = users;
    this.store = store;
  }

  create(input: ProjectInput): Project {
    const name = requireString(input.name, 'name');
    checkLength(name, 'name', 2, 50);
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    checkLength(description, 'description', 0, 500);
    this.users.get(input.ownerId);
    if (this.store.all().some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new ValidationError('name', 'project name is already taken');
    }
    return this.store.create({ name, description, ownerId: input.ownerId });
  }

  get(id: number): Project {
    return this.store.require(id);
  }

  list(ownerId?: number): Project[] {
    const all = this.store.all();
    return ownerId === undefined ? all : all.filter((p) => p.ownerId === ownerId);
  }

  remove(id: number): void {
    this.store.delete(id);
  }
}
