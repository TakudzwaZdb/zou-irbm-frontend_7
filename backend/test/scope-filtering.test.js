const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => { await server.stop(); });

// Regression coverage for this project's own security-review finding: every
// GET endpoint was authenticated but not scope-filtered, so a signed-in
// account — down to a Unit Head — could read another branch's KPIs, plan
// proposals, or compliance data by calling the API directly, even though
// the UI never rendered it for them. See backend/src/utils/scope.js.
test('a Unit Head cannot read a KPI outside their own unit via a direct API call', async () => {
  const { token: ictadmin } = await api.login('l.chikomo@zou.ac.zw');
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw'); // Unit Head, scope_id = 1

  const allKpis = await api.request('/api/kpis', { token: ictadmin });
  const foreignKpi = allKpis.body.kpis.find((k) => !(k.owner_type === 'unit' && k.owner_id === 1) && !(k.owner_type === 'individual'));
  assert.ok(foreignKpi, 'expected at least one seeded KPI outside unit 1\'s own branch');

  const direct = await api.request(`/api/kpis/${foreignKpi.id}/values`, { token: unitHead });
  assert.equal(direct.status, 403, 'reading a foreign KPI\'s values directly by id must be refused');

  const list = await api.request('/api/kpis', { token: unitHead });
  assert.ok(!list.body.kpis.some((k) => k.id === foreignKpi.id), 'the foreign KPI must not appear in this Unit Head\'s own KPI list either');
});

test('a global oversight role still sees everything (no regression on legitimate access)', async () => {
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: ictadmin } = await api.login('l.chikomo@zou.ac.zw');

  const asIctadmin = await api.request('/api/kpis', { token: ictadmin });
  const asCpu = await api.request('/api/kpis', { token: cpu });
  assert.equal(asCpu.body.kpis.length, asIctadmin.body.kpis.length, 'CPU (a global reader) must see the same full KPI list ICT admin does');
});

test('scope narrows correctly at every tier: programme > sub-rep > unit head', async () => {
  const { token: ictadmin } = await api.login('l.chikomo@zou.ac.zw');
  const { token: programmeHead } = await api.login('s.chitiyo@zou.ac.zw'); // Programme Head, scope_id = 1
  const { token: rep } = await api.login('p.marecha@zou.ac.zw'); // Sub-programme Rep, scope_id = 1
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw'); // Unit Head, scope_id = 1

  const [full, prog, subRep, unit] = await Promise.all([
    api.request('/api/kpis', { token: ictadmin }),
    api.request('/api/kpis', { token: programmeHead }),
    api.request('/api/kpis', { token: rep }),
    api.request('/api/kpis', { token: unitHead }),
  ]);

  const nFull = full.body.kpis.length, nProg = prog.body.kpis.length, nSub = subRep.body.kpis.length, nUnit = unit.body.kpis.length;
  assert.ok(nFull > nProg, 'the Programme Head must see strictly fewer KPIs than the full org-wide list');
  assert.ok(nProg >= nSub, 'the Sub-programme Rep\'s own branch must be a subset of their Programme Head\'s');
  assert.ok(nSub >= nUnit, 'the Unit Head\'s own branch must be a subset of their Sub-programme Rep\'s');

  // Every KPI a Unit Head can see must also be visible to their own
  // Programme Head — a real subset relationship, not just smaller counts
  // that happen to look right.
  const progIds = new Set(prog.body.kpis.map((k) => k.id));
  for (const k of unit.body.kpis) {
    assert.ok(progIds.has(k.id), `KPI #${k.id} visible to the Unit Head must also be visible to their Programme Head`);
  }
});

test('Annual Plan & Budget read-scoping matches the same boundary', async () => {
  const { token: ictadmin } = await api.login('l.chikomo@zou.ac.zw');
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw'); // Unit Head, scope_id = 1
  const year = new Date().getFullYear() + 1;

  const full = await api.request(`/api/plans?year=${year}`, { token: ictadmin });
  const scoped = await api.request(`/api/plans?year=${year}`, { token: unitHead });
  assert.equal(scoped.status, 200);
  assert.ok(scoped.body.units.length < full.body.units.length, 'a Unit Head must see fewer units than the full org-wide plan');
  assert.ok(scoped.body.units.some((u) => u.id === 1), 'a Unit Head must still see their own unit\'s plan proposal');
});

test('Compliance & Escalations read-scoping matches the same boundary', async () => {
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw');
  const year = new Date().getFullYear(), month = new Date().getMonth() + 1;

  const full = await api.request(`/api/compliance?year=${year}&month=${month}`, { token: cpu });
  const scoped = await api.request(`/api/compliance?year=${year}&month=${month}`, { token: unitHead });
  assert.equal(scoped.status, 200);
  assert.ok(scoped.body.subs.length <= full.body.subs.length);
  assert.ok(scoped.body.subs.length >= 1, 'a Unit Head must still see their own Sub-programme\'s compliance row');
});
