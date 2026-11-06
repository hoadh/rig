#!/usr/bin/env node
/**
 * Known debt, ratcheted: text under plugins/rig/ that still points at the 1.x file-install layout
 * (`.claude/skills/...`, `$HOME/.claude/skills/...`, or the old `skills/rig-plan|rig-debug` dirs).
 * Phase 2 replaces them with bin/ entrypoints and ${CLAUDE_SKILL_DIR}; until then this test records
 * the count per file and fails when any file gains a reference or a new file adds one, so the debt can
 * only go down. When you remove references, lower the numbers:
 *   node scripts/legacy-skill-path-refs-baseline.test.cjs --write
 * Run: node scripts/legacy-skill-path-refs-baseline.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOT = path.join(ROOT, 'plugins', 'rig');
const BASELINE_FILE = path.join(__dirname, 'legacy-skill-path-refs-baseline.json');
const SKIP_DIRS = new Set(['node_modules', '.venv', '__pycache__', '.logs', '__tests__', 'tests', 'fixtures']);
const SKIP_FILES = /\.(test\.cjs|test\.js|test\.ts|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|pdf|zip|csv)$/i;
const PATTERN = /\.claude[\\/]skills|skills\/rig-(?:plan|debug)\b/g;

function scan(dir, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) scan(full, out);
    } else if (!SKIP_FILES.test(entry.name)) {
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue;
      const count = (buf.toString('utf8').match(PATTERN) || []).length;
      if (count > 0) out[path.relative(ROOT, full).split(path.sep).join('/')] = count;
    }
  }
  return out;
}

const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

if (process.argv.includes('--write')) {
  const counts = scan(SCAN_ROOT);
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2)}\n`);
  console.log(`wrote ${BASELINE_FILE}: ${sum(counts)} references in ${Object.keys(counts).length} files`);
  process.exit(0);
}

describe('legacy .claude/skills path references (known debt, must not grow)', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const current = scan(SCAN_ROOT);

  it('scans the plugin (guards against a wrong root making the check vacuous)', () => {
    assert.ok(fs.existsSync(path.join(SCAN_ROOT, '.claude-plugin', 'plugin.json')), 'plugin root exists');
    assert.ok(sum(baseline) > 0, 'baseline is not empty while the debt exists');
  });

  it('no file has more legacy references than recorded, and no new file adds any', () => {
    const grown = Object.entries(current)
      .filter(([file, n]) => n > (baseline[file] || 0))
      .map(([file, n]) => `${file}: ${n} (baseline ${baseline[file] || 0})`);
    assert.deepStrictEqual(grown, [], `new legacy path references; use bin/ entrypoints or \${CLAUDE_SKILL_DIR} instead:\n${grown.join('\n')}`);
  });

  it('the baseline is tight: lower it when references are removed (--write)', () => {
    const stale = Object.entries(baseline)
      .filter(([file, n]) => (current[file] || 0) < n)
      .map(([file, n]) => `${file}: ${current[file] || 0} now, baseline ${n}`);
    assert.deepStrictEqual(stale, [], `baseline is higher than reality; run: node scripts/legacy-skill-path-refs-baseline.test.cjs --write\n${stale.join('\n')}`);
  });
});
