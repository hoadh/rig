import type { AppConfig } from '../config.ts';
import type { TicketService } from '../services/ticket-service.ts';
import { NotFoundError, ValidationError } from '../util/errors.ts';
import { serveStatic } from './static-handler.ts';

export interface AppRequest {
  method: string;
  /** Path plus optional query string, e.g. `/api/tickets?page=2`. */
  path: string;
  ip: string;
}

export interface AppResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string;
}

export interface AppOptions {
  config: AppConfig;
  tickets: TicketService;
}

function json(status: number, data: unknown): AppResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}

export function createApp(options: AppOptions) {
  const { config, tickets } = options;

  async function route(req: AppRequest): Promise<AppResponse> {
    const url = new URL(req.path, 'http://localhost');
    if (req.method !== 'GET') return json(405, { error: 'method not allowed' });

    if (url.pathname === '/api/tickets') {
      const page = Number(url.searchParams.get('page') ?? 1);
      return json(200, tickets.list({ page, pageSize: config.pageSize }));
    }
    if (url.pathname.startsWith('/static/')) {
      const file = await serveStatic(config.staticDir, url.pathname.slice('/static'.length));
      return { status: file.status, headers: { 'Content-Type': file.contentType }, body: file.body };
    }
    return json(404, { error: 'not found' });
  }

  return {
    async handle(req: AppRequest): Promise<AppResponse> {
      try {
        return await route(req);
      } catch (err) {
        if (err instanceof NotFoundError) return json(404, { error: err.message });
        if (err instanceof ValidationError || err instanceof RangeError) {
          return json(400, { error: err.message });
        }
        return json(500, { error: 'internal error' });
      }
    },
  };
}
