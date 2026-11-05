#!/usr/bin/env node
/**
 * A skill with `disable-model-invocation: true` cannot be invoked by the model, so another skill or agent that
 * chains into it (`/rig:<name>`, `Skill(...<name>...)`, "activate <name>") would silently break.
 * Run: node --test .claude/hooks/__tests__/disable-model-invocation-chain-scan.test.cjs
 *
 * For every such skill, scans Markdown of all OTHER skills and agents under .claude/ and .agent/. The skill's own
 * directory is exempt (it may describe its own usage). Docs, README and rules are not chains and are not scanned.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '.logs', '__pycache__', '__tests__']);

function collectMarkdown(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectMarkdown(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Read the leading YAML frontmatter block as a flat key -> raw value map. */
function readFrontmatter(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (!m) return fields;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return fields;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Patterns that name `bare` (name without the rig: prefix) as an invoke target. */
function invokePatterns(bare) {
  const n = escapeRe(bare);
  const end = '(?![\\w-])';
  return [
    new RegExp(`/rig:${n}${end}`),
    new RegExp(`(^|[^\\w/])rig:${n}${end}`),
    new RegExp(`Skill\\([^)]*(^|[^\\w-])${n}${end}`),
    new RegExp(`[Aa]ctivate\\s+(the\\s+)?[\`"']?(rig:)?${n}${end}`),
  ];
}

describe('disable-model-invocation skills are not chained', () => {
  const dmiSkills = [];
  for (const skillMd of collectMarkdown(path.join(ROOT, '.claude', 'skills'), []).filter((f) => path.basename(f) === 'SKILL.md')) {
    const fm = readFrontmatter(skillMd);
    if (fm['disable-model-invocation'] === 'true') {
      dmiSkills.push({ bare: (fm.name || path.basename(path.dirname(skillMd))).replace(/^rig:/, ''), dirName: path.basename(path.dirname(skillMd)) });
    }
  }

  it('no skill or agent invokes a disable-model-invocation skill', () => {
    const files = [];
    for (const base of ['.claude', '.agent']) {
      collectMarkdown(path.join(ROOT, base, 'skills'), files);
      collectMarkdown(path.join(ROOT, base, 'agents'), files);
    }
    const hits = [];
    for (const { bare, dirName } of dmiSkills) {
      const patterns = invokePatterns(bare);
      const ownDirs = ['.claude', '.agent'].map((b) => path.join(ROOT, b, 'skills', dirName) + path.sep);
      for (const file of files) {
        if (ownDirs.some((d) => file.startsWith(d))) continue;
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (patterns.some((p) => p.test(line))) hits.push(`[${bare}] ${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
      }
    }
    assert.deepStrictEqual(hits, [], `DMI skills invoked by other skills/agents:\n${hits.join('\n')}`);
  });

  it('never marks remote or problem-solving (chained targets) as disable-model-invocation', () => {
    const names = dmiSkills.map((s) => s.bare);
    for (const forbidden of ['remote', 'problem-solving']) assert.ok(!names.includes(forbidden), `${forbidden} must stay model-invocable`);
  });
});
