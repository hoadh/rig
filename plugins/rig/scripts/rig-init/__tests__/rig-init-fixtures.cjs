'use strict';
/** Fixture builders for the rig-init tests: a throwaway HOME with a 1.x global and/or project install. Never touches the real ~/.claude. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OWNED_FILES } = require('../rig-1x-owned-paths.cjs');

const HOOK_FILES = ['hooks/session-init.cjs', 'hooks/subagent-init.cjs', 'hooks/team-context-inject.cjs', 'hooks/dev-rules-reminder.cjs', 'hooks/bash-safety-guard.cjs', 'hooks/verify-completion-guard.cjs'];
const USER_HOOK_COMMAND = 'node /opt/my-tools/own-hook.js';

function tmpDir(prefix = 'rig-init-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** 1.x settings.json for a target; `cmd(rel)` renders the kit command in the form of that install mode. */
function settingsFor(cmd) {
  return {
    theme: 'dark',
    model: 'sonnet',
    statusLine: { type: 'command', command: cmd('statusline.cjs'), padding: 0 },
    hooks: {
      SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: cmd('hooks/session-init.cjs') }, { type: 'command', command: USER_HOOK_COMMAND }] }],
      SubagentStart: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('hooks/subagent-init.cjs') }, { type: 'command', command: cmd('hooks/team-context-inject.cjs') }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd('hooks/dev-rules-reminder.cjs') }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd('hooks/bash-safety-guard.cjs'), timeout: 5 }] }],
      Stop: [{ hooks: [{ type: 'command', command: cmd('hooks/verify-completion-guard.cjs'), timeout: 10 }] }],
    },
    permissions: { ask: ['Read(**/.env)'], allow: ['Bash(ls)'] },
  };
}

/**
 * Writes a 1.x install into `claudeDir`: every owned file (or, with `limit`, the hook files plus that many more), a
 * user hook, a user skill, a generated venv and node_modules, plus settings.json.
 * @returns {{rels: string[]}} owned rels written
 */
function install1x({ claudeDir, cmd, limit = Infinity, extraSettings = {}, marker = true }) {
  const hooks = new Set([...HOOK_FILES, 'statusline.cjs', 'skills/plan/SKILL.md', 'skills/rig-plan/SKILL.md', 'metadata.json', 'hooks/lib/rig-config-utils.cjs']);
  const owned = [...OWNED_FILES].sort();
  const markerRels = new Set(['metadata.json', 'hooks/lib/rig-config-utils.cjs']);
  const all = limit === Infinity ? owned : [...new Set([...hooks].filter((r) => OWNED_FILES.has(r)).concat(owned.filter((r) => !hooks.has(r)).slice(0, limit)))];
  const rels = marker ? all : all.filter((r) => !markerRels.has(r));
  for (const rel of rels) write(path.join(claudeDir, ...rel.split('/')), `// 1.x ${rel}\n`);
  // The Rig 1.x identity markers (metadata.json named rig, hooks/lib/rig-config-utils.cjs) unless a test builds a foreign install
  if (marker) {
    write(path.join(claudeDir, 'metadata.json'), '{"name":"rig","version":"1.1.0"}\n');
    write(path.join(claudeDir, 'hooks', 'lib', 'rig-config-utils.cjs'), '// 1.x rig-config-utils\n');
  }
  write(path.join(claudeDir, 'hooks', 'my-own-hook.sh'), '#!/bin/sh\necho mine\n');
  write(path.join(claudeDir, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\n');
  write(path.join(claudeDir, 'skills', '.venv', 'pyvenv.cfg'), 'home = /usr/bin\n');
  write(path.join(claudeDir, 'skills', 'browser', 'scripts', 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  write(path.join(claudeDir, 'skills', 'browser', 'scripts', 'package-lock.json'), '{}\n');
  write(path.join(claudeDir, '.rig.json'), '{"plan":{}}\n');
  write(path.join(claudeDir, 'skills', '.env'), 'KEY=secret\n');
  write(path.join(claudeDir, 'settings.json'), `${JSON.stringify({ ...settingsFor(cmd), ...extraSettings }, null, 2)}\n`);
  return { rels };
}

const globalCmd = (rel) => `node "$HOME/.claude/${rel}"`;
const projectCmd = (rel) => `node "$CLAUDE_PROJECT_DIR"/.claude/${rel}`;

/** A fixture HOME (global 1.x install) and a project dir (project 1.x install) beside it. */
function makeMachine({ global = true, project = true, limit = Infinity, marker = true } = {}) {
  const root = tmpDir();
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(proj, { recursive: true });
  const out = { root, home, project: proj, rels: [], cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  if (global) out.rels = install1x({ claudeDir: path.join(home, '.claude'), cmd: globalCmd, limit, marker }).rels;
  if (project) install1x({ claudeDir: path.join(proj, '.claude'), cmd: projectCmd, limit, marker });
  return out;
}

/** Sorted list of every path below `dir` (files, dirs, symlinks) with file contents: the "state" tests compare. */
function snapshot(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const full = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      // Windows PowerShell (the consent gate's ancestry query) creates AppData\Roaming under a fixture USERPROFILE: its
      // profile bootstrap, not a rig-init write, so it is not state
      if (process.platform === 'win32' && rel === 'home' && name === 'AppData') continue;
      const st = fs.lstatSync(full);
      if (st.isDirectory()) { out[`${r}/`] = 'dir'; walk(full, r); } else out[r] = st.isSymbolicLink() ? `-> ${fs.readlinkSync(full)}` : fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

/** Every `node <path>` hook/statusLine command of a settings file must point at an existing file (no MODULE_NOT_FOUND). */
function danglingCommands(claudeDir, home, project) {
  const missing = [];
  const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
  const commands = [
    ...(settings.statusLine ? [settings.statusLine.command] : []),
    ...Object.values(settings.hooks || {}).flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command))),
  ];
  for (const command of commands) {
    const m = /^node\s+"?([^"\s]+)"?(\S*)/.exec(command);
    if (!m) continue;
    const p = (m[1] + m[2]).replace('$HOME', home).replace('$CLAUDE_PROJECT_DIR', project || '');
    if (path.isAbsolute(p) && !p.startsWith('/opt/') && !fs.existsSync(p)) missing.push(command);
  }
  return missing;
}

module.exports = { tmpDir, write, install1x, makeMachine, snapshot, danglingCommands, settingsFor, globalCmd, projectCmd, HOOK_FILES, USER_HOOK_COMMAND };
