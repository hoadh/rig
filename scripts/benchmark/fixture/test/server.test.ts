import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/server/app.ts';
import { serveStatic } from '../src/server/static-handler.ts';
import { loadConfig } from '../src/config.ts';
import { buildBoard } from './helpers.ts';

function makeSite() {
  const root = mkdtempSync(path.join(tmpdir(), 'taskboard-site-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
  writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)');
  return root;
}

test('serveStatic serves files with a content type', async () => {
  const root = makeSite();
  const res = await serveStatic(root, '/assets/app.js');
  assert.equal(res.status, 200);
  assert.match(res.contentType, /javascript/);
  assert.equal(String(res.body), 'console.log(1)');
});

test('serveStatic serves index.html for directories and 404s on misses', async () => {
  const root = makeSite();
  assert.equal(String((await serveStatic(root, '/')).body), '<h1>home</h1>');
  assert.equal((await serveStatic(root, '/missing.txt')).status, 404);
  assert.equal((await serveStatic(root, '/%E0%A4%A')).status, 400);
});

test('loadConfig applies defaults and rejects bad numbers', () => {
  assert.deepEqual(loadConfig({}), { port: 3000, staticDir: 'public', pageSize: 10 });
  assert.equal(loadConfig({ PORT: '8080' }).port, 8080);
  assert.throws(() => loadConfig({ PAGE_SIZE: '0' }), /PAGE_SIZE/);
});

test('app routes the API and static paths', async () => {
  const root = makeSite();
  const { tickets } = buildBoard(3);
  const app = createApp({ config: { port: 1, staticDir: root, pageSize: 10 }, tickets });
  const api = await app.handle({ method: 'GET', path: '/api/tickets?page=1', ip: '1.1.1.1' });
  assert.equal(api.status, 200);
  assert.equal(JSON.parse(String(api.body)).total, 3);
  assert.equal((await app.handle({ method: 'GET', path: '/static/index.html', ip: 'x' })).status, 200);
  assert.equal((await app.handle({ method: 'GET', path: '/nope', ip: 'x' })).status, 404);
  assert.equal((await app.handle({ method: 'POST', path: '/api/tickets', ip: 'x' })).status, 405);
  assert.equal((await app.handle({ method: 'GET', path: '/api/tickets?page=0', ip: 'x' })).status, 400);
});
