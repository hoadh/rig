'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const W = require('../lib/windows-scheduled-task-xml.cjs');

const base = {
  user: 'waso\\dev', node: 'C:\\Program Files\\nodejs\\node.exe', entry: 'C:\\Users\\dev\\.claude\\skills\\remote\\scripts\\worker-run-entry.cjs',
  runDir: 'C:\\Users\\dev\\.rig\\runs\\r260101010101-abc123', start: new Date(2026, 9, 15, 10, 30, 5),
};

t.test('local ISO time format and xml escaping', () => {
  t.eq(W.formatLocalIso(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02T03:04:05');
  t.eq(W.xmlEscape(`a&b<c>"d'`), 'a&amp;b&lt;c&gt;&quot;d&apos;');
});

t.test('interactive XML: InteractiveToken, trigger now+1m window, IgnoreNew, no time limit, auto-delete', () => {
  const x = W.buildTaskXml({ ...base, mode: 'interactive' });
  t.ok(x.includes('<LogonType>InteractiveToken</LogonType>'));
  t.ok(x.includes('<StartBoundary>2026-10-15T10:30:05</StartBoundary>'));
  t.ok(x.includes('<EndBoundary>2026-10-15T10:31:05</EndBoundary>'));
  t.ok(x.includes('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'));
  t.ok(x.includes('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'));
  t.ok(x.includes('<DeleteExpiredTaskAfter>PT0S</DeleteExpiredTaskAfter>'));
  t.ok(x.includes('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'));
  t.ok(x.includes('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'));
  t.ok(x.includes('<RunLevel>LeastPrivilege</RunLevel>'));
  t.ok(x.includes('<UserId>waso\\dev</UserId>'));
});

t.test('headless XML uses S4U', () => {
  const x = W.buildTaskXml({ ...base, mode: 'headless' });
  t.ok(x.includes('<LogonType>S4U</LogonType>'));
  t.ok(!x.includes('InteractiveToken'));
});

t.test('Exec: abs node.exe, quoted entry + runDir (escaped), WorkingDirectory; no run.cmd', () => {
  const x = W.buildTaskXml({ ...base, mode: 'interactive' });
  t.ok(x.includes('<Command>C:\\Program Files\\nodejs\\node.exe</Command>'));
  t.ok(x.includes(`<Arguments>&quot;${base.entry}&quot; &quot;${base.runDir}&quot;</Arguments>`));
  t.ok(x.includes(`<WorkingDirectory>${base.runDir}</WorkingDirectory>`));
  t.ok(!/run\.cmd/.test(x));
});

t.test('schtasks argv: /XML create, /Run, delete', () => {
  const i = W.buildSchtasksArgv({ runId: 'r1-abcdefgh', xmlPath: 'C:\\x\\task.xml' });
  t.eq(i.create, ['/Create', '/XML', 'C:\\x\\task.xml', '/TN', 'rig-r1-abcdefgh', '/F']);
  t.eq(i.run, ['/Run', '/TN', 'rig-r1-abcdefgh']);
  t.eq(i.del, ['/Delete', '/TN', 'rig-r1-abcdefgh', '/F']);
});

t.test('XML file is UTF-16LE with BOM and round-trips', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rig-xml-')), 't.xml');
  try {
    const x = W.buildTaskXml({ ...base, mode: 'headless' });
    W.writeTaskXmlFile(f, x);
    const buf = fs.readFileSync(f);
    t.eq([buf[0], buf[1]], [0xff, 0xfe]);
    t.eq(buf.subarray(2).toString('utf16le'), x);
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
});

t.test('launchWindowsTask with injected exec: whoami, create + run (headless /Run failure tolerated); never real schtasks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-xml-'));
  try {
    for (const taskMode of ['interactive', 'headless']) {
      const calls = [];
      const exec = (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'whoami' ? 'waso\\dev\r\n' : ''; };
      const r = W.launchWindowsTask({ runId: 'r1-abcdefgh', runDir: dir, entry: 'E', target: { node: 'N', taskMode }, exec, now: new Date(2026, 0, 1) });
      t.eq(r.method, `schtasks-${taskMode}`);
      const verbs = calls.map((c) => (c[0] === 'whoami' ? 'whoami' : c[1]));
      t.eq(verbs, ['whoami', '/Create', '/Run']);
      t.ok(fs.readFileSync(path.join(dir, 'task.xml')).length > 100);
    }
    let threw = false;
    try { W.launchWindowsTask({ runId: 'r1-abcdefgh', runDir: dir, entry: 'E', target: {}, exec: () => '' }); } catch { threw = true; }
    t.ok(threw); // node required
    const dflt = [];
    const execD = (cmd, args) => { dflt.push(cmd === 'whoami' ? 'whoami' : args[0]); return cmd === 'whoami' ? 'waso\\dev' : ''; };
    const rd = W.launchWindowsTask({ runId: 'r1-abcdefgh', runDir: dir, entry: 'E', target: { node: 'N' }, exec: execD, now: new Date(2026, 0, 1) });
    t.eq(rd.method, 'schtasks-headless'); // no taskMode -> headless default
    t.eq(dflt, ['whoami', '/Create', '/Run']);
    const failRun = (cmd, args) => { if (args[0] === '/Run') throw new Error('run failed'); return cmd === 'whoami' ? 'waso\\dev' : ''; };
    t.eq(W.launchWindowsTask({ runId: 'r1-abcdefgh', runDir: dir, entry: 'E', target: { node: 'N' }, exec: failRun }).method, 'schtasks-headless'); // trigger fallback
    let interactiveThrew = false;
    const seen = [];
    const failRunLog = (cmd, args) => { seen.push(args[0]); return failRun(cmd, args); };
    try { W.launchWindowsTask({ runId: 'r1-abcdefgh', runDir: dir, entry: 'E', target: { node: 'N', taskMode: 'interactive' }, exec: failRunLog }); } catch { interactiveThrew = true; }
    t.ok(interactiveThrew);
    t.eq(seen.slice(-2), ['/Run', '/Delete']); // interactive /Run failure leaves no task behind
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t.done();
