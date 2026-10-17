'use strict';
/**
 * review <plan-dir> <phase-file> --sha <40hex> [--score 0..10]
 * Records the orchestrator's review verdict (reviewedSha/reviewScore) in the
 * phase frontmatter, then mirrors the plan to the coord branch. Local file
 * edit + coord sync only; no worker is contacted.
 * Exit: 0 recorded | 2 usage | 3 lock (not the orchestrator).
 */
const path = require('path');
const { EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { gitOrThrow } = require('../lib/rig-local-worktree.cjs');
const { assertOrchestrator, syncCoord } = require('../lib/orchestrator-lock.cjs');
const { buildPhaseMap } = require('../lib/plan-phase-machine-map.cjs');
const { recordReview } = require('../lib/plan-phase-review-recorder.cjs');

const USAGE = 'usage: review <plan-dir> <phase-file> --sha <40hex> [--score 0..10]';

async function run(argv, ctx) {
  const self = V.assertMachineName(ctx.self, 'self machine id');
  const { flags, positional } = parseFlags(argv, { '--sha': 'value', '--score': 'value' });
  if (positional.length !== 2 || !flags.sha) throw usageError(USAGE);
  const planDir = path.resolve(positional[0]);
  const candidates = [path.resolve(positional[1]), path.resolve(planDir, positional[1])];
  const entry = buildPhaseMap(planDir).find((e) => candidates.includes(e.file));
  if (!entry) throw usageError(`${positional[1]} is not a phase of ${planDir}/plan.md`);
  const repo = gitOrThrow(process.cwd(), ['rev-parse', '--show-toplevel']);
  assertOrchestrator(repo, planDir, self); // only the lock holder may record reviews (exit 3)
  const r = recordReview(entry.file, { sha: flags.sha, score: flags.score ?? null });
  syncCoord(repo, planDir, self);
  process.stdout.write(`phase ${entry.phase}: reviewedSha=${r.sha.slice(0, 8)}${r.score === null ? '' : ` reviewScore=${r.score}`}\n`);
  return EXIT.OK;
}

module.exports = { run };
