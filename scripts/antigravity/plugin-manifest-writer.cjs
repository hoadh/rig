/**
 * Builds `.antigravity-plugin/plugin.json` for the generated Antigravity plugin.
 * Version line: `<rig version>-agy.<n>`; `n` lives in scripts/antigravity/agy-version.json, restarts at 1 when the
 * Rig version changes and is raised by hand for Antigravity-only fixes (scripts/check-antigravity-version-bump.cjs enforces it).
 */
const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const AGY_VERSION = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+?)?)-agy\.(\d+)$/;

/** `agyVersion('2.0.10', 3)` -> `2.0.10-agy.3`; n must be a positive integer. */
function agyVersion(rigVersion, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`agy-version.json: "n" must be a positive integer, got ${JSON.stringify(n)}`);
  if (typeof rigVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(rigVersion)) throw new Error(`Rig version "${rigVersion}" is not semver`);
  return `${rigVersion}-agy.${n}`;
}

/** Split `2.0.10-agy.3` into `{ rig: '2.0.10', n: 3 }`; null for anything else. */
function parseAgyVersion(v) {
  const m = typeof v === 'string' ? AGY_VERSION.exec(v) : null;
  return m ? { rig: m[1], n: Number(m[2]) } : null;
}

/** @param {{claudeManifest: object, n: number}} input @returns {object} manifest */
function buildManifest({ claudeManifest, n }) {
  const { version, description, homepage, repository, license, author } = claudeManifest;
  const manifest = {
    $schema: SCHEMA,
    name: 'rig',
    displayName: 'Rig',
    version: agyVersion(version, n),
    description: String(description || '').replace(/ for Claude Code:/, ' for Antigravity:'),
  };
  if (author) manifest.author = author;
  for (const [key, value] of Object.entries({ homepage, repository, license })) if (value) manifest[key] = value;
  manifest.keywords = ['antigravity', 'ai-agents', 'agentic-driven-development', 'workflow', 'automation'];
  return manifest;
}

module.exports = { SCHEMA, agyVersion, parseAgyVersion, buildManifest };
