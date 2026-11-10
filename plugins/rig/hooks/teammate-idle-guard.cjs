#!/usr/bin/env node
/**
 * Teammate Idle Guard - TeammateIdle hook (Agent Teams)
 *
 * The agent teams docs list "task status can lag": a teammate finishes but leaves its task `in_progress`, which blocks
 * dependent tasks. When a teammate is about to go idle while it owns an `in_progress` task, this hook sends it back once
 * per task (exit 2, stderr is the feedback) to mark the task completed or say why it is not done. A second idle on the
 * same task passes, so a teammate can never loop here.
 *
 * Input (hooks reference, TeammateIdle): `teammate_name`, `session_id`, deprecated `team_name`.
 * Tasks: `~/.claude/tasks/<list>/<id>.json` ({ id, subject, status, owner, ... }); the list is the session's team name
 * (`session-<8>`) or CLAUDE_CODE_TASK_LIST_ID when set. After `/resume` the list keeps the original session id (seen
 * live, 2.1.322) although the team gets a new name, so `session_id` still names it.
 * Off: `.rig.json` `hooks: { "teammate-idle-guard": false }`. Fails open: any error or unexpected input exits 0.
 */
try {
  const fs = require('fs');
  const crypto = require('crypto');
  const os = require('os');
  const path = require('path');
  const { isHookEnabled } = require('./lib/rig-config-utils.cjs');
  const { yieldsToProjectCopy } = require('./lib/global-hook-yields-to-project-copy.cjs');
  const { sessionTeamName } = require('./lib/team-member-resolver.cjs');
  const { stateDir } = require('./lib/plugin-data-dir.cjs');
  const { logHook } = require('./lib/hook-logger.cjs');

  const HOOK = 'teammate-idle-guard';
  const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}$/;

  if (!isHookEnabled(HOOK)) process.exit(0);
  const stdin = fs.readFileSync(0, 'utf-8').trim();
  if (!stdin) process.exit(0);
  let payload;
  try { payload = JSON.parse(stdin); } catch { process.exit(0); }
  if (!payload || typeof payload !== 'object') process.exit(0);
  if (yieldsToProjectCopy(__filename, payload)) process.exit(0);

  const teammate = typeof payload.teammate_name === 'string' ? payload.teammate_name : '';
  if (!teammate) process.exit(0);

  const lists = [process.env.CLAUDE_CODE_TASK_LIST_ID, sessionTeamName(payload.session_id), payload.team_name]
    .filter((n, i, all) => typeof n === 'string' && SAFE_NAME.test(n) && !n.includes('..') && all.indexOf(n) === i);
  const tasksRoot = path.join(os.homedir(), '.claude', 'tasks');

  const open = [];
  for (const list of lists) {
    let files;
    try { files = fs.readdirSync(path.join(tasksRoot, list)).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      let task;
      try { task = JSON.parse(fs.readFileSync(path.join(tasksRoot, list, f), 'utf8')); } catch { continue; }
      // owner: the bare teammate name; `<name>@<team>` accepted in case a build stores the agent id
      if (task && (task.owner === teammate || task.owner === `${teammate}@${list}`) && task.status === 'in_progress') open.push({ list, id: String(task.id ?? f.slice(0, -5)), subject: String(task.subject || '') });
    }
  }
  if (!open.length) process.exit(0);

  // Once per task instance: (list, teammate, id, subject) hashed, so a reused id with a new subject is a new task.
  // `rig-` prefix: pruneStaleState removes markers after 7 days. `wx`: never follow or reuse an existing file.
  const markerOf = (t) => path.join(stateDir(), `rig-teammate-idle-${crypto.createHash('sha256').update(JSON.stringify([t.list, teammate, t.id, t.subject])).digest('hex').slice(0, 24)}`);
  const fresh = open.filter((t) => !fs.existsSync(markerOf(t)));
  if (!fresh.length) process.exit(0);
  for (const t of fresh) fs.writeFileSync(markerOf(t), new Date().toISOString(), { flag: 'wx' });

  const list = fresh.map((t) => `#${t.id}${t.subject ? ` "${t.subject.slice(0, 80)}"` : ''}`).join(', ');
  logHook(HOOK, { event: 'TeammateIdle', target: teammate, note: `nudge ${fresh.map((t) => t.id).join(',')}` });
  process.stderr.write(`Task ${list} is still in_progress and owned by you. If it is done, mark it completed with TaskUpdate; if not (or TaskUpdate is unavailable), tell the lead, then stop.\n`);
  process.exit(2);
} catch (e) {
  try { require('./lib/hook-logger.cjs').logHookCrash('teammate-idle-guard', e, { event: 'TeammateIdle' }); } catch (_) { /* ignore */ }
  process.exit(0);
}
