/**
 * bash-safety-guard-config.cjs - on/off switches for the bash-safety-guard hook.
 *
 * Reads ONLY the global ~/.claude/.rig.json. Project-local .rig.json is deliberately ignored: a
 * repository must not be able to switch off a guard that protects the user's machine.
 *
 *   { "hooks": { "bash-safety-guard": false },                     // turns every rule off
 *     "bashSafetyGuard": { "rules": { "inPlaceEditSymlink": false, // per-rule switch
 *                                     "processKill": false } } }
 *
 * Anything missing or unreadable means "enabled" (the guard defaults on).
 * Exports: loadGuardSwitches(), isGuardEnabled(switches), isRuleEnabled(switches, configKey)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Parsed global config, or {} when absent/unreadable/not an object. os.homedir() honours HOME/USERPROFILE. */
function loadGuardSwitches() {
  try {
    const file = path.join(os.homedir(), '.claude', '.rig.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isGuardEnabled(config) {
  const hooks = config && config.hooks;
  return !(hooks && typeof hooks === 'object' && hooks['bash-safety-guard'] === false);
}

function isRuleEnabled(config, configKey) {
  const guard = config && config.bashSafetyGuard;
  const rules = guard && typeof guard === 'object' ? guard.rules : null;
  return !(rules && typeof rules === 'object' && rules[configKey] === false);
}

module.exports = { loadGuardSwitches, isGuardEnabled, isRuleEnabled };
