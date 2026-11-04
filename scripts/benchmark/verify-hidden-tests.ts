/**
 * Verifies every task's hidden tests: they must FAIL on the untouched fixture (+ setup overlay)
 * and PASS once hidden-tests/<task>/reference.patch is applied. Also checks the visible suite
 * is green with the reference patch applied.
 *
 *   node scripts/benchmark/verify-hidden-tests.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyHiddenTests, HIDDEN_SUBDIR, loadTasks, patchPath, prepareWorkspace, runNodeTests } from './benchmark-workspace.ts';

let failures = 0;
const tmp = mkdtempSync(path.join(tmpdir(), 'bench-verify-'));

for (const task of loadTasks()) {
  const base = path.join(tmp, `t${task.id}-base`);
  prepareWorkspace(base, task);
  copyHiddenTests(base, task);
  const before = runNodeTests(base, HIDDEN_SUBDIR);

  const solved = path.join(tmp, `t${task.id}-ref`);
  prepareWorkspace(solved, task);
  const apply = spawnSync('git', ['apply', '--whitespace=nowarn', patchPath(task)], { cwd: solved, encoding: 'utf8' });
  if (apply.status !== 0) console.error(`task ${task.id}: git apply failed: ${apply.stderr}`);
  const visible = runNodeTests(solved, 'test/**/*.test.ts');
  copyHiddenTests(solved, task);
  const after = runNodeTests(solved, HIDDEN_SUBDIR);

  const okBefore = !before.ok && before.fail > 0;
  const okAfter = apply.status === 0 && after.ok;
  const okVisible = visible.ok;
  if (!(okBefore && okAfter && okVisible)) failures++;
  console.log(
    `task ${task.id} ${task.kind.padEnd(8)} untouched: ${okBefore ? 'FAIL (good)' : 'PASS/ERROR (bad)'} ` +
      `[${before.pass} pass/${before.fail} fail]  reference: ${okAfter ? 'PASS (good)' : 'FAIL (bad)'} ` +
      `[${after.pass} pass/${after.fail} fail]  visible suite w/ reference: ${okVisible ? 'ok' : 'BAD'}`,
  );
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll hidden tests verified.' : `\n${failures} task(s) failed verification.`);
process.exit(failures === 0 ? 0 : 1);
