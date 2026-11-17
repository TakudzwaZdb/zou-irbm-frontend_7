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

async function getValue(token, kpiId, year, month) {
  const r = await api.request(`/api/kpis/${kpiId}/values`, { token });
  return r.body.values.find((v) => v.year === year && v.month === month);
}

// Direct KPI entries are cumulative snapshots, not monthly increments.
// Each approved month must retain the actual submitted for that month;
// amending an earlier snapshot must not rewrite later months.
test('approved direct KPI entries remain monthly snapshots when an earlier month is amended', async () => {
  const org = await api.request('/api/org', { token: ictadmin });
  const employee = org.body.employees[0];
  const unit = org.body.units.find((u) => u.id === employee.unit_id);
  assert.ok(unit, 'expected the seeded employee\'s unit to exist');

  // Find the real login accounts for the Employee who owns the KPI and CPU,
  // the final approver for every KPI tier.
  const users = await api.request('/api/users', { token: ictadmin });
  const employeeUser = users.body.users.find((u) => u.role === 'employee' && u.scope_id === employee.id);
  const cpuUser = users.body.users.find((u) => u.role === 'cpu');
  assert.ok(employeeUser && cpuUser, 'expected real login accounts for the Employee and CPU');

  const { token: indivToken } = await api.login(employeeUser.email);
  const { token: cpuToken } = await api.login(cpuUser.email);

  const kpiRes = await api.request('/api/kpis', {
    method: 'POST', token: ictadmin,
    body: { ownerType: 'employee', ownerId: employee.id, name: 'Cascade Test KPI', type: 'Output', measure: 'units', baseline: 0, target: 1000 },
  });
  assert.equal(kpiRes.status, 201);
  const kpiId = kpiRes.body.kpi.id;

  // The submission-window feature ties a real submit to real (or, in tests,
  // fake — see helpers.js's ALLOW_TEST_CLOCK_OVERRIDE) wall-clock time
  // against the period itself, and only opens on day 25 by default — the
  // 26th of each fixed test month is always both on-or-after that default
  // open day AND a real day in every month (including February).
  function withinWindow(year, month) {
    return { headers: { 'X-Test-Now': `${year}-${String(month).padStart(2, '0')}-26T00:00:00Z` } };
  }

  async function enterSubmitApprove(year, month, value) {
    let r = await api.request(`/api/kpis/${kpiId}/value`, { method: 'PUT', token: indivToken, body: { year, month, value } });
    assert.equal(r.status, 200, `enter ${year}-${month} failed: ${JSON.stringify(r.body)}`);
    r = await api.request(`/api/kpis/${kpiId}/submit`, { method: 'POST', token: indivToken, body: { year, month }, ...withinWindow(year, month) });
    assert.equal(r.status, 200, `submit ${year}-${month} failed: ${JSON.stringify(r.body)}`);
    r = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: cpuToken, body: { year, month } });
    assert.equal(r.status, 200, `approve ${year}-${month} failed: ${JSON.stringify(r.body)}`);
  }

  // Three monthly cumulative actuals: 10, 15, and 20.
  await enterSubmitApprove(2025, 1, 10);
  await enterSubmitApprove(2025, 2, 15);
  await enterSubmitApprove(2025, 3, 20);

  let jan = await getValue(ictadmin, kpiId, 2025, 1);
  let feb = await getValue(ictadmin, kpiId, 2025, 2);
  let mar = await getValue(ictadmin, kpiId, 2025, 3);
  assert.equal(jan.value, 10);
  assert.equal(feb.value, 15);
  assert.equal(mar.value, 20);

  // Amend January's snapshot from 10 to 30 and re-approve it. February and
  // March remain their own independent cumulative snapshots.
  let r = await api.request(`/api/kpis/${kpiId}/value`, { method: 'PUT', token: indivToken, body: { year: 2025, month: 1, value: 30 } });
  assert.equal(r.status, 200);
  jan = await getValue(ictadmin, kpiId, 2025, 1);
  assert.equal(jan.status, 'submitted', 'amending an approved period must return it to submitted, pending re-approval');
  const range = await api.request('/api/kpis/values-range?year=2025&fromMonth=1&toMonth=3', { token: ictadmin });
  assert.equal(range.status, 200);
  const janPreview = range.body.values.find((value) => value.kpi_id === kpiId && value.month === 1);
  assert.equal(janPreview.value, 10, 'the previous approved value remains official while the amendment is pending');
  assert.equal(janPreview.preview_value, 30, 'performance-range reads should prefer the pending submitted actual');

  r = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: cpuToken, body: { year: 2025, month: 1 } });
  assert.equal(r.status, 200);

  jan = await getValue(ictadmin, kpiId, 2025, 1);
  feb = await getValue(ictadmin, kpiId, 2025, 2);
  mar = await getValue(ictadmin, kpiId, 2025, 3);
  assert.equal(jan.value, 30, 'January\'s own total should now be the corrected 30');
  assert.equal(feb.value, 15, 'February keeps its own cumulative actual');
  assert.equal(mar.value, 20, 'March keeps its own cumulative actual');

  // Manual snapshot approvals never trigger the automated contribution cascade.
  const audit = await api.request('/api/audit?limit=500', { token: ictadmin });
  const cascadeEntries = audit.body.entries.filter((e) => e.action === 'cascade_recompute' && e.entity_id === kpiId);
  assert.equal(cascadeEntries.length, 0);
});
