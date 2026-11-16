const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');
const DASHBOARD_OUTPUT_KPIS = require('../src/data/dashboardOutputs');

test('dashboard KPI definitions preserve all supplied targets', () => {
  const targets = Object.fromEntries(DASHBOARD_OUTPUT_KPIS.map((kpi) => [kpi.name, kpi.target]));
  assert.deepEqual(targets, {
    'Contracts Signed': 7,
    'Contracts Evaluated': 20,
    'Client Satisfaction Survey': 86,
    'Employee Satisfaction Level': 63,
    'Change of revenue generated in commercialization': 3,
    '% of Rural Based Innovation Projects': 33,
    '% of Rural Based Start ups': 33,
    'New Academic programmes developed': 28,
    'Risk Mitigation Strategies Implemented': 3,
    'Disposal of idle Assets': 100,
    'Strategic Plan Reviewed': 1,
    'Annual General Meeting Conducted': 1,
    'Audited Financial Statements': 3,
  });
});

test('all dashboard output KPIs are seeded with their targets and owners', async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const api = client(server.baseUrl);
  const { token } = await api.login('gorerazas@zou.ac.zw');
  const [kpiResponse, orgResponse] = await Promise.all([
    api.request('/api/kpis', { token }),
    api.request('/api/org', { token }),
  ]);
  assert.equal(kpiResponse.status, 200);
  assert.equal(orgResponse.status, 200);

  const unitsByName = new Map(orgResponse.body.units.map((unit) => [unit.name, unit.id]));
  for (const expected of DASHBOARD_OUTPUT_KPIS) {
    const matches = kpiResponse.body.kpis.filter((kpi) => kpi.name === expected.name);
    assert.equal(matches.length, 1, `expected exactly one "${expected.name}" KPI`);
    assert.equal(matches[0].owner_type, 'unit');
    assert.equal(matches[0].owner_id, unitsByName.get(expected.ownerName));
    assert.equal(matches[0].target, expected.target);
    assert.equal(matches[0].measure, expected.measure);
    assert.equal(matches[0].type, expected.type);
  }
});
