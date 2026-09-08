const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => { await server.stop(); });

// Regression coverage for a deliberate reversion: a Sub-programme's own KPI
// performance submission briefly went through a two-stage review (Programme
// Head, then CPU for final sign-off) before that intermediate stage was
// removed by explicit request. This locks the reverted, single-stage
// behavior in as a real regression test against the running server — a Sub
// Rep submits, their own Programme Head's approval is immediately final
// (the cumulative value is computed right then, not held back for a later
// CPU step), and CPU has no path into this cascade at all any more.
test("a Sub-owned KPI submission is approved once, finally, by its own Programme Head — CPU gets a real 403, and the value is computed immediately", async () => {
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw'); // Sub-programme Rep, Administration (sub id 1, under Governance & Administration)
  const { token: programmeHead } = await api.login('s.chitiyo@zou.ac.zw'); // Programme Head, Governance & Administration
  const { token: otherProgrammeHead } = await api.login('b.manyanga@zou.ac.zw'); // Programme Head of a DIFFERENT Programme (Human Capital Development)

  // Create a fresh sub-owned KPI (owner_type: 'sub', owner_id: 1) so this
  // test's period is never contaminated by another test's data on the same
  // KPI.
  const created = await api.request('/api/kpis', {
    method: 'POST', token: cpu,
    body: { ownerType: 'sub', ownerId: 1, name: 'Approval Cascade Regression KPI', type: 'Output', measure: 'units', baseline: 100, target: 1000 },
  });
  assert.equal(created.status, 201);
  const kpiId = created.body.kpi.id;

  const year = 2032, month = 3; // an isolated period this test file owns

  // Rep enters and submits this period's figure.
  let r = await api.request(`/api/kpis/${kpiId}/value`, { method: 'PUT', token: rep, body: { year, month, value: 50 } });
  assert.equal(r.status, 200);
  r = await api.request(`/api/kpis/${kpiId}/submit`, { method: 'POST', token: rep, body: { year, month } });
  assert.equal(r.status, 200);

  // CPU: no longer any path into this cascade — real 403, not 200, and
  // never a "programme_approved" intermediate status to act on either.
  const cpuApprove = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: cpu, body: { year, month } });
  assert.equal(cpuApprove.status, 403);
  const cpuReturn = await api.request(`/api/kpis/${kpiId}/return`, { method: 'POST', token: cpu, body: { year, month, comment: 'should not be allowed' } });
  assert.equal(cpuReturn.status, 403);

  // A real Programme Head account, but the WRONG Programme — same 403,
  // proving this is a genuine scope check and not just "any programme role".
  const wrongProgrammeApprove = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: otherProgrammeHead, body: { year, month } });
  assert.equal(wrongProgrammeApprove.status, 403);

  // The submission must still be sitting untouched at 'submitted' after
  // three rejected attempts — none of them silently mutated anything, and
  // it never moved to the old, now-retired 'programme_approved' status.
  let values = await api.request(`/api/kpis/${kpiId}/values`, { token: programmeHead });
  let row = values.body.values.find((v) => v.year === year && v.month === month);
  assert.equal(row.status, 'submitted');
  assert.equal(row.value, null);

  // The Sub-programme's own, correct Programme Head: real 200, and — the
  // whole point of this reversion — the cumulative value is computed RIGHT
  // NOW, at this one approval, not held back for a later CPU step.
  const realApprove = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: programmeHead, body: { year, month } });
  assert.equal(realApprove.status, 200);

  values = await api.request(`/api/kpis/${kpiId}/values`, { token: programmeHead });
  row = values.body.values.find((v) => v.year === year && v.month === month);
  assert.equal(row.status, 'approved');
  // baseline (100) + entered_value (50) — the same previousOfficialValue
  // math every other tier's one true approval already uses.
  assert.equal(row.value, 150);

  // And now that it's already approved, CPU still can't touch this
  // sub-owned KPI's period either — a plain 400 ("nothing pending"), the
  // same response anyone (including the real approver) gets for acting on
  // an already-decided period, since there's genuinely nothing left to
  // approve, not even for CPU.
  const cpuApproveAfter = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: cpu, body: { year, month } });
  assert.equal(cpuApproveAfter.status, 400);
});
