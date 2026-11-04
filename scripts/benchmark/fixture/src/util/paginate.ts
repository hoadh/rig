export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const MAX_PAGE_SIZE = 100;

/** Returns one page of `items`. Pages are 1-based. */
export function paginate<T>(items: T[], page = 1, pageSize = 10): Page<T> {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError('page must be a positive integer');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return { items: items.slice(start, end), page, pageSize, total, totalPages };
}
