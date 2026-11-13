#!/usr/bin/env node
/**
 * Guards against references to features Rig 1.1 removed (built-in duplicates and the broken team API).
 * Run: node --test plugins/rig/hooks/__tests__/removed-features-reference-scan.test.cjs
 *
 * Case-insensitive; also flags links to the deleted skill reference files.
 * Scans .claude/, antigravity/rig/, .github/, docs/ (not docs/devlog, not changelog files), guide/, README.md, AGENTS.md,
 * and CLAUDE.md.
 * History files (CHANGELOG.md, docs/project/changelog.md, docs/devlog/) may still name them.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
// Removed features plus the basenames of deleted skill reference files (a dangling link to one is a bug)
const DELETED_REFERENCES = [
  'internal-exploration', 'task-management-exploration', 'code-review-reception', 'requesting-code-review',
  'verification-before-completion', 'task-management-reviews', 'edge-case-exploration', 'input-mode-resolution',
  'agent-teams-official-docs', 'agent-teams-controls-and-modes', 'agent-teams-examples-and-best-practices',
];
const FORBIDDEN = new RegExp(
  ['sequential[ _-]?thinking', 'TeamCreate', 'TeamDelete', 'notify\\.cjs', 'codingLevel', 'coding-level', 'output-styles',
    'hooks/notifications', ...DELETED_REFERENCES].join('|'),
  'i'
);
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '.logs', 'devlog', '__pycache__']);
const SKIP_FILES = new Set([
  'CHANGELOG.md', 'changelog.md', 'removed-features-reference-scan.test.cjs',
]);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.zip', '.gz', '.mp4', '.mp3', '.pyc']);

/** Collect scannable files under `target` (file or directory). */
function collect(target, out) {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (!SKIP_FILES.has(path.basename(target)) && !BINARY_EXT.has(path.extname(target).toLowerCase())) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    collect(path.join(target, entry.name), out);
  }
  return out;
}

describe('removed features are not referenced', () => {
  it('has no references to sequential-thinking, TeamCreate/TeamDelete, notify.cjs, codingLevel, coding-level or output-styles', () => {
    const files = [];
    for (const target of ['.claude', 'plugins/rig', '.claude-plugin', 'antigravity/rig', '.github', 'docs', 'guide', 'README.md', 'AGENTS.md', 'CLAUDE.md']) collect(path.join(ROOT, target), files);
    assert.ok(files.length > 50, 'scan found the kit files');
    assert.ok(files.some((f) => f.split(path.sep).join('/').includes('/antigravity/rig/')), 'scan covers the generated antigravity/rig/ plugin (run node scripts/sync-antigravity-plugin.cjs)');

    const hits = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    assert.deepStrictEqual(hits, [], `removed-feature references found:\n${hits.join('\n')}`);
  });
});
