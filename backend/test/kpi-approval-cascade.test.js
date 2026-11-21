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
test('a Unit-owned KPI submission becomes official only after CPU approval', async () => {
  const { token: cpu } = await api.login('mutanhop@zou.ac.zw');
  const { token: unitHead } = await api.login('mvengem@zou.ac.zw');
  const { token: programmeHead } = await api.login('murehwa@zou.ac.zw'); // Programme Head, Governance and Administration
  const { token: otherProgrammeHead } = await api.login('kahwema@zou.ac.zw'); // Programme Head of a different Programme

  // Create a fresh Unit-owned KPI so this test's period is never contaminated
  // by another test's data on the same KPI.
  const created = await api.request('/api/kpis', {
    method: 'POST', token: cpu,
    body: { ownerType: 'unit', ownerId: 6, name: 'Approval Cascade Regression KPI', type: 'Output', measure: 'units', baseline: 15, target: 25 },
  });
  assert.equal(created.status, 201);
  const kpiId = created.body.kpi.id;
  assert.equal(created.body.kpi.lifecycle_status, 'active', 'new KPIs become available to performance reporting immediately');

  const year = 2032, month = 3; // an isolated period this test file owns
  // The submission-window feature ties a real submit to real (or, in tests,
  // fake — see helpers.js's ALLOW_TEST_CLOCK_OVERRIDE) wall-clock time
  // against the period itself, so submitting into this isolated future
  // period needs an X-Test-Now that actually falls inside its own window.
  const withinWindow = { headers: { 'X-Test-Now': '2032-03-26T00:00:00Z' } };

  // Unit Head enters and submits this period's figure.
  let r = await api.request(`/api/kpis/${kpiId}/value`, { method: 'PUT', token: unitHead, body: { year, month, value: 19 } });
  assert.equal(r.status, 200);
  r = await api.request(`/api/kpis/${kpiId}/submit`, { method: 'POST', token: unitHead, body: { year, month }, ...withinWindow });
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
  assert.equal(row.review_comment, null);

  const invalidFeedback = await api.request(`/api/kpis/${kpiId}/approve`, {
    method: 'POST', token: cpu, body: { year, month, feedback: { invalid: true } },
  });
  assert.equal(invalidFeedback.status, 400);

  // CPU approval immediately publishes the submitted actual.
  const feedback = 'Reviewed by CPU; supporting evidence is sufficient.';
  const realApprove = await api.request(`/api/kpis/${kpiId}/approve`, {
    method: 'POST', token: cpu, body: { year, month, feedback },
  });
  assert.equal(realApprove.status, 200);

  values = await api.request(`/api/kpis/${kpiId}/values`, { token: programmeHead });
  row = values.body.values.find((v) => v.year === year && v.month === month);
  assert.equal(row.status, 'approved');
  assert.equal(row.value, 19, 'approval publishes the submitted cumulative actual without adding the baseline');
  assert.equal(row.review_comment, feedback);

  // After approval, another CPU attempt is rejected because no review is pending.
  const cpuApproveAfter = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: cpu, body: { year, month } });
  assert.equal(cpuApproveAfter.status, 400);

  // An amendment starts a fresh review cycle and must not show stale CPU feedback.
  const amended = await api.request(`/api/kpis/${kpiId}/value`, {
    method: 'PUT', token: unitHead, body: { year, month, value: 20 },
  });
  assert.equal(amended.status, 200);
  assert.equal(amended.body.value.status, 'submitted');
  assert.equal(amended.body.value.review_comment, null);
});
