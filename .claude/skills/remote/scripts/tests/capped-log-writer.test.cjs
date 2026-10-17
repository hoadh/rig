'use strict';
/**
 * Runner log cap (createCappedWriter): bounded payload, exactly one truncation
 * notice, later writes dropped, reopened files count their existing bytes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { createCappedWriter, LOG_CAP_BYTES } = require('../lib/run-child-process-supervisor.cjs');

const NOTICE = '\n[log truncated]\n';
const tmpLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-logcap-')), 'log');
const cleanup = (file) => fs.rmSync(path.dirname(file), { recursive: true, force: true });
const countNotices = (s) => s.split('[log truncated]').length - 1;

t.test('default cap is 20 MB', () => t.eq(LOG_CAP_BYTES, 20 * 1024 * 1024));

t.test('under cap: all bytes kept, no notice', () => {
  const f = tmpLog();
  try {
    const w = createCappedWriter(f, 100);
    w.write(Buffer.from('a'.repeat(60)));
    w.write(Buffer.from('b'.repeat(40)));
    w.close();
    t.eq(fs.readFileSync(f, 'utf8'), `${'a'.repeat(60)}${'b'.repeat(40)}`);
  } finally { cleanup(f); }
});

t.test('exact fit at cap: no notice; next byte triggers one notice and nothing else', () => {
  const f = tmpLog();
  try {
    const w = createCappedWriter(f, 100);
    w.write(Buffer.from('a'.repeat(100)));
    w.write(Buffer.from('b'));
    w.write(Buffer.from('c'.repeat(500)));
    w.close();
    t.eq(fs.readFileSync(f, 'utf8'), `${'a'.repeat(100)}${NOTICE}`);
  } finally { cleanup(f); }
});

t.test('crossing the cap keeps only the room left, then one notice; later writes dropped', () => {
  const f = tmpLog();
  try {
    const w = createCappedWriter(f, 100);
    w.write(Buffer.from('x'.repeat(90)));
    w.write(Buffer.from('y'.repeat(50)));
    w.write(Buffer.from('z'.repeat(50)));
    w.close();
    const s = fs.readFileSync(f, 'utf8');
    t.eq(s, `${'x'.repeat(90)}${'y'.repeat(10)}${NOTICE}`);
    t.eq(countNotices(s), 1);
    t.ok(!s.includes('z'), 'post-truncation bytes must not reach the log');
  } finally { cleanup(f); }
});

t.test('reopened log counts bytes already on disk toward the cap', () => {
  const f = tmpLog();
  try {
    fs.writeFileSync(f, 'p'.repeat(80));
    const w = createCappedWriter(f, 100);
    w.write(Buffer.from('q'.repeat(30)));
    w.close();
    t.eq(fs.readFileSync(f, 'utf8'), `${'p'.repeat(80)}${'q'.repeat(20)}${NOTICE}`);
  } finally { cleanup(f); }
});

t.test('a file already at cap gets only the notice', () => {
  const f = tmpLog();
  try {
    fs.writeFileSync(f, 'p'.repeat(100));
    const w = createCappedWriter(f, 100);
    w.write(Buffer.from('q'));
    w.close();
    t.eq(fs.readFileSync(f, 'utf8'), `${'p'.repeat(100)}${NOTICE}`);
  } finally { cleanup(f); }
});

t.done();
