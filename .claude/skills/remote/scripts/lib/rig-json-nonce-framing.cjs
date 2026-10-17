'use strict';
/**
 * Nonce-framed reply protocol. Orchestrator sends {nonce, protocol, payload}
 * on stdin; worker answers with exactly one line `RIGJSON:<nonce>:<json>`.
 * The nonce lives only in memory of both processes (never disk/log), so
 * output written by agents/tests cannot forge a reply.
 */
const crypto = require('crypto');

const PROTOCOL_VERSION = 1;
const NONCE_RE = /^[0-9a-f]{32}$/;

const makeNonce = () => crypto.randomBytes(16).toString('hex');

/** Serialised stdin envelope sent to the worker. */
function buildEnvelope(nonce, payload) {
  return JSON.stringify({ nonce, protocol: PROTOCOL_VERSION, payload: payload === undefined ? null : payload });
}

/** Worker side: parse + validate an envelope string. Throws Error on malformed input. */
function parseEnvelope(text) {
  let env;
  try {
    env = JSON.parse(text);
  } catch (e) {
    throw new Error(`stdin envelope is not JSON: ${e.message}`);
  }
  if (!env || typeof env !== 'object' || !NONCE_RE.test(env.nonce || '')) throw new Error('stdin envelope has no valid nonce');
  return { nonce: env.nonce, protocol: env.protocol, payload: env.payload === undefined ? null : env.payload };
}

/** One framed reply line (JSON.stringify never emits raw newlines). */
const frameReply = (nonce, obj) => `RIGJSON:${nonce}:${JSON.stringify(obj)}\n`;

/**
 * Orchestrator side: find the framed reply in worker stdout.
 * Lines without the exact nonce prefix are ignored (forgery/noise).
 * @returns {{status:'ok', reply:object}|{status:'none'}|{status:'multiple'}|{status:'invalid-json', error:string}}
 */
function parseReply(stdout, nonce) {
  const prefix = `RIGJSON:${nonce}:`;
  const hits = String(stdout).split(/\r?\n/).filter((l) => l.startsWith(prefix));
  if (hits.length === 0) return { status: 'none' };
  if (hits.length > 1) return { status: 'multiple' };
  try {
    return { status: 'ok', reply: JSON.parse(hits[0].slice(prefix.length)) };
  } catch (e) {
    return { status: 'invalid-json', error: e.message };
  }
}

/** Worker side: read all of stdin (async). */
function readStdin(stream = process.stdin) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

module.exports = { PROTOCOL_VERSION, makeNonce, buildEnvelope, parseEnvelope, frameReply, parseReply, readStdin };
