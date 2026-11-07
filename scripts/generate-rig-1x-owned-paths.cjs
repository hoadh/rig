#!/usr/bin/env node
/**
 * Regenerates plugins/rig/scripts/rig-init/rig-1x-owned-paths.json: the union of the `.claude/` files the 1.x
 * installer copied, taken from the git tags v1.0.0 and v1.1.0 (both modes install the same files below `.claude/`),
 * plus the files and hooks older installs left behind (the 1.1.0 retired-kit lists).
 *
 *   node scripts/generate-rig-1x-owned-paths.cjs          # rewrite the JSON
 *   node scripts/generate-rig-1x-owned-paths.cjs --check  # exit 1 when the JSON differs (needs the tags)
 *
 * Paths are relative to the installed `.claude/` dir. Never listed: user config the installer only created when
 * missing (.env.example, .gitignore, .mcp.json.example, .rig.json), settings.json (rewritten, not moved), secrets and
 * generated state (those are handled by rig-1x-owned-paths.cjs as generated dirs).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'plugins', 'rig', 'scripts', 'rig-init', 'rig-1x-owned-paths.json');
const TAGS = ['v1.0.0', 'v1.1.0'];
const RETIRED_SOURCE_TAG = 'v1.1.0';
const RETIRED_SOURCE_PATH = 'scripts/install-kit/retired-kit-hooks-and-files-cleanup.cjs';
const USER_CONFIG = new Set(['.env.example', '.gitignore', '.mcp.json.example', '.rig.json', 'settings.json', 'settings.local.json']);
const NEVER = [
  /(^|\/)\.env$/, /(^|\/)\.env\.local$/, /(^|\/)\.env\.[^/]*\.local$/, /\.(key|pem|p12)$/i,
  /(^|\/)(node_modules|\.git|\.github|\.venv|venv|__pycache__)\//, /(^|\/)(\.DS_Store|Thumbs\.db)$/, /\.log$/, /^hooks\/\.logs\//,
];

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function filesAtTag(tag) {
  return git('ls-tree', '-r', '--name-only', '-z', tag, '.claude').split('\0').filter(Boolean)
    .map((p) => p.slice('.claude/'.length))
    .filter((rel) => !USER_CONFIG.has(rel) && !NEVER.some((re) => re.test(rel)));
}

/** RETIRED_KIT_HOOKS / RETIRED_KIT_FILES of the 1.1.0 installer, read from the tag (the module is deleted from the tree). */
function retiredAtTag() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-retired-'));
  try {
    const file = path.join(dir, 'retired.cjs');
    fs.writeFileSync(file, git('show', `${RETIRED_SOURCE_TAG}:${RETIRED_SOURCE_PATH}`));
    const mod = require(file);
    return [...mod.RETIRED_KIT_HOOKS.map((n) => `hooks/${n}.cjs`), ...mod.RETIRED_KIT_FILES];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function build() {
  const files = new Set([...TAGS.flatMap(filesAtTag), ...retiredAtTag()]);
  return { schema: 1, sources: [...TAGS, `${RETIRED_SOURCE_TAG} retired-kit lists`], files: [...files].sort() };
}

if (require.main === module) {
  const text = `${JSON.stringify(build(), null, 1)}\n`;
  if (process.argv.includes('--check')) {
    // A CRLF checkout (core.autocrlf) must not read as drift
    if (fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') !== text) {
      console.error('rig-1x-owned-paths.json is out of date; run node scripts/generate-rig-1x-owned-paths.cjs');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}

module.exports = { build };
