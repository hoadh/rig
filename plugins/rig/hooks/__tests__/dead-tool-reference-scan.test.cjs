#!/usr/bin/env node
/**
 * Guards against tool names Claude Code no longer ships (or that are off by default) in kit agents, skills and docs.
 * Run: node --test plugins/rig/hooks/__tests__/dead-tool-reference-scan.test.cjs
 *
 * Scans Markdown under plugins/rig/ and .agent/ (agents, skills, rules). Code files are out of scope: they may legitimately
 * name OS concepts such as a Windows "Scheduled Task". History files (changelogs, devlog) are excluded.
 * Flagged: MultiEdit, BashOutput, KillBash, the LS tool (in `tools:` lists or "LS tool" prose), `Task(...)` call/spec syntax
 * (use `Agent(...)` or the built-in Explore agent), and "Task tool" wording (the tool is the Agent tool).
 * The shell command `ls` is fine: only the upper-case tool name is matched.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '.logs', 'devlog', '__pycache__', '__tests__']);
const SKIP_FILES = new Set(['CHANGELOG.md', 'changelog.md']);

/** Each rule matches a single line. `LS` is only a tool name in `tools:` lists, "LS tool" prose or `LS` in backticks. */
const RULES = [
  { name: 'MultiEdit', test: (l) => /\bMultiEdit\b/.test(l) },
  { name: 'BashOutput', test: (l) => /\bBashOutput\b/.test(l) },
  { name: 'KillBash', test: (l) => /\bKillBash\b/.test(l) },
  { name: 'LS tool', test: (l) => (/^\s*(tools|allowed-tools):/.test(l) && /[\s,:]LS\b/.test(l)) || /\bLS tool\b/.test(l) || /`LS`/.test(l) },
  { name: 'Task( spec', test: (l) => /(^|[^\w])Task\(/.test(l) },
  { name: 'Task tool wording', test: (l) => /\bTask [Tt]ools?\b/.test(l) },
];

/** Collect Markdown files under `dir`. */
function collect(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.md') && !SKIP_FILES.has(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// The Tasks API is off by default: a skill file that mentions TaskCreate/TaskUpdate must say it is optional
// ("only if TaskCreate is available", "if tasks exist", ...) in the same paragraph as, or before, its first mention.
// Skills/team is exempt (teams run with their own shared task list).
const TASK_API = /\bTask(Create|Update)\b/;
const TASK_GUARD = /(if|only if|when)\s+`?Task\w+`?\s+(is|are)\s+available|`?Task\w+`?\s+(is |are )?available|if tasks (exist|were created)|if available|off by default/i;

describe('Tasks API is optional in skills', () => {
  it('every skill file mentioning TaskCreate/TaskUpdate guards it with an "if available" note first', () => {
    const files = collect(path.join(ROOT, 'plugins', 'rig', 'skills'), []).filter((f) => !f.includes(`${path.sep}skills${path.sep}team${path.sep}`));
    const hits = [];
    for (const file of files) {
      const paragraphs = fs.readFileSync(file, 'utf8').split(/\r?\n\s*\r?\n/);
      let guarded = false;
      for (const para of paragraphs) {
        if (TASK_GUARD.test(para)) guarded = true;
        if (TASK_API.test(para) && !guarded) {
          hits.push(`${path.relative(ROOT, file)}: ${para.trim().split('\n')[0].slice(0, 100)}`);
          break;
        }
      }
    }
    assert.deepStrictEqual(hits, [], `unguarded Tasks API use (add "create tasks only if TaskCreate is available; otherwise track in phase files"):\n${hits.join('\n')}`);
  });
});

describe('dead tool names are not referenced', () => {
  it('has no MultiEdit, LS, BashOutput, KillBash, Task( or "Task tool" in plugins/rig/ and .agent/ Markdown', () => {
    const files = [];
    for (const target of ['plugins/rig', '.agent']) collect(path.join(ROOT, target), files);
    assert.ok(files.length > 50, 'scan found the kit files');

    const hits = [];
    for (const file of files) {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.test(line)) hits.push(`[${rule.name}] ${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    assert.deepStrictEqual(hits, [], `dead tool references:\n${hits.join('\n')}`);
  });
});
