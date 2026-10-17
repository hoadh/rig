'use strict';
/**
 * dispatch input refusals that the success criteria require but no other test
 * pins: a remote phase without `owns:` (or with an empty one) and a phase with
 * no `machine:` must exit 2 before any worker is contacted.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./minimal-test-harness.cjs');
const { makeRepoWithBareRemote } = require('./temp-git-repo-with-bare-remote.cjs');

const SLUG = 'plan-owns';
const dispatch = () => require('../commands/dispatch-command.cjs');

/** Clone with a pushed plan branch, a registry with machine waso, and a plan dir holding one phase file body. */
function setup(phaseFrontmatter) {
  const env = makeRepoWithBareRemote({ clones: ['main'] });
  const repo = env.clone('main');
  env.git(repo, 'push', '-q', 'origin', 'main');
  const reg = path.join(env.root, 'machines.json');
  fs.writeFileSync(reg, JSON.stringify({ machines: { waso: { ssh: 'u@waso', os: 'linux', shell: 'bash', repo: '/home/u/rig', pathPrepend: [] } } }));
  Object.assign(process.env, { RIG_MACHINES_FILE: reg, RIG_MACHINE: 'mac' });
  const plan = path.join(env.root, 'plans', SLUG);
  fs.mkdirSync(plan, { recursive: true });
  fs.writeFileSync(path.join(plan, 'plan.md'), '---\ntitle: x\nbranch: main\n---\n| Phase | Name | Status |\n|---|---|---|\n| 1 | [Build](./phase-01-build.md) | Pending |\n');
  fs.writeFileSync(path.join(plan, 'phase-01-build.md'), `---\n${phaseFrontmatter}---\n# Build\nDo it.\n`);
  process.chdir(repo);
  return { env, plan };
}

/** Client that fails the test if anything reaches the worker. */
const forbiddenClient = () => {
  const boom = async () => { throw new Error('worker must not be contacted'); };
  return { fetchRunList: boom, startRun: boom, fetchRunStatus: boom, waitForRun: boom };
};
const ctx = { self: 'mac', client: forbiddenClient(), ensureCompatible: async () => ({}) };

const refused = (plan) => t.rejectsRemote(dispatch().run([plan, 'phase-01-build.md'], ctx), { exitCode: 2 });

t.test('remote phase without owns: refused with exit 2', async () => {
  const { env, plan } = setup('machine: waso\n');
  try {
    const e = await refused(plan);
    t.ok(/owns/.test(e.message), `message should name owns: ${e.message}`);
  } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});

t.test('remote phase with empty owns: [] refused with exit 2', async () => {
  const { env, plan } = setup('machine: waso\nowns: []\n');
  try { await refused(plan); } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});

t.test('phase without machine: refused with exit 2 (run locally hint)', async () => {
  const { env, plan } = setup('owns: [src/**]\n');
  try {
    const e = await refused(plan);
    t.ok(/run it locally/.test(e.message), `message should suggest local run: ${e.message}`);
  } finally { process.chdir(os.tmpdir()); env.cleanup(); }
});

t.done();
