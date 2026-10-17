'use strict';
/**
 * remote.cjs takeover <plan-dir> [--force]
 * Move the orchestrator role of a plan to this machine: validate the remote
 * coord tree, restore it into the plan dir, claim `orchestrator: <self>`, push
 * (fast-forward only), then list in-flight runs of the previous orchestrator.
 */
const fs = require('fs');
const path = require('path');
const { RemoteError, EXIT, usageError } = require('../lib/remote-errors.cjs');
const V = require('../lib/identifier-validators.cjs');
const { parseFrontmatter, setFrontmatterScalar } = require('../lib/plan-frontmatter.cjs');
const { coordBranch } = require('../lib/rig-branch-and-path-names.cjs');
const { ensureLocalWorktree, gitOrThrow } = require('../lib/rig-local-worktree.cjs');
const sync = require('../lib/coord-branch-sync.cjs');
const { readCoordTree, writeRestoredFiles } = require('../lib/coord-plan-restore.cjs');
const { slugOf } = require('../lib/orchestrator-lock.cjs');
const { scanInflightRuns } = require('../lib/takeover-run-scanner.cjs');

const out = (s) => process.stdout.write(`${s}\n`);

function parseArgs(argv) {
  const force = argv.includes('--force');
  const rest = argv.filter((a) => a !== '--force');
  if (rest.length !== 1 || rest[0].startsWith('-')) throw usageError('usage: takeover <plan-dir> [--force]');
  return { planDir: path.resolve(rest[0]), force };
}

/** Files that differ between the local plan dir (filtered+redacted view) and the coord tree. */
function diffAgainstCoord(planDir, coordFiles) {
  if (!fs.existsSync(planDir)) return [];
  const local = sync.collectMirrorFiles(planDir).files;
  const names = new Set([...local.keys(), ...coordFiles.keys()]);
  return [...names].sort().filter((n) => !(local.has(n) && coordFiles.has(n) && local.get(n).equals(coordFiles.get(n))));
}

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/** Scan all registry machines for the old orchestrator's live runs; never fatal. */
async function reportInflight(slug, oldOrch, planDir) {
  let machines;
  try {
    const { loadRegistry } = require('../lib/machine-registry.cjs');
    machines = Object.keys(loadRegistry().machines);
  } catch (e) {
    out(`warning: cannot scan workers for in-flight runs of ${oldOrch}: ${e.message}`);
    return;
  }
  const { execWorker } = require('../lib/ssh-transport.cjs');
  const { inflight, unknown } = await scanInflightRuns({
    machines, slug, oldOrchestrator: oldOrch,
    listRuns: async (m) => {
      const res = await execWorker(m, 'list', ['--slug', slug]);
      if (res.code !== 0) throw new Error(`worker list exit ${res.code}`);
      return res.reply;
    },
  });
  for (const r of inflight) out(`in-flight: ${r.machine} run ${r.runId} phase ${r.phase === null ? '-' : r.phase} ${r.state}`);
  for (const u of unknown) out(`unknown: ${u.machine} unreachable (${u.reason})`);
  if (inflight.length) out(`hint: wait for them with: status ${planDir} --wait`);
}

async function run(argv, ctx) {
  const self = V.assertMachineName(ctx.self, 'self machine id');
  const { planDir, force } = parseArgs(argv);
  const slug = slugOf(planDir);
  const repo = gitOrThrow(process.cwd(), ['rev-parse', '--show-toplevel']);

  const state = sync.remoteCoordState(repo, slug); // error -> exit 3
  if (state.state === 'missing') throw new RemoteError(`nothing to take over: ${coordBranch(slug)} does not exist on the remote`, EXIT.ERROR, { class: 'no-coord' });
  sync.fetchCoord(repo, slug);
  const ref = sync.coordRemoteRef(slug);
  const files = readCoordTree(repo, ref); // validated; nothing written yet
  const oldOrch = parseFrontmatter(files.get('plan.md').toString('utf8')).orchestrator || '';
  if (oldOrch === self) { out(`${self} is already the orchestrator of ${slug}`); return EXIT.OK; }

  const differing = diffAgainstCoord(planDir, files);
  if (differing.length && !force) {
    throw new RemoteError(`local plan dir differs from coord (${differing.length} files): ${differing.slice(0, 10).join(', ')}`, EXIT.ERROR, {
      class: 'local-differs', hint: '--force moves the local dir to <dir>.bak-<yymmdd-hhmm> and restores coord',
    });
  }
  if (differing.length) {
    const bak = `${planDir}.bak-${stamp()}`;
    fs.renameSync(planDir, bak);
    out(`moved local plan dir to ${bak}`);
  }

  // Coord worktree on the remote tip (local mirror commits are disposable snapshots).
  const { dir } = ensureLocalWorktree(repo, sync.coordDirName(slug), coordBranch(slug), { remoteRef: ref });
  gitOrThrow(dir, ['reset', '-q', '--hard', ref]);

  writeRestoredFiles(planDir, files);
  const planFile = path.join(planDir, 'plan.md');
  fs.writeFileSync(planFile, setFrontmatterScalar(fs.readFileSync(planFile, 'utf8'), 'orchestrator', self));
  const m = sync.mirrorPlanToCoord(planDir, dir, { slug, self });
  sync.pushCoord(dir, slug); // plain push: non-ff -> exit 3
  for (const w of m.warnings) out(`warning: ${w}`);
  for (const r of m.redactions) out(`warning: redacted ${r.hits.map((h) => `${h.name} x${h.count}`).join(', ')} in ${r.file}`);
  out(`took over ${slug} from ${oldOrch || '(unset)'}; orchestrator is now ${self}`);

  if (oldOrch) await reportInflight(slug, oldOrch, planDir);
  return EXIT.OK;
}

module.exports = { run, diffAgainstCoord };
