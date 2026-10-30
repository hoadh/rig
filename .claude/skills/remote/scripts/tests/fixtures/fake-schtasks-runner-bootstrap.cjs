'use strict';
/**
 * Started by the fake schtasks through WMI (Win32_Process.Create), so it holds none of the fake's inherited pipe
 * handles. It restores the env the fake was called with (the runner needs RIG_* like the tmux path gets), then
 * starts the real task command detached with its output on <cwd>/runner.log.
 *   node fake-schtasks-runner-bootstrap.cjs <envFile> <cwd> <cmd> [args...]
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const [envFile, cwd, cmd, ...argv] = process.argv.slice(2);
let env;
try { env = JSON.parse(fs.readFileSync(envFile, 'utf8')); } finally { fs.rmSync(envFile, { force: true }); }
const fd = fs.openSync(path.join(cwd, 'runner.log'), 'a');
const child = cp.spawn(cmd, argv, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, cwd, env });
child.on('error', (e) => { fs.writeSync(fd, `fake schtasks: cannot start ${cmd}: ${e.message}\n`); });
child.unref();
