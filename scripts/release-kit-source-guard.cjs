/**
 * Release scripts (prepare-release-assets, generate-release-manifest) package the 1.x layout: a `.claude/`
 * directory holding the kit. Since 2.0 the kit lives in plugins/rig/ and `.claude/` is Rig-dev only, so those
 * scripts would silently build an archive without hooks, skills or agents. Until phase 5 repackages releases
 * they refuse to run instead.
 */
const fs = require('fs');
const path = require('path');

const KIT_MARKERS = ['hooks/session-init.cjs', 'skills', 'agents'];

/**
 * @param {string} projectRoot
 * @throws {Error} when `<projectRoot>/.claude` does not contain the kit
 */
function assertKitSourcePresent(projectRoot) {
  const claudeDir = path.join(projectRoot, '.claude');
  const missing = KIT_MARKERS.filter((m) => !fs.existsSync(path.join(claudeDir, m)));
  if (missing.length > 0) {
    throw new Error(
      `kit source missing under ${claudeDir} (${missing.join(', ')}). Since 2.0 the kit lives in plugins/rig/; ` +
      'release packaging moves to phase 5 of the plugin plan. Refusing to build an empty archive.'
    );
  }
}

module.exports = { assertKitSourcePresent };
