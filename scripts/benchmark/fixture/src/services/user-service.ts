import type { User } from '../models/types.ts';
import { MemoryStore } from '../store/memory-store.ts';
import { ValidationError } from '../util/errors.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export interface UserInput {
  name: unknown;
  email: unknown;
}

export class UserService {
  private store: MemoryStore<User>;

  constructor(store = new MemoryStore<User>('user')) {
    this.store = store;
  }

  create(input: UserInput, now = new Date()): User {
    const name = requireString(input.name, 'name');
    checkLength(name, 'name', 2, 50);
    const email = requireString(input.email, 'email').toLowerCase();
    checkLength(email, 'email', 5, 120);
    if (!EMAIL_PATTERN.test(email)) {
      throw new ValidationError('email', 'email is not a valid address');
    }
    if (this.store.all().some((u) => u.email === email)) {
      throw new ValidationError('email', 'email is already registered');
    }
    return this.store.create({ name, email, createdAt: now.toISOString() });
  }

  get(id: number): User {
    return this.store.require(id);
  }

  list(): User[] {
    return this.store.all();
  }

  rename(id: number, name: unknown): User {
    const clean = requireString(name, 'name');
    checkLength(clean, 'name', 2, 50);
    return this.store.update(id, { name: clean });
  }
}
