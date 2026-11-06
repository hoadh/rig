#!/usr/bin/env node
'use strict';
/**
 * rig:remote worker CLI (runs on every machine). Reads the JSON envelope from
 * stdin, runs worker-commands/<sub>-command.cjs, and emits exactly one
 * `RIGJSON:<nonce>:<json>` line on stdout. User/agent output must never reach
 * stdout (commands send it to log files).
 */
const path = require('path');
const { EXIT, RemoteError } = require('./lib/remote-errors.cjs');
const { helpText, dispatch } = require('./lib/subcommand-router.cjs');
const framing = require('./lib/rig-json-nonce-framing.cjs');

const COMMANDS_DIR = path.join(__dirname, 'worker-commands');

async function loadEnvelope() {
  const manual = () => ({ nonce: framing.makeNonce(), protocol: framing.PROTOCOL_VERSION, payload: null });
  if (process.stdin.isTTY) return manual(); // manual run: `worker.cjs info` by hand
  const text = await framing.readStdin();
  // plain `ssh host node worker.cjs baseline ...` has an empty non-TTY stdin: same manual envelope
  if (!text || !text.trim()) return manual();
  return framing.parseEnvelope(text);
}

async function main(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(helpText('rig:remote worker', COMMANDS_DIR));
    return sub ? EXIT.OK : EXIT.USAGE;
  }
  let env;
  try {
    env = await loadEnvelope();
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return EXIT.USAGE; // no nonce -> cannot frame a reply
  }
  let replied = false;
  const reply = (obj) => {
    if (replied) throw new Error('worker may reply only once');
    replied = true;
    process.stdout.write(framing.frameReply(env.nonce, obj));
  };
  try {
    return await dispatch(COMMANDS_DIR, sub, rest, { reply, payload: env.payload, protocol: env.protocol, nonce: env.nonce });
  } catch (err) {
    const known = err instanceof RemoteError;
    process.stderr.write(`error: ${err.message}\n`);
    if (!replied) reply({ error: { message: err.message, class: known ? err.class : 'internal', hint: known ? err.hint : null } });
    return known ? err.exitCode : EXIT.ERROR;
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
