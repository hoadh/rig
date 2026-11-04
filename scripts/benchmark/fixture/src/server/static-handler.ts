import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface StaticResponse {
  status: number;
  contentType: string;
  body: Buffer | string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function plain(status: number, message: string): StaticResponse {
  return { status, contentType: 'text/plain; charset=utf-8', body: message };
}

/** Serves a file below `rootDir` for the URL path `urlPath` (query string ignored). */
export async function serveStatic(rootDir: string, urlPath: string): Promise<StaticResponse> {
  let relative: string;
  try {
    relative = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return plain(400, 'Bad request');
  }
  if (relative.includes('\0')) return plain(400, 'Bad request');

  let target = path.join(rootDir, relative);
  try {
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const body = await readFile(target);
    const contentType = CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
    return { status: 200, contentType, body };
  } catch {
    return plain(404, 'Not found');
  }
}
