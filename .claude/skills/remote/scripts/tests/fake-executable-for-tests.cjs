'use strict';
/**
 * Spawnable fake executables for tests (ssh, git, claude, ...).
 *   const p = makeFakeExecutable(dir, 'ssh', 'process.exit(255);');   // spawn(p) / put dir first on PATH
 *   t.ok(fakeRanCount(dir, 'ssh') > 0, 'fake ssh must actually have run');
 *
 * POSIX: `<dir>/<name>` = `#!<node>` script (mode 0755).
 * win32: libuv only spawns real .exe files, so `<dir>/<name>.js` holds the body and `<dir>/<name>.exe` is a tiny
 * C# launcher (compiled once per process with the .NET Framework csc.exe into a private temp dir removed at exit) that runs
 * `node <name>.js <args>` inside a Job Object with KILL_ON_JOB_CLOSE: killing the launcher kills node too, the
 * same single-process semantics as a hung git.exe. Node's path is stored in `<name>.exe.node` because
 * allowlisted child envs (RIG_TEST_NODE) do not survive into the fake.
 * Every fake appends one line to `<dir>/<name>.ran` before running its body (kills vacuous passes).
 */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WIN = process.platform === 'win32';

// Constant source only (never test input).
const LAUNCHER_CS = `
using System; using System.Diagnostics; using System.IO; using System.Runtime.InteropServices; using System.Text;
static class L {
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long A; public long B; public uint Flags; public UIntPtr Min; public UIntPtr Max; public uint Active; public UIntPtr Aff; public uint Prio; public uint Sched; }
  [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IOC Io; public UIntPtr PML; public UIntPtr JML; public UIntPtr PPM; public UIntPtr PJM; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXT i, int l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  static string Q(string a) {
    if (a.Length > 0 && a.IndexOfAny(new char[] { ' ', '\\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\\""); int bs = 0;
    foreach (char c in a) {
      if (c == '\\\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\\\', bs * 2 + 1).Append('"'); bs = 0; continue; }
      sb.Append('\\\\', bs).Append(c); bs = 0;
    }
    return sb.Append('\\\\', bs * 2).Append('"').ToString();
  }
  static int Main(string[] args) {
    string exe = Process.GetCurrentProcess().MainModule.FileName;
    string js = Path.ChangeExtension(exe, ".js");
    string node = Environment.GetEnvironmentVariable("RIG_TEST_NODE");
    if (File.Exists(exe + ".node")) node = File.ReadAllText(exe + ".node").Trim();
    if (string.IsNullOrEmpty(node)) node = "node";
    var line = new StringBuilder(Q(js)); foreach (string a in args) line.Append(' ').Append(Q(a));
    var psi = new ProcessStartInfo(node, line.ToString()); psi.UseShellExecute = false;
    if (File.Exists(exe + ".nojob")) { // fake scheduler: what it starts must outlive this launcher
      using (var q = Process.Start(psi)) { q.WaitForExit(); return q.ExitCode; }
    }
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var info = new EXT(); info.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(EXT)))) { Console.Error.WriteLine("job object error " + Marshal.GetLastWin32Error()); return 70; }
    using (var p = Process.Start(psi)) {
      if (!AssignProcessToJobObject(job, p.Handle)) { Console.Error.WriteLine("assign job error " + Marshal.GetLastWin32Error()); try { p.Kill(); } catch { } return 70; }
      p.WaitForExit(); return p.ExitCode;
    }
  }
}
`;

let builtLauncher = null;
/**
 * Compiles the launcher once per process into a private mkdtemp dir (mode 0700-equivalent, removed at exit) and
 * returns that exe. Nothing is read back from a shared, predictable path, so a planted file cannot be run.
 * Throws (never skips) if csc.exe is missing.
 */
function launcherExe() {
  if (builtLauncher && fs.existsSync(builtLauncher)) return builtLauncher;
  const win = process.env.windir || process.env.SystemRoot || 'C:\\Windows';
  const csc = ['Framework64', 'Framework'].map((d) => path.join(win, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
  if (!csc) throw new Error('csc.exe (.NET Framework 4) not found under %windir%\\Microsoft.NET: cannot build the Windows test shim');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-test-shim-'));
  process.on('exit', () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } });
  const src = path.join(work, 'launcher.cs');
  const out = path.join(work, 'launcher.exe');
  fs.writeFileSync(src, LAUNCHER_CS);
  const r = cp.spawnSync(csc, ['/nologo', '/target:exe', `/out:${out}`, src], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`csc.exe failed (${r.status}): ${r.stdout}${r.stderr}`);
  builtLauncher = out;
  return out;
}

/**
 * @param {string} dir existing directory
 * @param {string} name executable base name (ssh, git, claude)
 * @param {string} jsBody CommonJS body; a leading shebang line is dropped
 * @param {{killTree?: boolean}} [opts] killTree=false (win32): no Job Object, so processes the fake starts outlive it
 * @returns {string} absolute path that child_process can spawn on this platform
 */
function makeFakeExecutable(dir, name, jsBody, { killTree = true } = {}) {
  const body = String(jsBody).replace(/^#![^\n]*\n/, '');
  const ran = path.join(dir, `${name}.ran`);
  const prelude = `require('fs').appendFileSync(${JSON.stringify(ran)}, process.argv.slice(2).join(' ') + '\\n');\n`;
  if (!WIN) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!${process.execPath}\n${prelude}${body}\n`, { mode: 0o755 });
    return p;
  }
  fs.writeFileSync(path.join(dir, `${name}.js`), `${prelude}${body}\n`);
  const exe = path.join(dir, `${name}.exe`);
  fs.copyFileSync(launcherExe(), exe);
  fs.writeFileSync(`${exe}.node`, process.execPath);
  if (!killTree) fs.writeFileSync(`${exe}.nojob`, '');
  return exe;
}

/** Number of times the fake `name` in `dir` was started (0 if never). */
function fakeRanCount(dir, name) {
  try { return fs.readFileSync(path.join(dir, `${name}.ran`), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}

module.exports = { makeFakeExecutable, fakeRanCount };
