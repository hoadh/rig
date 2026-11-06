/**
 * Arm isolation: per-run temp CLAUDE_CONFIG_DIR holding only the credential file, plus
 * (for the rig arm) a project install of Rig from THIS repo checkout.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Arm } from './benchmark-types.ts';
import { BENCH_DIR } from './benchmark-workspace.ts';

const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');
const CREDENTIALS = '.credentials.json';
const GIT_IDENT = ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid'];

/** Env vars that would leak the operator's Claude setup into a run. */
const STRIPPED_ENV = ['CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];

export interface ConfigDirInfo {
  dir: string;
  authMode: 'api-key' | 'credentials-file';
}

/**
 * Creates the isolated config dir. Auth: ANTHROPIC_API_KEY (from env) if set, otherwise only the
 * OAuth credential file is copied. Throws when neither exists, with the command the user should run.
 */
export function createIsolatedConfigDir(baseDir: string): ConfigDirInfo {
  const dir = path.join(baseDir, 'claude-config');
  mkdirSync(dir, { recursive: true });
  if (process.env.ANTHROPIC_API_KEY) return { dir, authMode: 'api-key' };
  const source = path.join(os.homedir(), '.claude', CREDENTIALS);
  if (!existsSync(source)) {
    throw new Error(`No auth available for isolated runs. Run \`claude /login\` (creates ${source}) or export ANTHROPIC_API_KEY.`);
  }
  copyFileSync(source, path.join(dir, CREDENTIALS));
  return { dir, authMode: 'credentials-file' };
}

/** Throws unless the config dir is a throwaway dir outside ~/.claude containing at most the credentials file. */
export function assertIsolation(configDir: string, workspace: string, arm: Arm): void {
  const real = realpathSync(configDir);
  const globalDir = path.join(os.homedir(), '.claude');
  if (real === globalDir || real.startsWith(globalDir + path.sep) || (existsSync(globalDir) && real === realpathSync(globalDir))) {
    throw new Error(`Isolation failure: config dir ${real} is the global ~/.claude`);
  }
  const extra = readdirSync(configDir).filter((n) => n !== CREDENTIALS);
  if (extra.length > 0) throw new Error(`Isolation failure: config dir not clean before run: ${extra.join(', ')}`);
  const hasRigFiles = existsSync(path.join(workspace, '.claude')) || existsSync(path.join(workspace, 'CLAUDE.md'));
  if (arm === 'vanilla' && hasRigFiles) throw new Error('Isolation failure: vanilla workspace contains .claude/ or CLAUDE.md');
  if (arm === 'rig' && !existsSync(path.join(RIG_PLUGIN_DIR, '.claude-plugin', 'plugin.json'))) {
    throw new Error(`Rig arm: no plugin at ${RIG_PLUGIN_DIR}`);
  }
}

/** Environment for the claude child process: operator's env minus Claude session vars, plus the temp config dir. */
export function buildChildEnv(configDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  for (const name of STRIPPED_ENV) if (name !== 'CLAUDE_CONFIG_DIR') delete env[name];
  return env;
}

/** The Rig plugin of THIS checkout; the rig arm loads it with `--plugin-dir` (the 1.x file installer is retired). */
export const RIG_PLUGIN_DIR = path.join(REPO_ROOT, 'plugins', 'rig');

/** CLI args that enable Rig for one run: the plugin from this checkout, nothing is installed into the workspace. */
export function rigPluginArgs(): string[] {
  return ['--plugin-dir', RIG_PLUGIN_DIR];
}

/** Records the post-setup state as the baseline commit so later diffs show only the agent's work. */
export function commitBaseline(workspace: string): void {
  for (const args of [['init', '-q'], ['add', '-A'], [...GIT_IDENT, 'commit', '-q', '-m', 'baseline']]) {
    const res = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
}
