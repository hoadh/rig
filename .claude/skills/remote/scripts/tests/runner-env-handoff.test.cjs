'use strict';
/** Env handoff: secrets reach the runner via 0600 env.json, never argv; file removed after load. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { writeEnvHandoff, loadEnvHandoff } = require('../lib/runner-env-handoff.cjs');

const SECRET = 'sk-ant-SECRETVALUE-123456';
const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rig-envhand-'));

t.test('write keeps only allowlisted names, mode 0600; load overrides inherited env for handoff keys only and deletes the file', () => {
  const d = mkdir();
  try {
    const n = writeEnvHandoff(d, { CLAUDE_CODE_OAUTH_TOKEN: SECRET, ANTHROPIC_API_KEY: 'k', GH_TOKEN: 'nope', PATH: '/x', HOME: '/h' });
    t.eq(n, 5); // + XDG_CONFIG_HOME="" (R4-L1)
    if (process.platform !== 'win32') t.eq(fs.statSync(path.join(d, 'env.json')).mode & 0o777, 0o600);
    const target = { HOME: '/own-home' };
    t.eq(loadEnvHandoff(d, target), 5);
    t.eq([target.CLAUDE_CODE_OAUTH_TOKEN, target.GH_TOKEN], [SECRET, undefined]);
    t.ok(!fs.existsSync(path.join(d, 'env.json')));
    t.eq(loadEnvHandoff(d, {}), 0); // second load: nothing
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

t.test('stale inherited auth token is overridden; non-auth inherited env is untouched', () => {
  const d = mkdir();
  try {
    writeEnvHandoff(d, { CLAUDE_CODE_OAUTH_TOKEN: SECRET });
    const target = { CLAUDE_CODE_OAUTH_TOKEN: 'stale-token', CUSTOM_VAR: 'keep' };
    loadEnvHandoff(d, target);
    t.eq([target.CLAUDE_CODE_OAUTH_TOKEN, target.CUSTOM_VAR], [SECRET, 'keep']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

t.test('windows launch path (injected exec): env.json written before schtasks, default headless, removed if schtasks fails', () => {
  const d = mkdir();
  const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = SECRET;
    const { launchRun } = require('../lib/detached-process-launcher.cjs');
    const calls = [];
    let sawEnvAtCreate = false;
    const exec = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'schtasks' && args[0] === '/Create') sawEnvAtCreate = fs.readFileSync(path.join(d, 'env.json'), 'utf8').includes(SECRET);
      return cmd === 'whoami' ? 'host\\user\n' : '';
    };
    const r = launchRun({ runId: 'r260101000000-abcdef', runDir: d, target: { node: 'C:\\node\\node.exe' }, platform: 'win32', exec });
    t.eq(r.method, 'schtasks-headless');
    t.ok(sawEnvAtCreate, 'env.json must exist when the task is created');
    t.ok(!JSON.stringify(calls).includes(SECRET), 'secret in schtasks argv');
    const failing = (cmd) => { if (cmd === 'schtasks') throw new Error('boom'); return 'u'; };
    let threw = false;
    try { launchRun({ runId: 'r260101000000-abcdef', runDir: d, target: { node: 'C:\\node\\node.exe' }, platform: 'win32', exec: failing }); } catch { threw = true; }
    t.ok(threw);
    t.ok(!fs.existsSync(path.join(d, 'env.json')), 'env.json discarded after failed launch');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

t.test('corrupt env.json is ignored and removed', () => {
  const d = mkdir();
  try {
    fs.writeFileSync(path.join(d, 'env.json'), '{not json');
    t.eq(loadEnvHandoff(d, {}), 0);
    t.ok(!fs.existsSync(path.join(d, 'env.json')));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

t.test('launcher (fake tmux): secret value never in argv; env.json holds it; runner load removes it', () => {
  if (process.platform === 'win32') return;
  const d = mkdir();
  const bin = path.join(d, 'bin'), runDir = path.join(d, 'run');
  fs.mkdirSync(bin); fs.mkdirSync(runDir);
  const argvLog = path.join(d, 'argv.log');
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${argvLog}'\nexit 0\n`, { mode: 0o755 });
  const saved = { PATH: process.env.PATH, tok: process.env.CLAUDE_CODE_OAUTH_TOKEN, no: process.env.RIG_REMOTE_NO_TMUX };
  try {
    process.env.PATH = `${bin}:${saved.PATH}`;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = SECRET;
    delete process.env.RIG_REMOTE_NO_TMUX;
    const { launchRun } = require('../lib/detached-process-launcher.cjs');
    t.eq(launchRun({ runId: 'r260101000000-abcdef', runDir, target: {} }).method, 'tmux');
    t.ok(!fs.readFileSync(argvLog, 'utf8').includes(SECRET), 'secret leaked into tmux argv');
    t.ok(fs.readFileSync(argvLog, 'utf8').includes('new-session'));
    t.ok(fs.readFileSync(path.join(runDir, 'env.json'), 'utf8').includes(SECRET));
    const target = {};
    loadEnvHandoff(runDir, target);
    t.eq(target.CLAUDE_CODE_OAUTH_TOKEN, SECRET);
    t.ok(!fs.existsSync(path.join(runDir, 'env.json')), 'env.json must be removed after start');
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.tok === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.tok;
    if (saved.no !== undefined) process.env.RIG_REMOTE_NO_TMUX = saved.no;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

t.done();
