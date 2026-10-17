'use strict';
const t = require('./minimal-test-harness.cjs');
const { filterInflight, scanInflightRuns } = require('../lib/takeover-run-scanner.cjs');

const run = (o) => ({ runId: 'r-12345678', orchestrator: 'mac', slug: 's', phase: '01', state: 'running', ...o });

t.test('filterInflight keeps only old orchestrator + slug + live states', () => {
  const runs = [run({}), run({ state: 'starting' }), run({ state: 'cancelling' }), run({ state: 'done' }), run({ state: 'lost' }),
    run({ orchestrator: 'other' }), run({ slug: 'z' }), null];
  t.eq(filterInflight(runs, 'mac', 's').map((r) => r.state), ['running', 'starting', 'cancelling']);
  t.eq(filterInflight(undefined, 'mac', 's'), []);
});

t.test('scan aggregates per machine; failures become unknown', async () => {
  const replies = { waso: { runs: [run({ runId: 'r-aaaaaaaa' })] }, linux: { runs: [run({ state: 'done' })] } };
  const res = await scanInflightRuns({
    machines: ['waso', 'linux', 'down'], slug: 's', oldOrchestrator: 'mac',
    listRuns: async (m) => { if (m === 'down') throw new Error('ssh timeout\nmore'); return replies[m]; },
  });
  t.eq(res.inflight, [{ machine: 'waso', runId: 'r-aaaaaaaa', state: 'running', phase: '01' }]);
  t.eq(res.unknown, [{ machine: 'down', reason: 'ssh timeout' }]);
});

t.done();
