const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server;
let api;
before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => { await server.stop(); });

test('target performance endpoint returns scoped hierarchy and validates its period', async () => {
  const { token: ictadmin } = await api.login('l.chikomo@zou.ac.zw');
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw');
  const year = new Date().getFullYear();

  const [allKpis, institution, unitScope, invalidPeriod] = await Promise.all([
    api.request('/api/kpis', { token: ictadmin }),
    api.request(`/api/kpis/performance-target?cycleYear=${year}&periodType=monthly&periodIndex=1`, { token: ictadmin }),
    api.request(`/api/kpis/performance-target?cycleYear=${year}&periodType=monthly&periodIndex=1`, { token: unitHead }),
    api.request(`/api/kpis/performance-target?cycleYear=${year}&periodType=monthly&periodIndex=13`, { token: ictadmin }),
  ]);

  assert.equal(institution.status, 200);
  assert.equal(institution.body.summaryName, 'University-wide');
  assert.equal(institution.body.summary.totalKpis, allKpis.body.kpis.length);
  assert.ok(institution.body.nodes.some((node) => node.kind === 'programme'));
  assert.ok(institution.body.tiers.every((tier) => Number.isFinite(tier.totalKpis)));

  const unitKpis = await api.request('/api/kpis', { token: unitHead });
  assert.equal(unitScope.status, 200);
  assert.equal(unitScope.body.summary.totalKpis, unitKpis.body.kpis.length);
  assert.ok(unitScope.body.unitOptions.some((node) => node.key === 'unit:1'));
  assert.ok(unitScope.body.unitOptions.every((node) => node.kind === 'unit' ? node.id === 1 : node.kind === 'employee'));
  assert.equal(invalidPeriod.status, 400);
});

test('KPI direction and positive weight can be configured at creation', async () => {
  const { token } = await api.login('l.chikomo@zou.ac.zw');
  const created = await api.request('/api/kpis', {
    token,
    method: 'POST',
    body: {
      ownerType: 'sub',
      ownerId: 1,
      name: 'Target metric test',
      type: 'Outcome',
      measure: 'days',
      baseline: 30,
      target: 10,
      measurementDirection: 'lower',
      weight: 2.5,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.kpi.measurement_direction, 'lower');
  assert.equal(Number(created.body.kpi.weight), 2.5);

  const invalid = await api.request('/api/kpis', {
    token,
    method: 'POST',
    body: {
      ownerType: 'sub',
      ownerId: 1,
      name: 'Invalid weight test',
      type: 'Outcome',
      measure: '%',
      baseline: 0,
      target: 100,
      weight: 0,
    },
  });
  assert.equal(invalid.status, 400);
});
