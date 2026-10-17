'use strict';
const t = require('./minimal-test-harness.cjs');
const B = require('../lib/remote-command-builder.cjs');

const REL = '.claude/skills/remote/scripts/worker.cjs';

t.test('plain node when no registry node', () => {
  t.eq(B.buildWorkerInvocation({ shell: 'bash' }, 'info'), `node ${REL} info`);
});
t.test('abs node path without spaces is emitted bare', () => {
  t.eq(B.buildWorkerInvocation({ shell: 'bash', node: '/home/u/.nvm/v24/bin/node' }, 'start', ['--x=1']),
    `/home/u/.nvm/v24/bin/node ${REL} start --x=1`);
});
t.test('windows node with spaces: cmd double-quoted, powershell call operator, bash single-quoted', () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  t.eq(B.buildWorkerInvocation({ shell: 'cmd', node }, 'info'), `"${node}" ${REL} info`);
  t.eq(B.buildWorkerInvocation({ shell: 'powershell', node }, 'info'), `& "${node}" ${REL} info`);
  t.eq(B.buildWorkerInvocation({ shell: 'pwsh', node: 'C:\\n\\node.exe' }, 'info'), `& C:\\n\\node.exe ${REL} info`);
  t.eq(B.buildWorkerInvocation({ shell: 'bash', node: '/opt/my dir/node' }, 'info'), `'/opt/my dir/node' ${REL} info`);
});
t.test('invalid sub / args rejected (exit 2)', () => {
  for (const sub of ['Info', 'a b', 'x;y', '', '../x', 'a1']) t.throwsRemote(() => B.buildWorkerInvocation({ shell: 'bash' }, sub), { exitCode: 2 });
  for (const a of ['a b', 'x;rm', '$(id)', '`id`', 'a|b', 'a&b', '"x"', "'x'", '']) {
    t.throwsRemote(() => B.buildWorkerInvocation({ shell: 'bash' }, 'info', [a]), { exitCode: 2 });
  }
});
t.test('shell argv per shell', () => {
  t.eq(B.buildShellArgv('bash', 'echo hi'), ['sh', '-c', 'echo hi']);
  t.eq(B.buildShellArgv('cmd', 'dir'), ['cmd.exe', '/d', '/s', '/c', 'dir']);
  t.eq(B.buildShellArgv('pwsh', 'ls'), ['pwsh', '-NoProfile', '-NonInteractive', '-Command', "$ProgressPreference='SilentlyContinue'; ls"]);
  t.eq(B.buildShellArgv('powershell', 'ls')[0], 'powershell');
  t.throwsRemote(() => B.buildShellArgv('zsh', 'x'), { exitCode: 2 });
  t.throwsRemote(() => B.buildShellArgv('bash', ''), { exitCode: 2 });
});

t.test('M5: node paths that cannot be quoted for cmd/powershell are rejected with a hint', () => {
  for (const node of ['C:\\Program Files (x86)\\nodejs\\node.exe', 'C:\\a&b\\node.exe', 'C:\\a^b\\node.exe', 'C:\\a%b\\node.exe', 'C:\\a!b\\node.exe', 'C:\\a"b\\node.exe']) {
    for (const shell of ['cmd', 'powershell', 'pwsh']) {
      const e = t.throwsRemote(() => B.buildWorkerInvocation({ shell, node }, 'info'), { exitCode: 2 });
      void e;
    }
  }
  t.throwsRemote(() => B.quoteExecutable("/o/it's/node", 'bash'), { exitCode: 2 });
  t.eq(B.quoteExecutable('node', 'bash'), 'node');
  t.eq(B.quoteExecutable('node', 'pwsh'), '& node');
  t.eq(B.quoteExecutable('C:\\Program Files\\n\\claude.exe', 'cmd'), '"C:\\Program Files\\n\\claude.exe"');
});
t.test('M5: cmd commands with double quotes are rejected; others pass through unchanged', () => {
  t.throwsRemote(() => B.buildShellArgv('cmd', 'echo "hi there"'), { exitCode: 2 });
  t.eq(B.buildShellArgv('cmd', 'echo hi there & dir'), ['cmd.exe', '/d', '/s', '/c', 'echo hi there & dir']);
  t.eq(B.buildShellArgv('bash', 'echo "x"'), ['sh', '-c', 'echo "x"']);
  t.eq(B.buildShellArgv('pwsh', 'echo "x"')[4], "$ProgressPreference='SilentlyContinue'; echo \"x\"");
});

t.done();
