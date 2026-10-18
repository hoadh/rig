'use strict';
/**
 * doctor [machine...] [--json]: read-only health check, machines in parallel.
 * Order per machine: raw bootstrap probe -> info (protocol) -> facts -> detached
 * push probe -> pure checks. Exit 0 when no check failed, else 1. An unreachable
 * host yields one fail line, never a stack trace.
 */
const { EXIT, usageError } = require('../lib/remote-errors.cjs');
const { parseFlags } = require('../lib/cli-flag-parser.cjs');
const V = require('../lib/identifier-validators.cjs');
const { loadRegistry, getMachine } = require('../lib/machine-registry.cjs');
const { PROTOCOL_VERSION } = require('../lib/rig-json-nonce-framing.cjs');
const { scriptsIntegrityHash } = require('../lib/skill-scripts-integrity-hash.cjs');
const { git } = require('../lib/rig-local-worktree.cjs');
const { newRunId } = require('../lib/run-directory.cjs');
const { bootstrapProbe } = require('../lib/doctor-bootstrap-probe.cjs');
const { evaluateMachine, withFixHints, hasFailure } = require('../lib/doctor-checks.cjs');
const { readRigVersion } = require('../worker-commands/info-command.cjs');

const PUSH_PROBE_MAX_MS = 60_000;
// Windows scheduled tasks (headless S4U time trigger) start ~60-65s after registration by design.
const PUSH_PROBE_MAX_MS_WINDOWS = 150_000;

/** Detached push dry-run: proves the credentials a launched run will have. */
async function pushProbe(client, name, sha, os) {
  if (!sha) return { ok: false, detail: 'orchestrator repo has no origin/HEAD to probe with' };
  const spec = { v: 1, runId: newRunId(), orchestrator: process.env.RIG_MACHINE || 'doctor', slug: null, phase: null, kind: 'command', ref: sha, timeoutSec: 50,
    command: `git push --dry-run origin ${sha}:refs/heads/rig/${name}/doctor-probe` };
  const { runId } = await client.startRun(name, spec, '');
  const st = await client.waitForRun(name, runId, { maxMs: os === 'windows' ? PUSH_PROBE_MAX_MS_WINDOWS : PUSH_PROBE_MAX_MS, pollMs: 1000 });
  return st.state === 'done' && st.exit === 0 ? { ok: true, detail: '' } : { ok: false, detail: `${st.state}${st.failure ? `:${st.failure}` : ''} exit=${st.exit}: ${String(st.logTail || '').slice(-160)}` };
}

async function checkMachine(name, orch, client) {
  const cfg = getMachine(name);
  const input = { name, cfg, boot: null, info: null, facts: null, push: null, orch };
  try {
    input.boot = await bootstrapProbe(name, cfg);
    if ([input.boot.ssh, input.boot.node, input.boot.claude].every((p) => p.ok)) {
      input.info = (await client.execWorker(name, 'info')).reply;
      input.facts = (await client.execWorker(name, 'facts', [], { payload: { target: client.workerTarget(name) } })).reply;
      if (input.facts.error) throw new Error(input.facts.error.message);
      input.push = await pushProbe(client, name, orch.headSha, cfg.os).catch((e) => ({ ok: false, detail: e.message }));
    }
    return { machine: name, checks: evaluateMachine(input) };
  } catch (e) {
    const reach = { id: 'reach', status: 'fail', msg: String(e.message).split('\n')[0].slice(0, 300) };
    return { machine: name, checks: [...(input.boot ? evaluateMachine({ ...input, info: null }) : []), ...withFixHints([reach], input)] };
  }
}

async function run(argv, ctx = {}) {
  const { flags, positional } = parseFlags(argv, { '--json': 'bool' });
  const reg = loadRegistry();
  const names = positional.length ? positional.map((n) => V.assertMachineName(n, 'machine')) : Object.keys(reg.machines);
  if (!names.length) throw usageError('no machines in registry', 'add one with `remote.cjs register <id> --ssh user@host --os linux --repo /abs/clone`');
  const client = ctx.client || { ...require('../lib/orchestrator-run-client.cjs'), ...require('../lib/ssh-transport.cjs') };
  const head = git(process.cwd(), ['ls-remote', 'origin', 'HEAD'], { timeoutMs: 30000 });
  const origin = git(process.cwd(), ['remote', 'get-url', 'origin']);
  const orch = { protocol: PROTOCOL_VERSION, rigVersion: readRigVersion(), hash: scriptsIntegrityHash(),
    originUrl: origin.status === 0 ? String(origin.stdout).trim() : '', headSha: head.status === 0 ? String(head.stdout).split(/\s+/)[0] : null };
  const results = await Promise.all(names.map((n) => checkMachine(n, orch, client)));
  const failed = results.some((r) => hasFailure(r.checks));
  if (flags.json) process.stdout.write(`${JSON.stringify({ ok: !failed, machines: results })}\n`);
  else {
    for (const r of results) {
      process.stdout.write(`${r.machine}\n`);
      for (const c of r.checks) {
        process.stdout.write(`  ${c.status.toUpperCase().padEnd(4)} ${c.id.padEnd(16)} ${c.msg}\n`);
        if (c.fix) process.stdout.write(`       fix: ${c.fix}\n`);
      }
    }
    process.stdout.write(failed ? 'doctor: FAIL\n' : 'doctor: ok\n');
  }
  return failed ? EXIT.ERROR : EXIT.OK;
}

module.exports = { run, pushProbe };
