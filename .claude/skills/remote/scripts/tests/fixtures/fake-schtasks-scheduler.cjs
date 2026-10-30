'use strict';
/**
 * Body of the fake `schtasks.exe` used by Windows test runs (the real S4U Task Scheduler needs rights a CI
 * or dev host may not grant: `schtasks /Create` -> "Access is denied"). Emulates only what the product calls:
 *   /Create /XML <file> /TN <name> /F   stores the (real, product-built) task XML
 *   /Run /TN <name>                     starts the task's <Command> <Arguments> detached in <WorkingDirectory>
 *   /Delete /TN <name> /F               forgets the task
 * Everything else (XML, argv, whoami, runner, env.json handoff) is the real product code path.
 * Like tmux, it hands the caller's env to the runner (a real task would not; env.json carries auth only).
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const args = process.argv.slice(2);
const op = args[0];
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const name = arg('/TN');
const store = path.join(path.dirname(fs.realpathSync(process.argv[1])), 'tasks');
fs.mkdirSync(store, { recursive: true });
const stored = name && path.join(store, `${name}.xml`);
const fail = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };

const unescapeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

if (op === '/Create') {
  const xml = arg('/XML');
  if (!xml || !name) fail('invalid syntax');
  const buf = fs.readFileSync(xml);
  if (buf[0] !== 0xff || buf[1] !== 0xfe) fail('task XML must be UTF-16LE with BOM');
  fs.writeFileSync(stored, buf.subarray(2).toString('utf16le'));
  console.log(`SUCCESS: The scheduled task "${name}" has successfully been created.`);
} else if (op === '/Delete') {
  fs.rmSync(stored, { force: true });
  console.log(`SUCCESS: The scheduled task "${name}" was successfully deleted.`);
} else if (op === '/Run') {
  if (!fs.existsSync(stored)) fail('The system cannot find the file specified.');
  const xml = fs.readFileSync(stored, 'utf8');
  const tag = (t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? unescapeXml(m[1]) : fail(`missing <${t}>`); };
  const cmd = tag('Command');
  const cwd = tag('WorkingDirectory');
  const argv = [...tag('Arguments').matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  // The task must NOT inherit our stdio pipes (the caller waits for them to close, i.e. for the whole run): the
  // real Task Scheduler service starts tasks without our handles, WMI Win32_Process.Create does the same.
  const envFile = path.join(store, `${name}.env.json`);
  fs.writeFileSync(envFile, JSON.stringify(process.env));
  const quote = (s) => `"${s}"`;
  const bootstrap = path.join(__dirname, 'fake-schtasks-runner-bootstrap.cjs');
  const commandLine = [process.execPath, bootstrap, envFile, cwd, cmd, ...argv].map(quote).join(' ');
  const script = '$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:RIG_FAKE_CMDLINE; CurrentDirectory = $env:RIG_FAKE_CWD }; if ($r.ReturnValue -ne 0) { exit 1 }';
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, RIG_FAKE_CMDLINE: commandLine, RIG_FAKE_CWD: cwd }, windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) fail(`cannot start task via WMI: ${r.stderr || r.error}`);
  console.log(`SUCCESS: Attempted to run the scheduled task "${name}".`);
} else {
  fail(`unsupported fake schtasks operation ${op}`);
}
