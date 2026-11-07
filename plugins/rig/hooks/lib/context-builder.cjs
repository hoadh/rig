#!/usr/bin/env node
/**
 * context-builder.cjs - Per-prompt context for the dev-rules-reminder hook
 *
 * Only dynamic facts go here: date/time, plan context and the naming pattern. The hook
 * emits them only when the plan context or git branch changed since the last emit
 * (see shouldEmitReminder). The static Paths section is printed once by session-init.
 * Static guidance (YAGNI/KISS/DRY, modularization, report style) lives in
 * the rules files and CLAUDE.md, which Claude Code loads natively (the plugin injects them at session start).
 *
 * @module context-builder
 */

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./plugin-data-dir.cjs');
const { execSync } = require('child_process');
const {
  loadConfig,
  resolvePlanPath,
  getReportsPath,
  resolveNamingPattern,
  formatDate,
  normalizePath
} = require('./rig-config-utils.cjs');

// First header of the reminder; also the marker wasRecentlyInjected() looks for
const REMINDER_MARKER = '## Rig Session';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely execute a command
 * @param {string} cmd - Command to execute
 * @returns {string|null} Output or null on error
 */
function execSafe(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * The Python venv `rig-python` uses, when it is ready: the same function the bins use (`venvDirFor`), so the
 * session context and the bins always name one venv (plugin: ~/.claude/rig/venv; file install: <.claude>/skills/.venv).
 * @param {string} [_configDirName] - unused, kept for callers of the 1.x signature
 * @param {string} [kitRoot] - kit root (default: the root this hook runs from)
 * @returns {string|null} absolute venv python path, or null while the venv is missing or incomplete
 */
function resolveSkillsVenv(_configDirName, kitRoot = path.resolve(__dirname, '..', '..')) {
  try {
    const { venvDirFor, venvPythonPath, venvReady } = require('../../scripts/rig-python-venv-resolver.cjs');
    const venvDir = venvDirFor({ kitRoot });
    return venvReady({ kitRoot, venvDir }) ? venvPythonPath(venvDir) : null;
  } catch {
    return null;
  }
}

/**
 * The one line emitted on every prompt: current stamp in the plan dateFormat
 * (default YYMMDD-HHmm, the stamp Naming uses) plus the time zone.
 * @param {string} [dateFormat='YYMMDD-HHmm']
 * @returns {string}
 */
function buildNowLine(dateFormat) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `- Now: ${formatDate(dateFormat || 'YYMMDD-HHmm')} (${timezone})`;
}

/**
 * Build plan context from config and git info
 * @param {string|null} sessionId - Session ID
 * @param {Object} config - Loaded config
 * @returns {Object} Plan context object
 */
function buildPlanContext(sessionId, config) {
  const { plan, paths } = config;
  const gitBranch = execSafe('git branch --show-current');
  const resolved = resolvePlanPath(sessionId, config);
  const reportsPath = getReportsPath(resolved.path, resolved.resolvedBy, plan, paths);
  // The stamp is left as the literal {now}: the reminder emits the full block only on change,
  // so a baked timestamp would go stale. The Now line (every prompt) carries the live value.
  const namePattern = resolveNamingPattern({ ...plan, dateFormat: '{now}' }, gitBranch);
  const nowLine = buildNowLine(plan.dateFormat);

  const planLine = resolved.resolvedBy === 'session'
    ? `- Plan: ${resolved.path}`
    : resolved.resolvedBy === 'branch'
      ? `- Plan: none | Suggested: ${resolved.path}`
      : `- Plan: none`;

  const validation = plan.validation || {};
  const validationMode = validation.mode || 'prompt';
  const validationMin = validation.minQuestions || 3;
  const validationMax = validation.maxQuestions || 8;

  return { reportsPath, gitBranch, planLine, namePattern, nowLine, validationMode, validationMin, validationMax };
}

/**
 * Check if the reminder was injected within the last few prompts
 * @param {string} transcriptPath - Path to transcript file
 * @returns {boolean} true if recently injected
 */
