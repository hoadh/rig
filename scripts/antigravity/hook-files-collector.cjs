/**
 * Collects the Rig hook files that ship in the Antigravity plugin, byte for byte.
 * A ported hook plus everything it `require`s (resolved transitively under plugins/rig/) is copied to the same
 * relative position under the output, so its relative requires keep working. Only plain string requires of
 * relative paths are followed; a require that resolves to no file is ignored (lazy, try-wrapped requires).
 */
const fs = require('fs');
const path = require('path');

const REQUIRE = /\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;
const EXTENSIONS = ['', '.cjs', '.js', '.json'];

function resolveFile(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * @param {string} pluginDir absolute path of plugins/rig
 * @param {string[]} hookNames ported hook names (`session-init` -> hooks/session-init.cjs)
 * @param {{rel: string, text: string}[]} [extraSources] shipped files that are not in plugins/rig (the adapter): `rel` is
 *   their plugin-relative path in the output (`hooks/x.cjs`), so their requires resolve against the shipped layout
 * @returns {string[]} sorted plugin-relative POSIX paths (`hooks/session-init.cjs`, `hooks/lib/x.cjs`, ...)
 */
function collectHookFiles(pluginDir, hookNames, extraSources = []) {
  const seen = new Set();
  const queue = hookNames.map((name) => path.join(pluginDir, 'hooks', `${name}.cjs`));
  for (const file of queue) if (!fs.existsSync(file)) throw new Error(`ported hook not found: ${path.relative(pluginDir, file)}`);
  const follow = (file, text) => {
    for (const [, , spec] of text.matchAll(REQUIRE)) {
      const dep = resolveFile(file, spec);
      if (!dep) continue; // lazy or optional require, or a sibling that ships from another source
      if (path.relative(pluginDir, dep).startsWith('..')) throw new Error(`${path.relative(pluginDir, file)} requires ${spec}, outside plugins/rig/`);
      queue.push(dep);
    }
  };
  for (const { rel, text } of extraSources) follow(path.join(pluginDir, ...rel.split('/')), text);
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    follow(file, fs.readFileSync(file, 'utf8'));
  }
  return [...seen].map((f) => path.relative(pluginDir, f).split(path.sep).join('/')).sort();
}

module.exports = { collectHookFiles };
