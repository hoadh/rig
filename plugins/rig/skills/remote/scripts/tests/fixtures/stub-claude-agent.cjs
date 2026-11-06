'use strict';
/**
 * Stub `claude` for loopback e2e. The per-worker launcher script (written by
 * remote-loopback-e2e-fixture.cjs) requires this file; behaviour is chosen by
 * the JSON file `mode.json` next to the launcher because the runner's child
 * env is allowlisted (env vars cannot steer it).
 *
 * mode.json: { files?: {path: content}, tamper?: bool, then?: "done"|"sleep"|"exit1" }
 *   files   committed in the cwd (the worker's run worktree) before finishing
 *   tamper  writes a forbidden git config key (runner must detect it)
 *   then    done = print success JSON; sleep = hang until killed; exit1 = fail
 * Every call appends {argv, task} to argv.log (JSON lines) next to the launcher.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const dir = path.dirname(fs.realpathSync(process.argv[1]));
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
const git = (...a) => cp.execFileSync('git', a, { stdio: 'ignore' });

let task = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { task += c; });
process.stdin.on('end', () => {
  const mode = read('mode.json', {});
  fs.appendFileSync(path.join(dir, 'argv.log'), `${JSON.stringify({ argv: process.argv.slice(2), task })}\n`);
  for (const [file, body] of Object.entries(mode.files || {})) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  if (mode.files) { git('add', '-A'); git('commit', '-q', '-m', `stub agent: ${Object.keys(mode.files).join(',')}`); }
  if (mode.tamper) git('config', 'core.sshCommand', 'evil');
  if (mode.then === 'sleep') return void setInterval(() => {}, 1000);
  if (mode.then === 'exit1') { console.error('stub agent failed'); process.exit(1); }
  console.log(JSON.stringify({ subtype: 'success', is_error: false, result: 'done', num_turns: 1, session_id: mode.sessionId || '123e4567-e89b-42d3-a456-426614174000' }));
});