function wasRecentlyInjected(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return false;
    const transcript = fs.readFileSync(transcriptPath, 'utf-8');
    return transcript.split('\n').slice(-150).some(line => line.includes(REMINDER_MARKER));
  } catch (e) {
    return false;
  }
}

/**
 * Per-session file remembering what the reminder last emitted.
 * Session ids come from Claude Code; anything outside [A-Za-z0-9_-] is replaced so the
 * id can never escape the temp dir.
 * @param {string} sessionId
 * @returns {string}
 */
function getReminderStatePath(sessionId) {
  return path.join(stateDir(), `rig-reminder-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

/**
 * Decide whether the reminder must be emitted, and remember the signature when it is.
 * Emits on the first prompt of a session (no state), when the signature (plan context
 * + git branch) differs from the last emit, and always when there is no session id or
 * the state file cannot be read or written (fail open: a repeated reminder is cheaper
 * than a missing one).
 * @param {string|null} sessionId
 * @param {string} signature - Current plan-context/branch signature
 * @returns {boolean}
 */
function shouldEmitReminder(sessionId, signature) {
  if (!sessionId) return true;
  const statePath = getReminderStatePath(sessionId);
  try {
    // Never trust a symlink planted at the state path (shared temp dir)
    if (!fs.lstatSync(statePath).isSymbolicLink()
      && JSON.parse(fs.readFileSync(statePath, 'utf8')).signature === signature) {
      return false;
    }
  } catch (e) {
    // missing or unreadable state: treat as changed
  }
  // Write to a fresh private temp name (exclusive create, 0600), then rename over the state path:
  // rename replaces a symlink instead of following it
  const tmpFile = `${statePath}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({ signature }), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmpFile, statePath);
  } catch (e) {
    // cannot persist: the next prompt emits again, which is the safe direction
    try { fs.unlinkSync(tmpFile); } catch (_) { /* nothing to remove */ }
  }
  return true;
}

/**
 * Forget the last-emitted signature so the next prompt emits the reminder again
 * (session-init calls this on start, resume, clear and compact: the context was reset).
 * @param {string|null} sessionId
 */
function clearReminderState(sessionId) {
  if (!sessionId) return;
  try { fs.unlinkSync(getReminderStatePath(sessionId)); } catch (e) { /* none to clear */ }
}

/**
 * Join a possibly-absolute path onto baseDir without doubling it
 * (path.join('/a', '/a/b') gives '/a/a/b'; path.resolve gives '/a/b').
 * Keeps a trailing separator when the input had one.
 */
