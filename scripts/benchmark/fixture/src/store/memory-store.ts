import { NotFoundError } from '../util/errors.ts';
import { createIdSequence } from '../util/ids.ts';

export class MemoryStore<T extends { id: number }> {
  private items = new Map<number, T>();
  private nextId = createIdSequence();
  private label: string;

  constructor(label: string) {
    this.label = label;
  }

  create(data: Omit<T, 'id'>): T {
    const item = { ...data, id: this.nextId() } as T;
    this.items.set(item.id, item);
    return item;
  }

  find(id: number): T | undefined {
    return this.items.get(id);
  }

  require(id: number): T {
    const item = this.items.get(id);
    if (!item) throw new NotFoundError(this.label, id);
    return item;
  }

  update(id: number, patch: Partial<Omit<T, 'id'>>): T {
    const updated = { ...this.require(id), ...patch } as T;
    this.items.set(id, updated);
    return updated;
  }

  delete(id: number): void {
    this.require(id);
    this.items.delete(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }
}
