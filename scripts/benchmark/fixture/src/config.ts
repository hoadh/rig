export interface AppConfig {
  port: number;
  staticDir: string;
  pageSize: number;
}

function readPositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    port: readPositiveInt(env.PORT, 3000, 'PORT'),
    staticDir: env.STATIC_DIR || 'public',
    pageSize: readPositiveInt(env.PAGE_SIZE, 10, 'PAGE_SIZE'),
  };
}
