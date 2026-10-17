'use strict';
/**
 * Marks a phase In Progress locally: phase-file frontmatter `status` and the
 * plan.md table cell on the phase's row. Edits touch only those cells/lines.
 */
const fs = require('fs');
const path = require('path');
const { setFrontmatterScalar } = require('./plan-frontmatter.cjs');
const { normalizeStatus } = require('../../../_shared/lib/plan-table-parser.cjs');

/** Replace the status cell of the plan.md row that links to `phaseFile`. @returns {boolean} changed */
function setTableStatus(planFile, phaseBasename, label) {
  const lines = fs.readFileSync(planFile, 'utf8').split('\n');
  let changed = false;
  const out = lines.map((line) => {
    if (changed || !line.trim().startsWith('|') || !line.includes(`${phaseBasename})`)) return line;
    const cells = line.split('|');
    for (let i = cells.length - 1; i > 0; i--) {
      const text = cells[i].replace(/\r$/, '');
      if (text.trim() && /^(pending|in[- ]?progress|done|complete|completed)/i.test(text.trim()) && !/\]\(/.test(text)) {
        if (normalizeStatus(text) === 'in-progress') return line;
        cells[i] = ` ${label}${cells[i].endsWith('\r') ? '\r' : ''} `;
        changed = true;
        return cells.join('|');
      }
    }
    return line;
  });
  if (changed) fs.writeFileSync(planFile, out.join('\n'));
  return changed;
}

/** @param {string} planDir @param {string} phaseFile absolute path inside planDir */
function markPhaseInProgress(planDir, phaseFile) {
  const text = fs.readFileSync(phaseFile, 'utf8');
  try { fs.writeFileSync(phaseFile, setFrontmatterScalar(text, 'status', 'in-progress')); } catch { /* no frontmatter: table only */ }
  return setTableStatus(path.join(planDir, 'plan.md'), path.basename(phaseFile), 'In Progress');
}

module.exports = { markPhaseInProgress, setTableStatus };
