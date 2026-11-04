import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createRateLimiter } from '../../src/server/rate-limiter.ts';
import { buildBoard } from '../helpers.ts';

test('limiter allows up to limit requests per key per window', () => {
  let now = 1_000;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => now });
  assert.deepEqual(limiter.check('a').remaining, 2);
  assert.equal(limiter.check('a').remaining, 1);
  const third = limiter.check('a');
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  const fourth = limiter.check('a');
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
  assert.ok(fourth.retryAfterMs > 0 && fourth.retryAfterMs <= 1000, `retryAfterMs=${fourth.retryAfterMs}`);
  assert.equal(limiter.check('b').allowed, true, 'keys are independent');
  now += 1000;
  assert.equal(limiter.check('a').allowed, true, 'window expired');
});

test('limiter retryAfterMs shrinks as time passes', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
  limiter.check('k');
  now = 400;
  const denied = limiter.check('k');
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs <= 600 && denied.retryAfterMs > 0, `retryAfterMs=${denied.retryAfterMs}`);
});

test('limiter rejects invalid options', () => {
  assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1000 }));
  assert.throws(() => createRateLimiter({ limit: 5, windowMs: -1 }));
});

test('loadConfig exposes rateLimit with defaults and env overrides', () => {
  assert.deepEqual(loadConfig({}).rateLimit, { limit: 100, windowMs: 60000 });
  assert.deepEqual(loadConfig({ RATE_LIMIT_MAX: '5', RATE_LIMIT_WINDOW_MS: '2000' }).rateLimit, { limit: 5, windowMs: 2000 });
  assert.throws(() => loadConfig({ RATE_LIMIT_MAX: '0' }), /RATE_LIMIT_MAX/);
  assert.throws(() => loadConfig({ RATE_LIMIT_WINDOW_MS: 'abc' }), /RATE_LIMIT_WINDOW_MS/);
  assert.equal(loadConfig({}).port, 3000);
});

test('app answers 429 with Retry-After once a client exceeds the limit', async () => {
  let now = 50_000;
  const { tickets } = buildBoard(1);
  const config = { ...loadConfig({}), rateLimit: { limit: 2, windowMs: 10_000 } };
  const app = createApp({ config, tickets, now: () => now });
  const req = { method: 'GET', path: '/api/tickets', ip: '10.0.0.1' };
  assert.equal((await app.handle(req)).status, 200);
  assert.equal((await app.handle(req)).status, 200);
  const limited = await app.handle(req);
  assert.equal(limited.status, 429);
  assert.deepEqual(JSON.parse(String(limited.body)), { error: 'rate limit exceeded' });
  const retryAfter = Number(limited.headers['Retry-After']);
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 10, `Retry-After=${retryAfter}`);
  assert.equal((await app.handle({ ...req, ip: '10.0.0.2' })).status, 200, 'other clients unaffected');
  now += 10_000;
  assert.equal((await app.handle(req)).status, 200, 'allowed again after the window');
});

test('README documents the rate limit settings', () => {
  const readme = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../README.md'), 'utf8');
  assert.match(readme, /RATE_LIMIT_MAX/);
  assert.match(readme, /RATE_LIMIT_WINDOW_MS/);
});
