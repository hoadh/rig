/**
 * verify-guard-config.cjs - effective settings for the verify-completion-guard Stop hook.
 *
 * Trust model: sources are DEFAULT -> global ~/.claude/.rig.json -> project
 * <CLAUDE_PROJECT_DIR>/.claude/.rig.json (anchored to the project dir, never the shell cwd, which
 * moves with `cd`). A repository may RAISE the mode (off < remind < block) but never lower it
 * below the global value, and cannot switch the guard off: only the global `hooks` toggle can.
 * `extraCommandPatterns` is global only, capped, and vetted against ReDoS-prone shapes.
 *
 *   { "hooks": { "verify-completion-guard": false },            // global: guard off, final
 *     "verifyGuard": { "mode": "remind" | "block" | "off",
 *                      "extraCommandPatterns": ["^make e2e$"] } } // patterns: global only
 *
 * Does not use rig-config-utils (it reads cwd-relative config and drops unknown sections).
 * Exports: loadVerifyGuardConfig({homeDir, projectDir}) -> {mode, source, disabled, extraPatterns, rejected}
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MODE = 'remind';
const RANK = { off: 0, remind: 1, block: 2 };
const MAX_PATTERNS = 20;
const MAX_PATTERN_CHARS = 200;
const MAX_CONFIG_BYTES = 256 * 1024;
// Quantified group followed by another quantifier, e.g. (a+)+ or (a*){2,}: catastrophic backtracking.
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)[+*{]/;

/** Parsed JSON object from file, or {} when absent/unreadable/oversized/not an object. */
function readConfigFile(file) {
  try {
    if (fs.statSync(file).size > MAX_CONFIG_BYTES) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function modeOf(config) {
  const guard = config && config.verifyGuard;
  const mode = guard && typeof guard === 'object' ? guard.mode : undefined;
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(RANK, mode) ? mode : null;
}

/** Compiles vetted patterns; returns {patterns, rejected:[reason]}. */
function vetPatterns(list) {
  const patterns = [];
  const rejected = [];
  if (!Array.isArray(list)) return { patterns, rejected };
  list.forEach((src, i) => {
    if (patterns.length >= MAX_PATTERNS) {
      rejected.push(`#${i}: over ${MAX_PATTERNS} entries`);
    } else if (typeof src !== 'string' || src.length === 0 || src.length > MAX_PATTERN_CHARS) {
      rejected.push(`#${i}: not a string of 1-${MAX_PATTERN_CHARS} chars`);
    } else if (NESTED_QUANTIFIER.test(src)) {
      rejected.push(`#${i}: nested quantifier`);
    } else {
      try {
        patterns.push(new RegExp(src));
      } catch {
        rejected.push(`#${i}: invalid regex`);
      }
    }
  });
  return { patterns, rejected };
}

function loadVerifyGuardConfig({ homeDir = os.homedir(), projectDir = '' } = {}) {
  const global = readConfigFile(path.join(homeDir, '.claude', '.rig.json'));
  const hooks = global.hooks;
  const disabled = !!(hooks && typeof hooks === 'object' && hooks['verify-completion-guard'] === false);

  let mode = DEFAULT_MODE;
  let source = 'default';
  const globalMode = modeOf(global);
  if (globalMode) {
    mode = globalMode;
    source = 'global';
  }
  if (projectDir) {
    const projectMode = modeOf(readConfigFile(path.join(projectDir, '.claude', '.rig.json')));
    if (projectMode && RANK[projectMode] > RANK[mode]) {
      mode = projectMode;
      source = 'project';
    }
  }

  const guard = global.verifyGuard;
  const { patterns, rejected } = vetPatterns(guard && typeof guard === 'object' ? guard.extraCommandPatterns : undefined);
  return { mode: disabled ? 'off' : mode, source: disabled ? 'global' : source, disabled, extraPatterns: patterns, rejected };
}

module.exports = { loadVerifyGuardConfig, vetPatterns };
