'use strict';
/**
 * One concrete next step per non-ok doctor check (pure: check + machine in, string|null out).
 * Things doctor/setup cannot do for the user (ssh keys, host keys, claude login, installing
 * Rig) become copy-paste commands. Never includes secrets: only registry values.
 */
const os = require('os');
const path = require('path');

/** How to invoke this orchestrator CLI, with $HOME shortened to ~. */
function remoteCli() {
  const abs = path.join(__dirname, '..', 'remote.cjs');
  const home = os.homedir();
  const shown = abs.startsWith(home + path.sep) ? `~${abs.slice(home.length)}` : abs;
  return `node ${/\s/.test(shown) ? JSON.stringify(shown) : shown}`;
}

const INSTALL_RIG = 'install the SAME Rig version globally on the worker: from a Rig checkout there run `node scripts/install-kit-from-local-repo.cjs --global`';

function sshHint(msg, ssh) {
  if (/Host key verification failed|HOST IDENTIFICATION HAS CHANGED|No .*host key is known/i.test(msg)) {
    return `run \`ssh ${ssh}\` once interactively, verify the fingerprint and accept it (Rig uses StrictHostKeyChecking=yes)`;
  }
  if (/Permission denied|publickey|Too many authentication failures/i.test(msg)) {
    return `install your public key: \`ssh-copy-id ${ssh}\` (Windows admin user: append it to C:\\ProgramData\\ssh\\administrators_authorized_keys); then \`ssh -o BatchMode=yes ${ssh} echo ok\` must print ok without a prompt`;
  }
  if (/Could not resolve|timed out|Connection refused|No route to host|Network is unreachable/i.test(msg)) {
    return `check the host/alias "${ssh}" (~/.ssh/config) and that sshd runs on the worker`;
  }
  return `\`ssh -o BatchMode=yes ${ssh} echo ok\` must succeed without any prompt`;
}

function exeHint(exe, cfg) {
  const find = cfg.os === 'windows' ? `ssh ${cfg.ssh} where.exe ${exe}` : `ssh -t ${cfg.ssh} "bash -lc 'command -v ${exe}'"`;
  const install = exe === 'claude' ? 'install Claude Code on the worker, or ' : '';
  return `${install}set "${exe}" in the registry to the absolute path printed by \`${find}\``;
}

/**
 * @param {{id:string, status:string, msg:string}} check
 * @param {{name:string, cfg:object}} m registry machine
 * @returns {string|null}
 */
function fixHint(check, { name, cfg }) {
  if (check.status === 'ok') return null;
  const R = remoteCli();
  const msg = String(check.msg || '');
  switch (check.id) {
    case 'ssh': return sshHint(msg, cfg.ssh);
    case 'node': return exeHint('node', cfg);
    case 'claude': return exeHint('claude', cfg);
    case 'reach':
      if (/command not found|not recognized/i.test(msg)) return INSTALL_RIG;
      if (/protocol/i.test(msg)) return INSTALL_RIG;
      return `rerun \`${R} doctor ${name}\`; if it persists check ssh and node on the worker`;
    case 'protocol':
    case 'rig-version': return INSTALL_RIG;
    case 'auth': return `log in as the worker user: \`ssh -t ${cfg.ssh} claude\` then /login; or create a token with \`claude setup-token\` and export CLAUDE_CODE_OAUTH_TOKEN in that user's environment (never in the registry)`;
    case 'git-identity': return `${R} setup ${name} --git-name "Rig ${name}" --git-email <email>   (sets it in the clone and re-records the baseline)`;
    case 'push-detached': return `give the worker user push access to origin for rig/${name}/* (ssh key or deploy key with write access; prefer an ssh origin url)`;
    case 'repo':
      if (/uncommitted/.test(msg)) return null; // informational: the next run resets the clone
      if (/origin mismatch/.test(msg)) return `the worker clone must use the orchestrator's origin: delete ${cfg.repo} on ${name}, then \`${R} setup ${name}\``;
      return `${R} setup ${name}   (creates the dedicated clone and records its baseline)`;
    case 'baseline':
      if (/quarantined/.test(msg)) return `inspect ${cfg.repo} on ${name}, delete it, then \`${R} setup ${name}\` to re-clone`;
      return `inspect ${cfg.repo}/.git on ${name}, then \`${R} setup ${name} --accept-existing-clone\` (or delete the clone and \`${R} setup ${name}\`)`;
    case 'headless-https': return 'switch origin to an ssh url (git@host:org/repo.git) on the orchestrator, then re-create the worker clone with setup';
    case 'disk': return `free disk space on ${name} (runs and clones live under the worker user's home)`;
    case 'interactive-user': return 'create a dedicated OS user for Rig on the worker (see docs/how-to/run-plan-across-machines.md, Threat model)';
    default: return null;
  }
}

module.exports = { fixHint, remoteCli, INSTALL_RIG };
