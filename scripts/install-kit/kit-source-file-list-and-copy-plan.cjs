/**
 * Builds the list of kit files to install and where each one goes:
 *   local  → <project>/.claude/**, <project>/CLAUDE.md, AGENTS.md, .repomixignore, .gitignore
 *   global → ~/.claude/** (contents of .claude/) and ~/.claude/CLAUDE.md
 * Sources (since 2.0): the kit lives in plugins/rig/ and installs to `.claude/<same path>`; the plugin-only
 * files (.claude-plugin/, hooks/hooks.json) stay out; the repo's own `.claude/` supplies the user-config files
 * (an explicit allowlist: .rig.json, .env.example, .mcp.json.example, and .gitignore, which keeps .env* and keys out of git; never settings.json or anything else dev-only).
 * settings.json is generated from the plugin's hooks.json plus file-install-settings-template.json
 * (install-settings-template-from-plugin-hooks.cjs). Skill names get their `rig:` prefix back (the plugin namespace
 * adds it for plugin installs; file installs have no namespace), and `.claude/metadata.json` records the plugin version.
 * Source files come from git (tracked + untracked-not-ignored), so ignored runtime state
 * (.env, hook logs, session state, venvs, caches) never leaves the repo.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const { buildInstallSettingsTemplate } = require('./install-settings-template-from-plugin-hooks.cjs');

const PLUGIN_PREFIX = 'plugins/rig/';
// Plugin files with no meaning in a file install
const PLUGIN_ONLY = [/^plugins\/rig\/\.claude-plugin\//, /^plugins\/rig\/hooks\/hooks\.json$/, /^plugins\/rig\/file-install-settings-template\.json$/];
// The repo's own `.claude/` is Rig-development config. Only these template files ship to users.
const REPO_CLAUDE_ALLOWLIST = new Set(['.env.example', '.gitignore', '.mcp.json.example', '.rig.json']);
const SKILL_MD = /^plugins\/rig\/skills\/[^/]+\/SKILL\.md$/;

// Never copied: secrets, VCS/dependency dirs, OS junk, logs and per-machine state
const NEVER_COPY = [
  /(^|\/)\.env$/, /(^|\/)\.env\.local$/, /(^|\/)\.env\.[^/]*\.local$/, /\.(key|pem|p12)$/i,
  /(^|\/)(node_modules|\.git|\.github|\.venv|venv|__pycache__)\//, /(^|\/)(\.DS_Store|Thumbs\.db)$/, /\.log$/,
  // per-machine files that must never be pushed into another install
  /^\.claude\/settings\.local\.json$/, /^plugins\/rig\/hooks\/\.logs\//,
];

// User config: copied only when the target does not have it yet
const PRESERVE_IF_EXISTS = new Set(['.gitignore', '.repomixignore', '.mcp.json', '.rig.json', 'CLAUDE.md', 'AGENTS.md']);

const LOCAL_ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', '.repomixignore', '.gitignore', '.mcp.json'];

function listRepoFiles(kitRoot) {
  let out;
  try {
    out = execFileSync('git', ['-C', kitRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Cannot list kit files with git in ${kitRoot}; run from a git clone of the kit (${err.message.split('\n')[0]})`, { cause: err });
  }
  return [...new Set(out.split('\0').filter(Boolean))];
}

/**
 * Path of a repo file inside the installed `.claude/` dir, or null when it is not a kit file for this mode.
 * `plugins/rig/x` and `.claude/x` both map to `x`; the repo's dev-only `.claude/settings.json` is replaced by
 * the generated template under the same installed name.
 */
function installRelFor(relPath, isGlobal) {
  if (relPath.startsWith(PLUGIN_PREFIX)) return PLUGIN_ONLY.some((re) => re.test(relPath)) ? null : relPath.slice(PLUGIN_PREFIX.length);
  if (relPath.startsWith('.claude/')) {
    const inner = relPath.slice('.claude/'.length);
    return REPO_CLAUDE_ALLOWLIST.has(inner) ? inner : null;
  }
  if (isGlobal) return relPath === 'CLAUDE.md' ? relPath : null;
  return LOCAL_ROOT_FILES.includes(relPath) ? relPath : null;
}

