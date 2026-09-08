const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api, ictadmin;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
  ictadmin = (await api.login('l.chikomo@zou.ac.zw')).token;
});
after(async () => { await server.stop(); });

// Real end-to-end coverage of this app's core data-safety guarantee: every
// "remove" is a deleted_at stamp, never a genuine SQL DELETE, and every
// stamp has a working, server-enforced way back. Exercised through the
// actual HTTP routes a real admin session would use — no reaching into the
// database directly to fake state.
test('removing a Programme cascades to everything beneath it, and restoring brings all of it back', async () => {
  const created = await api.request('/api/org/programmes', {
    method: 'POST', token: ictadmin,
    body: { name: 'Test Programme for Soft-Delete', head: 'Dr. Test Head' },
  });
  assert.equal(created.status, 201);
  const programmeId = created.body.programme.id;

  const sub = await api.request('/api/org/subs', {
    method: 'POST', token: ictadmin,
    body: { programmeId, name: 'Test Sub-programme', head: 'Test Rep' },
  });
  assert.equal(sub.status, 201);
  const subId = sub.body.sub.id;

  const unit = await api.request('/api/org/units', {
    method: 'POST', token: ictadmin,
    body: { subId, name: 'Test Unit', head: 'Test Unit Head' },
  });
  assert.equal(unit.status, 201);
  const unitId = unit.body.unit.id;

  // All three appear in the live org tree before removal.
  let org = await api.request('/api/org', { token: ictadmin });
  assert.ok(org.body.programmes.some((p) => p.id === programmeId));
  assert.ok(org.body.subs.some((s) => s.id === subId));
  assert.ok(org.body.units.some((u) => u.id === unitId));

  const removed = await api.request(`/api/org/programmes/${programmeId}`, { method: 'DELETE', token: ictadmin });
  assert.equal(removed.status, 200);

  // Gone from the active tree — all three tiers, not just the top one.
  org = await api.request('/api/org', { token: ictadmin });
  assert.ok(!org.body.programmes.some((p) => p.id === programmeId), 'Programme must disappear from the active tree');
  assert.ok(!org.body.subs.some((s) => s.id === subId), 'its Sub-programme must cascade-disappear too');
  assert.ok(!org.body.units.some((u) => u.id === unitId), 'and its Unit as well');

  const restored = await api.request(`/api/org/programmes/${programmeId}/restore`, { method: 'POST', token: ictadmin });
  assert.equal(restored.status, 200);

  // Fully back — same ids, same names, nothing re-created from scratch.
  org = await api.request('/api/org', { token: ictadmin });
  const restoredProgramme = org.body.programmes.find((p) => p.id === programmeId);
  const restoredSub = org.body.subs.find((s) => s.id === subId);
  const restoredUnit = org.body.units.find((u) => u.id === unitId);
  assert.ok(restoredProgramme && restoredProgramme.name === 'Test Programme for Soft-Delete');
  assert.ok(restoredSub && restoredSub.name === 'Test Sub-programme');
  assert.ok(restoredUnit && restoredUnit.name === 'Test Unit');
});

test('a removed KPI keeps its full value history and comes back exactly as it was', async () => {
  const org = await api.request('/api/org', { token: ictadmin });
  const someUnit = org.body.units[0];

  const kpiRes = await api.request('/api/kpis', {
    method: 'POST', token: ictadmin,
    body: { ownerType: 'unit', ownerId: someUnit.id, name: 'Soft-Delete Test KPI', type: 'Output', measure: 'units', baseline: 0, target: 100 },
  });
  assert.equal(kpiRes.status, 201);
  const kpiId = kpiRes.body.kpi.id;

  const before = await api.request(`/api/kpis/${kpiId}/values`, { token: ictadmin });
  assert.equal(before.status, 200);
  const historyLength = before.body.values.length;

  const del = await api.request(`/api/kpis/${kpiId}`, { method: 'DELETE', token: ictadmin });
  assert.equal(del.status, 200);

  const list = await api.request('/api/kpis', { token: ictadmin });
  assert.ok(!list.body.kpis.some((k) => k.id === kpiId), 'removed KPI must not appear in the active list');

  const removedList = await api.request('/api/kpis/removed', { token: ictadmin });
  assert.ok(removedList.body.kpis.some((k) => k.id === kpiId), 'removed KPI must appear in Recently Removed');

  const restore = await api.request(`/api/kpis/${kpiId}/restore`, { method: 'POST', token: ictadmin });
  assert.equal(restore.status, 200);

  const after = await api.request(`/api/kpis/${kpiId}/values`, { token: ictadmin });
  assert.equal(after.status, 200);
  assert.equal(after.body.values.length, historyLength, 'restoring must not lose or duplicate any of its recorded value history');

  const relist = await api.request('/api/kpis', { token: ictadmin });
  assert.ok(relist.body.kpis.some((k) => k.id === kpiId), 'restored KPI must reappear in the active list');
});
