'use strict';
/**
 * worker `baseline --repo <path>` (or payload {target:{repo}}): record the clone's
 * CURRENT git config/hooks/info hash as the known-good baseline (stored under ~/.rig,
 * outside the clone). Run it once on a freshly made, inspected dedicated clone, or after a
 * reviewed re-clone. Refuses a quarantined clone and a non-git path. Prepare fails closed
 * (failed:prepare) until a baseline exists.
 */
const { usageError } = require('../lib/remote-errors.cjs');
const { tryGit } = require('../lib/safe-git-runner.cjs');
const { isQuarantined } = require('../lib/git-control-files-integrity.cjs');
const { writeKnownGoodBaseline, baselinePath } = require('../lib/hardened-git-config-env.cjs');

function repoFrom(argv, payload) {
  const i = argv.indexOf('--repo');
  const repo = i >= 0 ? argv[i + 1] : payload && payload.target && payload.target.repo;
  if (typeof repo !== 'string' || !repo || repo.startsWith('-')) throw usageError('baseline needs --repo <clone path> (or payload {target:{repo}})');
  return repo;
}

async function run(argv, ctx) {
  const repo = repoFrom(argv, ctx.payload);
  if (!tryGit(repo, ['rev-parse', '--git-dir']).ok) throw usageError(`${repo} is not a git clone`);
  if (isQuarantined(repo)) throw usageError(`${repo} is quarantined; inspect and re-clone before baselining`);
  const hash = writeKnownGoodBaseline(repo);
  ctx.reply({ repo, hash, file: baselinePath(repo) });
  return 0;
}

module.exports = { run };
