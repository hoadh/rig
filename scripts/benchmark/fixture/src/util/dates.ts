const DAY_MS = 24 * 60 * 60 * 1000;

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A ticket is overdue when its due date is strictly before today (UTC). */
export function isOverdue(dueDate: string | null, now: Date): boolean {
  if (!dueDate) return false;
  return dueDate < toIsoDate(now);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return toIsoDate(new Date(Date.parse(date) + days * DAY_MS));
}
