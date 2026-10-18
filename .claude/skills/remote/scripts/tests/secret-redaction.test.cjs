'use strict';
const t = require('./minimal-test-harness.cjs');
const { redactText, stripUrlCredentials } = require('../lib/secret-redaction.cjs');

const names = (r) => r.hits.map((h) => h.name).sort();

t.test('redacts known token formats and reports names only', () => {
  const src = [
    'ant sk-ant-api03-abcdefghijkl', 'gh ghp_' + 'a'.repeat(36), 'pat github_pat_' + 'B'.repeat(30),
    'aws AKIAABCDEFGHIJKLMNOP', 'slack xoxb-1234567890-abc', 'url https://bob:hunter2@example.com/x',
  ].join('\n');
  const r = redactText(src);
  t.eq(names(r), ['anthropic-key', 'aws-access-key', 'github-pat', 'github-token', 'slack-token', 'url-credentials']);
  for (const v of ['sk-ant-api03', 'ghp_aaaa', 'github_pat_BBBB', 'AKIAABCD', 'xoxb-1234', 'hunter2']) t.ok(!r.text.includes(v), v);
  t.ok(r.text.includes('[REDACTED]'));
  t.ok(r.text.includes('https://[REDACTED]@example.com'));
});

t.test('private key block removed, surrounding text and CRLF kept', () => {
  const r = redactText('before\r\n-----BEGIN RSA PRIVATE KEY-----\r\nMIIabc\r\n-----END RSA PRIVATE KEY-----\r\nafter\r\n');
  t.eq(names(r), ['private-key']);
  t.eq(r.text, 'before\r\n[REDACTED]\r\nafter\r\n');
});

t.test('clean text unchanged, no hits', () => {
  const r = redactText('nothing secret: sk- short, ghp_x\n');
  t.eq(r.hits, []);
  t.eq(r.text, 'nothing secret: sk- short, ghp_x\n');
});

t.test('stripUrlCredentials', () => {
  t.eq(stripUrlCredentials('https://user:pw@github.com/a/b.git'), 'https://github.com/a/b.git');
  t.eq(stripUrlCredentials('https://TOKEN@github.com/a/b.git'), 'https://github.com/a/b.git');
  t.eq(stripUrlCredentials('ssh://git@github.com/a/b.git'), 'ssh://git@github.com/a/b.git');
  t.eq(stripUrlCredentials('ssh://u:p@h/x'), 'ssh://u@h/x');
  t.eq(stripUrlCredentials('https://u:p@ss@host/x'), 'https://host/x', 'raw @ in password');
  t.eq(stripUrlCredentials('ssh://u:p@ss@host/x'), 'ssh://u@host/x');
  t.eq(stripUrlCredentials('/local/path'), '/local/path');
});

t.done();
