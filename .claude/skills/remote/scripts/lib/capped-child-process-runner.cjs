'use strict';
/**
 * Spawn a child, feed stdin, collect capped stdout/stderr, enforce a hard timeout.
 * Shared by the worker transport and doctor's bootstrap probe.
 *
 * Windows quirk (verified with OpenSSH_for_Windows 9.5p2): with node pipes as
 * stdio, ssh.exe never exits once it has written output (even after the remote
 * command finished) and never forwards EOF of a closed stdin pipe. With plain
 * files it behaves. So on win32 `ssh` reads stdin from a temp file and writes
 * stdout/stderr to temp files that are read after the child closes.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RemoteError, EXIT } = require('./remote-errors.cjs');

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const needsFileCapture = (cmd, platform = process.platform) => platform === 'win32' && cmd === 'ssh';

/** Temp files for stdin/stdout/stderr; size() is the bytes written so far, read() the output texts (null if oversize), cleanup() is best-effort. */
function openCaptureFiles(stdin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-ssh-out-')); // 0700; deleted (not wiped) after the run
  const fds = [];
  let open = true; // close once: a second closeSync could hit an fd number already reused elsewhere
  const closeAll = () => { if (open) { open = false; fds.forEach((fd) => { try { fs.closeSync(fd); } catch { /* ignore */ } }); } };
  const cleanup = () => {
    closeAll();
    // win32: a just-killed ssh.exe or a scanner may still hold a handle (EBUSY/EPERM); a leftover temp dir must not block settling
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* ignore */ }
  };
  try {
    const inFile = path.join(dir, 'in');
    fs.writeFileSync(inFile, stdin, { mode: 0o600 });
    fds.push(fs.openSync(inFile, 'r'));
    for (const f of ['out', 'err']) fds.push(fs.openSync(path.join(dir, f), 'w', 0o600));
  } catch (e) { cleanup(); throw e; }
  const size = () => fds.slice(1).reduce((n, fd) => n + fs.fstatSync(fd).size, 0);
  return {
    fds,
    size,
    read() {
      const tooBig = size() > MAX_OUTPUT_BYTES;
      closeAll();
      return tooBig ? null : ['out', 'err'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    },
    cleanup,
  };
}

/**
 * @param {string} cmd
 * @param {string[]} argv
 * @param {{cwd?:string, stdin?:string, timeoutMs:number, env?:object, captureToFiles?:boolean}} o
 * @returns {Promise<{code:number|null, stdout:string, stderr:string}>} rejects with RemoteError on spawn failure, timeout or oversize output
 */
function runChild(cmd, argv, { cwd, stdin = '', timeoutMs, env, captureToFiles = needsFileCapture(cmd) }) {
  return new Promise((resolve, reject) => {
    const cap = captureToFiles ? openCaptureFiles(stdin) : null; // a throw here rejects via the executor; nothing left behind
    const tooBig = () => new RemoteError('worker output exceeded 10 MB', EXIT.TRANSPORT, { class: 'bad-output' });
    let child;
    try {
      child = spawn(cmd, argv, { cwd, env, stdio: cap ? cap.fds : ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { if (cap) cap.cleanup(); throw e; }
    let stdout = '', stderr = '', size = 0, settled = false, abort = null, timer = null, poll = null;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearInterval(poll);
      fn(v);
      if (cap) cap.cleanup();
    };
    const kill = (err) => { abort = abort || err; try { child.kill('SIGKILL'); } catch { /* close/error still follow */ } };
    timer = setTimeout(() => kill(new RemoteError(`worker timed out after ${timeoutMs}ms`, EXIT.TRANSPORT, { class: 'timeout' })), timeoutMs);
    const collect = (isErr) => (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) return kill(tooBig());
      if (isErr) stderr += chunk; else stdout += chunk;
    };
    if (cap) {
      // file mode has no data events: poll sizes so a chatty remote cannot fill the disk until the timeout
      poll = setInterval(() => { try { if (cap.size() > MAX_OUTPUT_BYTES) kill(tooBig()); } catch (e) { if (e.code !== 'EBADF') kill(new RemoteError(`cannot size ${cmd} output: ${e.code || e.message}`, EXIT.TRANSPORT, { class: 'bad-output' })); } }, 250);
    } else {
      child.stdout.on('data', collect(false));
      child.stderr.on('data', collect(true));
      child.stdin.on('error', () => {}); // EPIPE when the child dies early; exit code tells the story
    }
    child.on('error', (e) => finish(reject, abort || new RemoteError(`cannot start ${cmd}: ${e.code || e.message}`, EXIT.TRANSPORT, { class: 'unreachable', hint: e.message })));
    child.on('close', (code) => {
      if (settled) return; // spawn error already rejected (node emits 'error' then 'close')
      if (abort) return finish(reject, abort);
      if (cap) {
        let texts;
        try { texts = cap.read(); } catch (e) { return finish(reject, new RemoteError(`cannot read ${cmd} output: ${e.code || e.message}`, EXIT.TRANSPORT, { class: 'bad-output' })); }
        if (!texts) return finish(reject, tooBig());
        [stdout, stderr] = texts;
      }
      return finish(resolve, { code, stdout, stderr });
    });
    if (!cap) child.stdin.end(stdin);
  });
}

module.exports = { runChild, needsFileCapture, MAX_OUTPUT_BYTES };