/**
 * @returns {Array<{ rel: string, src: string, dest: string, kind: 'settings'|'preserve'|'copy', content?: string }>}
 *   `content` is set for the generated settings item.
 */
function buildCopyPlan({ kitRoot, targetRoot, isGlobal, fs }) {
  const plan = [];
  const claudeFiles = new Set();
  for (const rel of listRepoFiles(kitRoot)) {
    const installRel = installRelFor(rel, isGlobal);
    if (installRel === null || NEVER_COPY.some((re) => re.test(rel))) continue;
    const src = path.join(kitRoot, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue; // deleted-but-tracked files
    const isRootFile = !rel.startsWith(PLUGIN_PREFIX) && !rel.startsWith('.claude/');
    // Global installs flatten `.claude/` into ~/.claude itself; CLAUDE.md lands next to it
    const destRel = isGlobal || isRootFile ? installRel : `.claude/${installRel}`;
    if (!isRootFile) {
      if (claudeFiles.has(installRel)) throw new Error(`two kit sources map to .claude/${installRel}`);
      claudeFiles.add(installRel);
    }
    const dest = path.join(targetRoot, destRel);
    const isSettings = false; // settings.json is generated below, never copied from a source file
    // Only top-level user config is protected (project root or .claude/), not files nested in skills
    const isTopLevel = !installRel.includes('/');
    const kind = isSettings ? 'settings' : isTopLevel && PRESERVE_IF_EXISTS.has(path.basename(rel)) ? 'preserve' : 'copy';
    const item = { rel, src, dest, kind };
    if (isSettings) item.content = buildInstallSettingsTemplate({ kitRoot, fs });
    else if (SKILL_MD.test(rel)) item.content = prefixSkillName(fs.readFileSync(src, 'utf8'));
    plan.push(item);
  }
  plan.push(buildSettingsItem({ kitRoot, targetRoot, isGlobal, fs }));
  plan.push(buildMetadataItem({ kitRoot, targetRoot, isGlobal, fs }));
  return plan;
}

/** settings.json generated from hooks.json + the shipped permissions template (the repo's .claude/settings.json is dev-only). */
function buildSettingsItem({ kitRoot, targetRoot, isGlobal, fs }) {
  const src = path.join(kitRoot, 'plugins', 'rig', 'file-install-settings-template.json'); // mode source for the written file
  const dest = path.join(targetRoot, isGlobal ? '' : '.claude', 'settings.json');
  return { rel: 'plugins/rig/file-install-settings-template.json', src, dest, kind: 'settings', content: buildInstallSettingsTemplate({ kitRoot, fs }) };
}

/** `name: plan` -> `name: rig:plan` in the leading frontmatter only; already-prefixed names are kept. */
function prefixSkillName(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---/, (fm) => fm.replace(/^name:[ \t]*(?!rig:)(\S+)[ \t]*$/m, 'name: rig:$1'));
}

/** `.claude/metadata.json` ({name, version} from plugin.json): what remote info/doctor read in a file install. */
function buildMetadataItem({ kitRoot, targetRoot, isGlobal, fs }) {
  const src = path.join(kitRoot, 'plugins', 'rig', '.claude-plugin', 'plugin.json');
  const { name, version } = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (typeof name !== 'string' || typeof version !== 'string') throw new Error('plugin.json needs string name and version');
  const dest = path.join(targetRoot, isGlobal ? '' : '.claude', 'metadata.json');
  return { rel: 'plugins/rig/.claude-plugin/plugin.json', src, dest, kind: 'copy', content: `${JSON.stringify({ name, version }, null, 2)}\n` };
}

module.exports = { buildCopyPlan, installRelFor, prefixSkillName };
