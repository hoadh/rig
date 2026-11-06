'use strict';
/** Test helper (phase 04): build a plan dir with frontmatter plan.md + phase files + excluded noise. */
const fs = require('fs');
const path = require('path');

function writePlan(baseDir, slug, { orchestrator = '', extra = {} } = {}) {
  const dir = path.join(baseDir, slug);
  const put = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  put('plan.md', `---\ntitle: demo\norchestrator: ${orchestrator}\n---\n# Plan\r\nline with CRLF\r\n`);
  put('phase-01-setup.md', '---\nmachine: waso\nowns: [src/**, docs/*.md]\n---\nbody\n');
  put('reports/secret-report.md', 'report body\n');
  put('visuals/a.html', '<html/>\n');
  put('run.log', 'log\n');
  put('.hidden', 'x\n');
  for (const [rel, c] of Object.entries(extra)) put(rel, c);
  return dir;
}

module.exports = { writePlan };
