'use strict';
/**
 * The terminal consent gate of rig-init and of `scripts/release-plugin.cjs --apply`: an apply step changes the user's
 * configuration (or publishes a release), so it runs only in the user's own terminal, never from inside Claude Code,
 * and only after an explicit y/N answer. Node built-ins only.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const MAX_ANCESTRY_DEPTH = 40;
const PS_QUERY_TIMEOUT_MS = 30000;
const baseName = (p) => path.basename(String(p || '').replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');

/** True when a process looks like Claude Code: the `claude` binary, or node/bun running the claude CLI package. */
function isClaudeCodeProcess({ name = '', args = [] }) {
  if (baseName(name) === 'claude' || baseName(args[0]) === 'claude') return true;
  const interpreter = ['node', 'nodejs', 'bun', 'deno'].includes(baseName(args[0])) || ['node', 'nodejs', 'bun', 'deno'].includes(baseName(name));
  const script = args.slice(1).find((a) => !a.startsWith('-')) || '';
  return interpreter && (/[/\\]claude-code[/\\]/.test(script) || baseName(script) === 'claude');
}

/**
 * The chain of ancestor processes of this one, nearest first: Linux /proc, macOS `ps`, Windows one PowerShell/CIM
 * query (30 s timeout: a cold PowerShell start plus a full CIM process listing exceeded 5 s on a CI runner). Throws when the chain cannot be read, so the caller fails closed.
 */
function readAncestry({ platform = process.platform, startPid = process.pid, run = spawnSync, readFile = fs.readFileSync } = {}) {
  const chain = [];
  if (platform === 'linux') {
    let pid = startPid;
    for (let i = 0; i < MAX_ANCESTRY_DEPTH; i++) {
      const stat = readFile(`/proc/${pid}/stat`, 'utf8');
      const m = /^\d+ \((.*)\) \S (\d+)/s.exec(stat);
      if (!m) throw new Error(`cannot parse /proc/${pid}/stat`);
      const ppid = Number(m[2]);
      if (pid !== startPid) {
        let args = [];
        try { args = readFile(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { /* exited or hidden: name alone */ }
        chain.push({ pid, name: m[1], args });
      }
      if (ppid <= 1) break;
      pid = ppid;
    }
    return chain;
  }
  if (platform === 'win32') {
    const res = run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "$ProgressPreference = 'SilentlyContinue'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { encoding: 'utf8', timeout: PS_QUERY_TIMEOUT_MS, windowsHide: true });
    if (res.error || res.status !== 0) throw new Error(`process query failed: ${res.error ? res.error.message : `exit ${res.status}`}`);
    const rows = [].concat(JSON.parse(res.stdout));
    const byPid = new Map(rows.map((r) => [r.ProcessId, r]));
    let pid = byPid.get(startPid) && byPid.get(startPid).ParentProcessId;
    for (let i = 0; i < MAX_ANCESTRY_DEPTH && byPid.has(pid); i++) {
      const row = byPid.get(pid);
      chain.push({ pid, name: row.Name, args: String(row.CommandLine || '').split(/\s+/).filter(Boolean) });
      pid = row.ParentProcessId;
    }
    return chain;
  }
  // macOS and other POSIX
  let pid = startPid;
  for (let i = 0; i < MAX_ANCESTRY_DEPTH; i++) {
    const res = run('ps', ['-o', 'ppid=,comm=,args=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
    const m = !res.error && res.status === 0 ? /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(String(res.stdout).split('\n')[0] || '') : null;
    if (!m) throw new Error(`ps could not describe pid ${pid}`);
    const ppid = Number(m[1]);
    if (pid !== startPid) chain.push({ pid, name: m[2], args: m[3].split(/\s+/).filter(Boolean) });
    if (ppid <= 1) break;
    pid = ppid;
  }
  return chain;
}

/**
 * Why an apply verb must not run here, or null. Applying changes user config, so it needs the user's own terminal:
 *  - CLAUDECODE set: refused;
 *  - no TTY: nobody can answer the prompt: refused. Checked before the ancestry, so a piped or CI run never starts the
 *    Windows PowerShell query (its cold start passed 30 s on a loaded CI runner);
 *  - ANY ancestor process is Claude Code (`env -u CLAUDECODE` cannot hide the ancestry; a pty made with `script` still
 *    has Claude Code as an ancestor): refused;
 *  - the ancestry cannot be read: refused (fail closed).
 * There is no flag that skips this. `ancestors` is a test seam: a chain, or a function returning one (the real chain is read when it is not given); consent against
 * a determined agent is defense in depth, not a guarantee.
 */
function applyRefusal({ env = process.env, stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY), command, ancestors }) {
  const outside = `Run this yourself in a terminal:\n\n  ${command}\n`;
  if (env.CLAUDECODE) {
    return `rig-init changes your Claude Code configuration, so it only runs in a terminal outside Claude Code (CLAUDECODE is set here).\n${outside}`;
  }
  if (!stdinIsTTY || !stdoutIsTTY) {
    return `rig-init needs an interactive terminal to ask for your confirmation (stdin/stdout is not a TTY), and has no option to skip it.\n${outside}`;
  }
  let chain;
  {
    try {
      chain = typeof ancestors === 'function' ? ancestors() : ancestors || readAncestry();
    } catch (err) {
      return `rig-init could not check whether it was started from inside Claude Code (${err.message}), so it refuses.\n${outside}`;
    }
  }
  const claude = chain.find(isClaudeCodeProcess);
  if (claude) return `rig-init changes your Claude Code configuration, so it only runs in a terminal outside Claude Code (a parent process, pid ${claude.pid}, is Claude Code).\n${outside}`;
  return null;
}

/** y/N prompt on the terminal; only an explicit y/yes accepts. */
function askYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    // Resolve BEFORE closing: rl.close() emits 'close' synchronously, and the close handler (EOF = no) must not win
    rl.question(`${question} [y/N] `, (answer) => { resolve(/^y(es)?$/i.test(answer.trim())); rl.close(); });
    rl.on('close', () => resolve(false)); // EOF without an answer; a no-op when the answer already resolved
  });
}

module.exports = { applyRefusal, readAncestry, isClaudeCodeProcess, askYesNo };
