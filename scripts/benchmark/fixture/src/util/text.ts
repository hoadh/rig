export function truncate(text: string, max: number): string {
  if (max < 1) return '';
  if (text.length <= max) return text;
  return max === 1 ? text.slice(0, 1) : `${text.slice(0, max - 1)}~`;
}

export function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Renders rows as an aligned plain-text table with a header and a rule line. */
export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => padRight(c, widths[i])).join('  ').trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(headers), rule, ...rows.map(line)].join('\n');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
