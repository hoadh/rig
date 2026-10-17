'use strict';
/**
 * Raw probes BEFORE any worker call: can ssh reach the host, and do `node` and
 * `claude` resolve in a non-interactive ssh shell (PATH there is minimal; on
 * Windows an absolute path in the registry is usually required).
 * Local transport (self machine or RIG_REMOTE_TRANSPORT=local) runs directly.
 */
const { execFile } = require('child_process');
const os = require('os');
const V = require('./identifier-validators.cjs');
const { quoteExecutable } = require('./remote-command-builder.cjs');
const { buildSshArgv } = require('./ssh-transport.cjs');
const { selfMachineId } = require('./machine-registry.cjs');
const { runChild } = require('./capped-child-process-runner.cjs');

const BARE = /^[A-Za-z0-9_.-]+$/;

/** Validate then quote via the builder (single quoting implementation). */
function quoteExe(exe, shell, os) {
  if (!BARE.test(exe)) V.assertAbsPath(exe, os, 'executable', { allowSpaces: true });
  return quoteExecutable(exe, shell);
}

const run = (cmd, argv, timeout = 20000) => new Promise((resolve) => {
  execFile(cmd, argv, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ err, out: String(stdout || '').trim(), errText: String(stderr || '').trim() }));
});

/** ssh via the shared runner (handles the win32 ssh.exe pipe hang); same {err, out, errText} shape as run(). */
async function runSsh(argv, timeoutMs = 20000) {
  try {
    const r = await runChild('ssh', argv, { cwd: os.homedir(), timeoutMs });
    return { err: r.code === 0 ? null : new Error(`exit ${r.code}`), out: r.stdout.trim(), errText: r.stderr.trim() };
  } catch (e) { return { err: e, out: '', errText: e.message }; }
}

const isLocal = (name) => process.env.RIG_REMOTE_TRANSPORT === 'local' || name === selfMachineId();

async function probeExe(name, cfg, exe, flag, label) {
  let r;
  try {
    if (isLocal(name)) r = await run(exe, [flag]);
    else r = await runSsh(buildSshArgv(cfg.ssh, `${quoteExe(exe, cfg.shell, cfg.os)} ${flag}`));
  } catch (e) { return { ok: false, detail: e.message }; }
  if (r.err) {
    const hint = `${label} not runnable over non-interactive ssh${r.errText ? `: ${r.errText.slice(-120)}` : ''}; set an absolute path for "${label === 'node' ? 'node' : 'claude'}" in the registry`;
    return { ok: false, detail: hint };
  }
  return { ok: true, detail: r.out.split('\n')[0].slice(0, 80) };
}

/** @returns {Promise<{ssh, node, claude}>} each {ok, detail}; node/claude skipped when ssh fails */
async function bootstrapProbe(name, cfg) {
  const node = await probeExe(name, cfg, cfg.node || 'node', '-v', 'node');
  const looksUnreachable = !node.ok && /ssh:|Permission denied|Connection|timed out|Could not resolve/i.test(node.detail);
  if (looksUnreachable) return { ssh: { ok: false, detail: node.detail }, node: { ok: false, detail: 'skipped' }, claude: { ok: false, detail: 'skipped' } };
  const claude = await probeExe(name, cfg, cfg.claude || 'claude', '--version', 'claude');
  return { ssh: { ok: true, detail: '' }, node, claude };
}

module.exports = { bootstrapProbe, quoteExe };
