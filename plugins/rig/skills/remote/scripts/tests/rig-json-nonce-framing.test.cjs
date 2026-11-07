'use strict';
const t = require('./minimal-test-harness.cjs');
const F = require('../lib/rig-json-nonce-framing.cjs');

const nonce = F.makeNonce();

t.test('nonce is 32 hex, unique', () => {
  t.ok(/^[0-9a-f]{32}$/.test(nonce));
  t.ok(F.makeNonce() !== nonce);
});
t.test('envelope round trip', () => {
  const env = F.parseEnvelope(F.buildEnvelope(nonce, { a: 1 }));
  t.eq(env, { nonce, protocol: F.PROTOCOL_VERSION, payload: { a: 1 } });
  t.eq(F.parseEnvelope(F.buildEnvelope(nonce)).payload, null);
});
t.test('envelope rejects garbage / bad nonce', () => {
  t.assert.throws(() => F.parseEnvelope('{x'));
  t.assert.throws(() => F.parseEnvelope(JSON.stringify({ nonce: 'short', protocol: 1 })));
  t.assert.throws(() => F.parseEnvelope('null'));
});
t.test('frameReply yields single line, parses back', () => {
  const line = F.frameReply(nonce, { msg: 'a\nb', n: 1 });
  t.eq(line.split('\n').length, 2); // one line + trailing newline
  t.eq(F.parseReply(`noise\n${line}`, nonce), { status: 'ok', reply: { msg: 'a\nb', n: 1 } });
});
t.test('forged line without nonce is ignored', () => {
  t.eq(F.parseReply('RIGJSON:{"ok":true}\n', nonce), { status: 'none' });
  t.eq(F.parseReply('RIGJSON::{"ok":true}\n', nonce), { status: 'none' });
});
t.test('forged line with wrong nonce is ignored, real one still found', () => {
  const forged = F.frameReply(F.makeNonce(), { evil: true });
  const real = F.frameReply(nonce, { good: true });
  t.eq(F.parseReply(forged, nonce), { status: 'none' });
  t.eq(F.parseReply(forged + real, nonce).reply, { good: true });
});
t.test('two matching lines -> multiple', () => {
  const l = F.frameReply(nonce, { a: 1 });
  t.eq(F.parseReply(l + l, nonce), { status: 'multiple' });
});
t.test('CRLF output tolerated; invalid JSON reported', () => {
  t.eq(F.parseReply(F.frameReply(nonce, { a: 1 }).replace('\n', '\r\n'), nonce).reply, { a: 1 });
  t.eq(F.parseReply(`RIGJSON:${nonce}:{oops\n`, nonce).status, 'invalid-json');
});
t.test('nonce prefix match is exact (not substring of other text)', () => {
  t.eq(F.parseReply(`log RIGJSON:${nonce}:{"a":1}\n`, nonce), { status: 'none' });
});

t.done();
