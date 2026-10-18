'use strict';
/**
 * Origin URL -> comparable project key. Shared by doctor (worker clone vs orchestrator origin),
 * the clone bootstrapper and the registry `repos` map (one clone per project per machine).
 */
const { stripUrlCredentials } = require('./secret-redaction.cjs');

/** https://host/x.git, git@host:x, ssh://git@host/x -> host/x (creds stripped, .git dropped). */
function normalizeOrigin(url) {
  const u = stripUrlCredentials(String(url || '')).trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(u);
  const body = scp ? `${scp[1]}/${scp[2]}` : u.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '');
  return body.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
}

module.exports = { normalizeOrigin };
