'use strict';
/**
 * Windows launcher pieces (spike-verified recipe): a scheduled task created
 * from UTF-16LE XML via `schtasks /Create /XML`. Pure builders are unit-tested
 * on any OS; `launchWindowsTask` is the only function that touches schtasks.
 *  - interactive: LogonType InteractiveToken (needs a logged-on user), then `/Run`
 *  - headless:    LogonType S4U (works logged off), best-effort `/Run` (starts in
 *                 seconds, verified on Win11); the TimeTrigger is the fallback and
 *                 its later fire is a no-op (runner.lock / exit file)
 * Self-delete from inside the task fails (Access denied), so the XML carries
 * EndBoundary + DeleteExpiredTaskAfter PT0S; worker status/list/cancel delete
 * finished tasks as a backstop.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Trigger window: starts START_DELAY_MS after launch, expires WINDOW_MS later. run-directory's
// STARTING_GRACE_MS must stay above START_DELAY_MS + WINDOW_MS so `not-started` is only declared
// after the task can no longer fire (asserted in tests).
const START_DELAY_MS = 60_000;
const WINDOW_MS = 60_000;

const taskNameFor = (runId) => `rig-${runId}`;

/** Local-time ISO without zone, as schtasks expects (yyyy-MM-ddTHH:mm:ss). */
function formatLocalIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * @param {{user:string, mode:'interactive'|'headless', node:string, entry:string, runDir:string, start:Date}} o
 * @returns {string} task XML (JS string; write with writeTaskXmlFile)
 */
function buildTaskXml({ user, mode, node, entry, runDir, start }) {
  const logon = mode === 'headless' ? 'S4U' : 'InteractiveToken';
  const startIso = formatLocalIso(start);
  const endIso = formatLocalIso(new Date(start.getTime() + WINDOW_MS)); // expiry -> DeleteExpiredTaskAfter removes the task
  const args = xmlEscape(`"${entry}" "${runDir}"`);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><TimeTrigger><StartBoundary>${startIso}</StartBoundary><EndBoundary>${endIso}</EndBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEscape(user)}</UserId><LogonType>${logon}</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <DeleteExpiredTaskAfter>PT0S</DeleteExpiredTaskAfter>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(node)}</Command><Arguments>${args}</Arguments><WorkingDirectory>${xmlEscape(runDir)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

/** schtasks argv lists. */
function buildSchtasksArgv({ runId, xmlPath }) {
  const name = taskNameFor(runId);
  return {
    create: ['/Create', '/XML', xmlPath, '/TN', name, '/F'],
    run: ['/Run', '/TN', name],
    del: ['/Delete', '/TN', name, '/F'],
  };
}

/** UTF-16LE with BOM, like [IO.File]::WriteAllText(path, xml, Encoding.Unicode). */
function writeTaskXmlFile(file, xml) {
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
}

/**
 * Create (+ run) the task. Throws on schtasks failure.
 * @param {{runId:string, runDir:string, entry:string, target:{node:string, taskMode?:string}, exec?:Function, now?:Date}} o
 */
function launchWindowsTask({ runId, runDir, entry, target, exec = execFileSync, now = new Date() }) {
  if (!target.node) throw new Error('registry "node" (absolute node.exe) is required on windows');
  const mode = target.taskMode === 'interactive' ? 'interactive' : 'headless'; // default headless (S4U): runs logged on or off
  const user = String(exec('whoami', [], { encoding: 'utf8', windowsHide: true })).trim(); // %USERDOMAIN% is wrong over ssh
  const xmlPath = path.join(runDir, 'task.xml');
  writeTaskXmlFile(xmlPath, buildTaskXml({ user, mode, node: target.node, entry, runDir, start: new Date(now.getTime() + START_DELAY_MS) }));
  const argv = buildSchtasksArgv({ runId, xmlPath });
  exec('schtasks', argv.create, { windowsHide: true, stdio: 'pipe' });
  try { exec('schtasks', argv.run, { windowsHide: true, stdio: 'pipe' }); } catch (e) {
    // headless: TimeTrigger still fires (~60 s later). interactive: drop the task so its trigger cannot start an orphan runner.
    if (mode === 'interactive') { deleteWindowsTask(runId, exec); throw e; }
  }
  return { method: `schtasks-${mode}` };
}

/** Best-effort task removal (backstop for finished/cancelled runs). */
function deleteWindowsTask(runId, exec = execFileSync) {
  try { exec('schtasks', buildSchtasksArgv({ runId, xmlPath: '' }).del, { windowsHide: true, stdio: 'pipe' }); return true; } catch { return false; }
}

module.exports = { START_DELAY_MS, WINDOW_MS, taskNameFor, formatLocalIso, xmlEscape, buildTaskXml, buildSchtasksArgv, writeTaskXmlFile, launchWindowsTask, deleteWindowsTask };
