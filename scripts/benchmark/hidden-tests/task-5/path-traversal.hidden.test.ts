import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../../src/server/app.ts';
import { serveStatic } from '../../src/server/static-handler.ts';
import { buildBoard } from '../helpers.ts';

const SECRET = 'TOP-SECRET-CONTENT';

function makeTree() {
  const base = mkdtempSync(path.join(tmpdir(), 'taskboard-traversal-'));
  const root = path.join(base, 'public');
  mkdirSync(path.join(root, 'sub'), { recursive: true });
  mkdirSync(path.join(base, 'public-private'));
  writeFileSync(path.join(root, 'index.html'), 'home');
  writeFileSync(path.join(root, 'sub', 'a.txt'), 'file a');
  writeFileSync(path.join(base, 'secret.txt'), SECRET);
  writeFileSync(path.join(base, 'public-private', 'key.txt'), SECRET);
  return { base, root };
}

const ATTACKS = [
  '/../secret.txt',
  '/sub/../../secret.txt',
  '/%2e%2e/secret.txt',
  '/..%2fsecret.txt',
  '/%2e%2e%2fsecret.txt',
  '/../public-private/key.txt',
  '/sub/..%2f..%2fsecret.txt',
];

test('traversal attempts never return content outside the root', async () => {
  const { root } = makeTree();
  for (const attack of ATTACKS) {
    const res = await serveStatic(root, attack);
    assert.ok([400, 403, 404].includes(res.status), `${attack} -> ${res.status}`);
    assert.ok(!String(res.body).includes(SECRET), `${attack} leaked content`);
  }
});

test('absolute-looking and backslash paths stay inside the root', async () => {
  const { base, root } = makeTree();
  for (const attack of [`/${base}/secret.txt`, '/..\\secret.txt', '/%5c..%5csecret.txt']) {
    const res = await serveStatic(root, attack);
    assert.ok(!String(res.body).includes(SECRET), `${attack} leaked content`);
  }
});

test('legitimate requests still work', async () => {
  const { root } = makeTree();
  assert.equal(String((await serveStatic(root, '/sub/a.txt')).body), 'file a');
  assert.equal(String((await serveStatic(root, '/sub/../index.html')).body), 'home');
  assert.equal(String((await serveStatic(root, '/')).body), 'home');
  assert.equal((await serveStatic(root, '/nope.txt')).status, 404);
});

test('the app route does not leak either', async () => {
  const { root } = makeTree();
  const { tickets } = buildBoard();
  const app = createApp({ config: { port: 1, staticDir: root, pageSize: 10 }, tickets });
  for (const attack of ['/static/..%2fsecret.txt', '/static/%2e%2e%2fsecret.txt', '/static/..%2fpublic-private%2fkey.txt']) {
    const res = await app.handle({ method: 'GET', path: attack, ip: '9.9.9.9' });
    assert.ok(!String(res.body).includes(SECRET), `${attack} leaked content`);
  }
  assert.equal((await app.handle({ method: 'GET', path: '/static/sub/a.txt', ip: '9.9.9.9' })).status, 200);
});
