'use strict';
/**
 * Pure doctor evaluation: probe results in, [{id, status: ok|warn|fail, msg}] out.
 * No I/O here so every rule is unit-testable.
 * input: {name, cfg, boot:{ssh:{ok,detail}, node:{ok,detail}, claude:{ok,detail}}|null,
 *         info, facts, push:{ok,detail}|null, orch:{protocol, rigVersion, hash, originUrl}}
 * Every non-ok check carries `fix` (one concrete next step, see doctor-fix-hints) when one is known.
 */
const { stripUrlCredentials } = require('./secret-redaction.cjs');
const { fixHint } = require('./doctor-fix-hints.cjs');

const ok = (id, msg) => ({ id, status: 'ok', msg });
const warn = (id, msg) => ({ id, status: 'warn', msg });
const fail = (id, msg) => ({ id, status: 'fail', msg });

/** https://host/x.git, git@host:x, ssh://git@host/x -> host/x (creds stripped, .git dropped). */
function normalizeOrigin(url) {
  const u = stripUrlCredentials(String(url || '')).trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(u);
  const body = scp ? `${scp[1]}/${scp[2]}` : u.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '');
  return body.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
}

const result = (id, p, okMsg) => (p && p.ok ? ok(id, okMsg ? `${okMsg} ${p.detail || ''}`.trim() : p.detail || 'ok') : fail(id, (p && p.detail) || 'not checked'));

function bootstrapChecks({ boot }) {
  if (!boot) return [];
  return [result('ssh', boot.ssh, 'reachable'), result('node', boot.node), result('claude', boot.claude)];
}

function workerChecks({ name, cfg, info, facts, push, orch }) {
  const out = [];
  if (info.protocol !== orch.protocol) out.push(fail('protocol', `worker protocol ${info.protocol} != ${orch.protocol}`));
  else out.push(ok('protocol', `protocol ${info.protocol}`));
  const a = facts.claude.auth;
  if (!a.loggedIn) out.push(fail('auth', `claude not logged in: ${a.detail || ''}`.trim()));
  else if (facts.platform === 'darwin' && !facts.claude.tokenInEnv) out.push(warn('auth', 'macOS keychain login may be unavailable over ssh/detached; set CLAUDE_CODE_OAUTH_TOKEN'));
  else out.push(ok('auth', 'claude logged in'));
  const id = facts.repo.identity || {};
  out.push(id.name && id.email ? ok('git-identity', `${id.name} <${id.email}>`) : fail('git-identity', 'git user.name/user.email not set in worker clone'));
  out.push(push ? result('push-detached', push, 'dry-run push from detached run') : warn('push-detached', 'push probe skipped'));
  out.push(repoCheck(facts.repo, orch.originUrl));
  if (facts.repo.isGit) out.push(baselineCheck(facts.repo));
  if (cfg.os === 'windows' && cfg.taskMode !== 'interactive' && /^https?:/i.test(String(facts.repo.originUrl || ''))) {
    out.push(warn('headless-https', 'headless (default) tasks may lack Credential Manager creds for an https origin; use an ssh key remote (taskMode: interactive is only needed for GUI work)'));
  }
  out.push(versionCheck(info.rigVersion, orch.rigVersion, facts.integrityHash, orch.hash));
  const gb = facts.diskFreeGiB;
  out.push(gb === null ? warn('disk', 'free disk unknown') : gb < 2 ? fail('disk', `${gb} GiB free`) : gb < 10 ? warn('disk', `${gb} GiB free`) : ok('disk', `${gb} GiB free`));
  const stale = [...facts.runs.staleRunners, ...facts.runs.lost];
  out.push(stale.length || facts.runs.old ? warn('stale', `stale runners/lost runs: ${stale.join(', ') || 'none'}; ${facts.runs.old} runs older than 14d`) : ok('stale', 'no stale runners or runs'));
  out.push(facts.sharesConsoleUser ? warn('interactive-user', `agent runs as the interactive user on ${name}; a dedicated user is safer`) : ok('interactive-user', 'not the console user'));
  return out;
}

function repoCheck(repo, orchOrigin) {
  if (!repo.exists || !repo.isGit) return fail('repo', 'worker repo missing or not a git repo');
  if (normalizeOrigin(repo.originUrl) !== normalizeOrigin(orchOrigin)) return fail('repo', `origin mismatch: worker ${stripUrlCredentials(repo.originUrl || '(none)')} vs ${stripUrlCredentials(orchOrigin || '(none)')}`);
  return repo.clean === false ? warn('repo', 'worker clone has uncommitted changes (next run resets it)') : ok('repo', 'clone ok, origin matches');
}

/** Known-good git baseline of the clone: without it every run fails `failed:prepare`. */
function baselineCheck(repo) {
  if (repo.quarantined) return fail('baseline', 'clone is quarantined (git config/hooks were tampered with)');
  switch (repo.baseline) {
    case 'match': return ok('baseline', 'known-good git baseline matches');
    case 'missing': return fail('baseline', 'no known-good git baseline recorded (runs fail failed:prepare)');
    case 'mismatch': return fail('baseline', 'git config/hooks/info differ from the baseline (runs fail hooks-tampered)');
    case undefined: return warn('baseline', 'not reported (worker Rig is older)');
    default: return warn('baseline', `could not verify: ${repo.baseline}`);
  }
}

function versionCheck(wVer, oVer, wHash, oHash) {
  if (wVer !== oVer) return warn('rig-version', `version drift: worker ${wVer} vs ${oVer}`);
  return wHash === oHash ? ok('rig-version', `${wVer}, scripts identical`) : fail('rig-version', `same version ${wVer} but scripts differ (tampered or half-updated install)`);
}

/** @returns {Array<{id,status,msg}>} */
function evaluateMachine(input) {
  const boot = bootstrapChecks(input);
  const checks = boot.some((c) => c.status === 'fail') || !input.info || !input.facts ? boot : [...boot, ...workerChecks(input)];
  return withFixHints(checks, input);
}

/** Attach `fix` to non-ok checks (also used for doctor's catch-all `reach` line). */
function withFixHints(checks, { name, cfg }) {
  return checks.map((c) => {
    const fix = cfg ? fixHint(c, { name, cfg }) : null;
    return fix ? { ...c, fix } : c;
  });
}

const hasFailure = (checks) => checks.some((c) => c.status === 'fail');

module.exports = { evaluateMachine, withFixHints, normalizeOrigin, hasFailure };
