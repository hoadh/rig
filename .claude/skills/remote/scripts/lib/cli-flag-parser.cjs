'use strict';
/**
 * Tiny argv parser shared by orchestrator commands.
 * defs: { '--ref': 'value', '--detach': 'bool' }. Returns {flags, positional, rest}
 * where `rest` = everything after a literal `--` (never interpreted).
 */
const { usageError } = require('./remote-errors.cjs');

function parseFlags(argv, defs) {
  const flags = {}, positional = [];
  const dash = argv.indexOf('--');
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const rest = dash === -1 ? [] : argv.slice(dash + 1);
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const kind = defs[a];
    if (!kind) throw usageError(`unknown option ${a}`, `allowed: ${Object.keys(defs).join(', ')}`);
    if (kind === 'bool') flags[a.slice(2)] = true;
    else {
      if (i + 1 >= head.length) throw usageError(`${a} needs a value`);
      flags[a.slice(2)] = head[++i];
    }
  }
  return { flags, positional, rest };
}

module.exports = { parseFlags };
