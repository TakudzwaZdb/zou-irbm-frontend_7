const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => { await server.stop(); });

// CPU is the final approver for KPI submissions at every owner tier.
test('a Sub-owned KPI submission becomes official only after CPU approval', async () => {
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw'); // Sub-programme Rep, Administration (sub id 1, under Governance & Administration)
  const { token: programmeHead } = await api.login('s.chitiyo@zou.ac.zw'); // Programme Head, Governance & Administration
  const { token: otherProgrammeHead } = await api.login('b.manyanga@zou.ac.zw'); // Programme Head of a DIFFERENT Programme (Human Capital Development)

  // Create a fresh sub-owned KPI (owner_type: 'sub', owner_id: 1) so this
  // test's period is never contaminated by another test's data on the same
  // KPI.
  const created = await api.request('/api/kpis', {
    method: 'POST', token: cpu,
    body: { ownerType: 'sub', ownerId: 1, name: 'Approval Cascade Regression KPI', type: 'Output', measure: 'units', baseline: 15, target: 25 },
  });
  assert.equal(created.status, 201);
  const kpiId = created.body.kpi.id;

  const year = 2032, month = 3; // an isolated period this test file owns
  // The submission-window feature ties a real submit to real (or, in tests,
  // fake — see helpers.js's ALLOW_TEST_CLOCK_OVERRIDE) wall-clock time
  // against the period itself, so submitting into this isolated future
  // period needs an X-Test-Now that actually falls inside its own window.
  const withinWindow = { headers: { 'X-Test-Now': '2032-03-26T00:00:00Z' } };

  // Rep enters and submits this period's figure.
  let r = await api.request(`/api/kpis/${kpiId}/value`, { method: 'PUT', token: rep, body: { year, month, value: 19 } });
  assert.equal(r.status, 200);
  r = await api.request(`/api/kpis/${kpiId}/submit`, { method: 'POST', token: rep, body: { year, month }, ...withinWindow });
  assert.equal(r.status, 200);

  // Programme Heads cannot publish performance values; CPU alone is the
  // final approver, regardless of the KPI owner's tier.
  const programmeHeadApprove = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: programmeHead, body: { year, month } });
  assert.equal(programmeHeadApprove.status, 403);
  const wrongProgrammeApprove = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: otherProgrammeHead, body: { year, month } });
  assert.equal(wrongProgrammeApprove.status, 403);

  // The submission stays pending after rejected manager approvals.
  let values = await api.request(`/api/kpis/${kpiId}/values`, { token: programmeHead });
  let row = values.body.values.find((v) => v.year === year && v.month === month);
  assert.equal(row.status, 'submitted');
  assert.equal(row.value, null);
  assert.equal(row.preview_value, 19, 'the pending score preview must use the submitted actual without adding baseline');

  // CPU approval immediately publishes the submitted actual.
  const realApprove = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: cpu, body: { year, month } });
  assert.equal(realApprove.status, 200);

  values = await api.request(`/api/kpis/${kpiId}/values`, { token: programmeHead });
  row = values.body.values.find((v) => v.year === year && v.month === month);
  assert.equal(row.status, 'approved');
  assert.equal(row.value, 19, 'approval publishes the submitted cumulative actual without adding the baseline');

  // After approval, another CPU attempt is rejected because no review is pending.
  const cpuApproveAfter = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: cpu, body: { year, month } });
  assert.equal(cpuApproveAfter.status, 400);
});
