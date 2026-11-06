/**
 * Single source of truth for the Diataxis docs layout used by /rig:docs,
 * validate-docs.cjs and migrate-docs-to-diataxis-layout.cjs.
 *
 * Mapping is explicit old -> new pairs (never inferred from basenames).
 * Pure fs helpers, no git, no deps.
 */

const fs = require('fs');
const path = require('path');

// Legacy flat file -> Diataxis path (relative to docs/). Order matters: when two
// legacy files map to the same target, the earlier one wins, the later conflicts.
const LEGACY_FILE_MAP = [
  { from: 'code-standards.md', to: 'reference/code-standards.md' },
  { from: 'codebase-summary.md', to: 'reference/codebase-summary.md' },
  { from: 'design-guidelines.md', to: 'reference/design-guidelines.md' },
  { from: 'system-architecture.md', to: 'explanation/architecture.md' },
  { from: 'deployment-guide.md', to: 'how-to/deploy.md' },
  { from: 'project-overview-pdr.md', to: 'project/overview-pdr.md' },
  { from: 'project-roadmap.md', to: 'project/roadmap.md' },
  { from: 'development-roadmap.md', to: 'project/roadmap.md' },
  { from: 'project-changelog.md', to: 'project/changelog.md' }
];

// Legacy directories that move as a whole.
const LEGACY_DIR_MAP = [
  { from: 'decisions', to: 'explanation/decisions' }
];

const DIATAXIS_DIRS = ['tutorials', 'how-to', 'reference', 'explanation'];
const PROJECT_DIR = 'project';

// Non-reader content; dot-dirs are always skipped as well. 'journals' is the legacy name of 'devlog'.
const SKIP_DIRS = ['devlog', 'journals', 'assets', 'research', 'infographics'];

/**
 * Recursively list .md files under dir, skipping dot-dirs and skipDirs names.
 */
function findMarkdownFilesRecursive(dir, skipDirs = SKIP_DIRS) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name)) continue;
      results.push(...findMarkdownFilesRecursive(full, skipDirs));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Legacy files/dirs present under docsDir -> [{from, to, type: 'file'|'dir'}].
 */
function detectLegacyLayout(docsDir) {
  const found = [];
  const probe = (map, type) => {
    for (const { from, to } of map) {
      let stat;
      try { stat = fs.statSync(path.join(docsDir, from)); } catch (e) { continue; }
      if (type === 'dir' ? stat.isDirectory() : stat.isFile()) found.push({ from, to, type });
    }
  };
  probe(LEGACY_FILE_MAP, 'file');
  probe(LEGACY_DIR_MAP, 'dir');
  return found;
}

/**
 * .md files at docs/ root that are neither README.md nor a known legacy file.
 */
function findUnclassifiedRootDocs(docsDir) {
  if (!fs.existsSync(docsDir)) return [];
  const legacy = new Set(LEGACY_FILE_MAP.map(p => p.from));
  return fs.readdirSync(docsDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md' && !legacy.has(e.name))
    .map(e => e.name);
}

/**
 * Top-level docs/ dirs holding .md pages that are neither a Diataxis dir, project/,
 * a skipped dir, nor a known legacy dir (e.g. ad-hoc guides/ or notes/).
 */
function findUnclassifiedTopDirs(docsDir) {
  if (!fs.existsSync(docsDir)) return [];
  const known = new Set([...DIATAXIS_DIRS, PROJECT_DIR, ...SKIP_DIRS, ...LEGACY_DIR_MAP.map(d => d.from)]);
  return fs.readdirSync(docsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !known.has(e.name))
    .filter(e => findMarkdownFilesRecursive(path.join(docsDir, e.name)).length > 0)
    .map(e => e.name);
}

/**
 * Layout warnings for validate-docs (read-only). Returns array of strings.
 */
function checkLayout(docsDir) {
  const warnings = [];
  for (const { from, to } of detectLegacyLayout(docsDir)) {
    warnings.push(`legacy layout: docs/${from} should be docs/${to} (run: /rig:docs restructure, or node .claude/scripts/migrate-docs-to-diataxis-layout.cjs)`);
  }
  for (const name of findUnclassifiedRootDocs(docsDir)) {
    warnings.push(`unclassified root doc: docs/${name} (file under tutorials/, how-to/, reference/, explanation/ or project/; run: /rig:docs restructure)`);
  }
  for (const name of findUnclassifiedTopDirs(docsDir)) {
    warnings.push(`unclassified docs dir: docs/${name}/ (move its pages under a Diataxis dir or project/; run: /rig:docs restructure)`);
  }
  const hasDiataxisDir = DIATAXIS_DIRS.some(d => fs.existsSync(path.join(docsDir, d)));
  if (hasDiataxisDir && !fs.existsSync(path.join(docsDir, 'README.md'))) {
    warnings.push('docs/README.md missing (Diataxis map/index required when Diataxis dirs exist)');
  }
  return warnings;
}

module.exports = {
  LEGACY_FILE_MAP,
  LEGACY_DIR_MAP,
  DIATAXIS_DIRS,
  PROJECT_DIR,
  SKIP_DIRS,
  findMarkdownFilesRecursive,
  detectLegacyLayout,
  findUnclassifiedRootDocs,
  findUnclassifiedTopDirs,
  checkLayout
};