function toAbsolute(baseDir, p) {
  if (!baseDir) return p;
  const abs = path.resolve(baseDir, p);
  return /[\\/]$/.test(p) ? abs + path.sep : abs;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build session section (date/time and, if configured, thinking language).
 * Response language is left to Claude Code's native `language` setting.
 * @param {Object} params
 * @param {string} [params.thinkingLanguage] - Language for reasoning
 * @param {string} [params.nowLine] - Pre-built `- Now: ...` line
 * @returns {string[]} Lines for session section
 */
function buildSessionSection({ thinkingLanguage, nowLine } = {}) {
  const lines = [REMINDER_MARKER, nowLine || buildNowLine()];
  if (thinkingLanguage) {
    lines.push(`- Thinking language: ${thinkingLanguage}`);
  }
  lines.push(``);
  return lines;
}

/**
 * Build paths section
 * @param {Object} params
 * @param {string} params.reportsPath - Reports path
 * @param {string} params.plansPath - Plans path
 * @param {string} params.docsPath - Docs path
 * @param {number} [params.docsMaxLoc=800] - Max lines per doc file
 * @param {string} [params.skillsVenv] - Skills venv Python path
 * @returns {string[]} Lines for paths section
 */
function buildPathsSection({ reportsPath, plansPath, docsPath, docsMaxLoc = 800, skillsVenv }) {
  const lines = [
    `## Paths`,
    `- Reports: ${reportsPath} | Plans: ${plansPath}/ | Docs: ${docsPath}/ | docs.maxLoc: ${docsMaxLoc}`,
    `- Markdown files go in Plans or Docs unless the user asks otherwise`
  ];
  if (skillsVenv) {
    lines.push(`- Skills Python: \`${skillsVenv}\``);
  }
  lines.push(``);
  return lines;
}

/**
 * Build plan context section
 * @param {Object} params
 * @param {string} params.planLine - Plan status line
 * @param {string} [params.gitBranch] - Git branch
 * @param {string} params.validationMode - Validation mode
 * @param {number} params.validationMin - Min questions
 * @param {number} params.validationMax - Max questions
 * @returns {string[]} Lines for plan context section
 */
function buildPlanContextSection({ planLine, gitBranch, validationMode, validationMin, validationMax }) {
  const lines = [`## Plan Context`, planLine];
  if (gitBranch) {
    lines.push(`- Branch: ${gitBranch}`);
  }
  lines.push(`- Validation: mode=${validationMode}, questions=${validationMin}-${validationMax}`);
  lines.push(``);
  return lines;
}

/**
 * Build naming section
 * @param {Object} params
 * @param {string} params.reportsPath - Reports path
 * @param {string} params.plansPath - Plans path
 * @param {string} params.namePattern - Naming pattern
 * @returns {string[]} Lines for naming section
 */
function buildNamingSection({ reportsPath, plansPath, namePattern }) {
  return [
    `## Naming`,
    `- Report: \`${reportsPath}{type}-${namePattern}.md\``,
    `- Plan dir: \`${plansPath}/${namePattern}/\``,
    `- \`{type}\`: agent name or report type; \`{slug}\`: descriptive-kebab-slug; \`{now}\`: the stamp from the latest \`Now:\` line`
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the per-prompt reminder
 *
 * @param {Object} [params]
 * @param {string} [params.sessionId] - Session ID
 * @param {Object} [params.config] - Rig config (auto-loaded if not provided)
 * @param {string} [params.configDirName='.claude'] - Config directory name
 * @param {string} [params.baseDir] - Project directory; paths become absolute against it
 * @returns {{ content: string, lines: string[], sections: Object, signature: string, nowLine: string }}
 */
function buildReminderContext({ sessionId, config, configDirName = '.claude', baseDir } = {}) {
  const cfg = config || loadConfig({ includeProject: false, includeAssertions: false });
  const planCtx = buildPlanContext(sessionId, cfg);

  const plansPath = toAbsolute(baseDir, normalizePath(cfg.paths?.plans) || 'plans');
  const docsPath = toAbsolute(baseDir, normalizePath(cfg.paths?.docs) || 'docs');
  const reportsPath = toAbsolute(baseDir, planCtx.reportsPath);

  const sections = {
    session: buildSessionSection({ thinkingLanguage: cfg.locale?.thinkingLanguage, nowLine: planCtx.nowLine }),
    paths: buildPathsSection({
      reportsPath,
      plansPath,
      docsPath,
      docsMaxLoc: Math.max(1, parseInt(cfg.docs?.maxLoc, 10) || 800),
      skillsVenv: resolveSkillsVenv(configDirName)
    }),
    planContext: buildPlanContextSection(planCtx),
    naming: buildNamingSection({ reportsPath, plansPath, namePattern: planCtx.namePattern })
  };

  const lines = [...sections.session, ...sections.paths, ...sections.planContext, ...sections.naming];
  // What makes a re-emit worthwhile: the plan context line and the git branch
  const signature = JSON.stringify([planCtx.planLine, planCtx.gitBranch || '']);
  return { content: lines.join('\n'), lines, sections, signature, nowLine: planCtx.nowLine };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  REMINDER_MARKER,
  buildReminderContext,
  shouldEmitReminder,
  clearReminderState,
  getReminderStatePath,

  // Section builders
  buildSessionSection,
  buildPathsSection,
  buildPlanContextSection,
  buildNamingSection,

  // Helpers
  execSafe,
  resolveSkillsVenv,
  buildPlanContext,
  buildNowLine,
  wasRecentlyInjected,
  toAbsolute
};
