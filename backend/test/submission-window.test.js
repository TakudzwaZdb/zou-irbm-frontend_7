const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => { await server.stop(); });

// X-Test-Now is only honored because helpers.js starts the test server with
// ALLOW_TEST_CLOCK_OVERRIDE=1 — see utils/submissionWindow.js's resolveNow.
// A real deployment never sets that env var, so the header is silently
// ignored there and every check always uses the real clock.
function at(iso) { return { headers: { 'X-Test-Now': iso } }; }

// Default settings: opens the 25th of the reporting month, on-time through
// month-end, late-but-accepted through the 3rd of the following month,
// closed after that — see utils/submissionWindow.js's own header comment.
test('GET /kpis/submission-window walks through every state with the default 25 / 3 settings', async () => {
  const { token } = await api.login('t.moyo@zou.ac.zw'); // CPU — a global reader, no data_entry needed to just check the window

  // Before the 25th of the reporting month: not yet open.
  let r = await api.request('/api/kpis/submission-window?year=2027&month=6', { token, ...at('2027-06-20T00:00:00Z') });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'not_open');
  assert.equal(r.body.allowed, false);
  assert.equal(r.body.late, false);
  assert.match(r.body.message, /open on 25 June 2027/);

  // On the open day itself: open.
  r = await api.request('/api/kpis/submission-window?year=2027&month=6', { token, ...at('2027-06-25T00:00:00Z') });
  assert.equal(r.body.status, 'open');
  assert.equal(r.body.allowed, true);

  // Mid-window, still June: open.
  r = await api.request('/api/kpis/submission-window?year=2027&month=6', { token, ...at('2027-06-28T12:00:00Z') });
  assert.equal(r.body.status, 'open');

  // The instant after month-end (June has 30 days): late, but still allowed.
  r = await api.request('/api/kpis/submission-window?year=2027&month=6', { token, ...at('2027-07-01T00:00:01Z') });
  assert.equal(r.body.status, 'late');
  assert.equal(r.body.late, true);
  assert.equal(r.body.allowed, true);

  // The 3rd of July (the configured close day) is still inside the grace window.
  r = await api.request('/api/kpis/submission-window?year=2027&month=6', { token, ...at('2027-07-03T23:59:00Z') });
  assert.equal(r.body.status, 'late');
  assert.equal(r.body.allowed, true);

  // Past the close day: closed.
  r = await api.request('/api/kpis/submission-window?year=2027&month=6', { token, ...at('2027-07-04T00:00:01Z') });
  assert.equal(r.body.status, 'closed');
  assert.equal(r.body.allowed, false);
  assert.match(r.body.message, /closed on 3 July 2027/);
});

test('the admin-configured open/close days are honored, and PATCH /settings rejects out-of-range values', async () => {
  // manage_settings belongs to the CPU role (see utils/permissions.js) —
  // ICT Systems Administrator manages accounts/framework/org, not these
  // thresholds.
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw');

  // A non-admin can't move the window.
  const forbidden = await api.request('/api/settings', {
    method: 'PATCH', token: rep, body: { submissionOpenDay: 1, submissionCloseDay: 31 },
  });
  assert.equal(forbidden.status, 403);

  // Out-of-range values are rejected outright, never silently clamped.
  let bad = await api.request('/api/settings', { method: 'PATCH', token: cpu, body: { submissionOpenDay: 0 } });
  assert.equal(bad.status, 400);
  bad = await api.request('/api/settings', { method: 'PATCH', token: cpu, body: { submissionCloseDay: 32 } });
  assert.equal(bad.status, 400);
  bad = await api.request('/api/settings', { method: 'PATCH', token: cpu, body: { submissionOpenDay: 1.5 } });
  assert.equal(bad.status, 400);

  // Widen the window to the whole month either side, and confirm the new
  // days actually move the boundaries.
  const saved = await api.request('/api/settings', {
    method: 'PATCH', token: cpu, body: { submissionOpenDay: 1, submissionCloseDay: 15 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.submissionOpenDay, 1);
  assert.equal(saved.body.settings.submissionCloseDay, 15);

  // The 2nd of the reporting month is now open (was not_open under the
  // default day-25 setting).
  let r = await api.request('/api/kpis/submission-window?year=2027&month=8', { token: rep, ...at('2027-08-02T00:00:00Z') });
  assert.equal(r.body.status, 'open');

  // The 10th of the FOLLOWING month is now still late-but-accepted (was
  // closed under the default day-3 setting).
  r = await api.request('/api/kpis/submission-window?year=2027&month=8', { token: rep, ...at('2027-09-10T00:00:00Z') });
  assert.equal(r.body.status, 'late');
  assert.equal(r.body.allowed, true);

  // Restore the defaults so no other test file (which each get their own
  // disposable DB — see helpers.js — so this is just hygiene, not required
  // for isolation) is surprised by a lingering wide-open window.
  await api.request('/api/settings', { method: 'PATCH', token: cpu, body: { submissionOpenDay: 25, submissionCloseDay: 3 } });
});

test('POST /kpis/:id/submit and /kpis/bulk-submit are actually blocked outside the window, and accepted-but-flagged inside the late grace window', async () => {
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw'); // Sub-programme Rep, owns Sub-owned KPIs

  const created = await api.request('/api/kpis', {
    method: 'POST', token: cpu,
    body: { ownerType: 'sub', ownerId: 1, name: 'Submission Window Regression KPI', type: 'Output', measure: 'units', baseline: 0, target: 100 },
  });
  assert.equal(created.status, 201);
  const kpiId = created.body.kpi.id;
  const year = 2028, month = 4; // an isolated period this test file owns

  // Entering (drafting) a value is never gated by the window — only the
  // explicit submit action is.
  let r = await api.request(`/api/kpis/${kpiId}/value`, { method: 'PUT', token: rep, body: { year, month, value: 40 } });
  assert.equal(r.status, 200);

  // Too early (before the 25th): blocked with a real 403, and the value
  // must still be sitting untouched at 'draft'.
  r = await api.request(`/api/kpis/${kpiId}/submit`, { method: 'POST', token: rep, body: { year, month }, ...at('2028-04-10T00:00:00Z') });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /open on 25 April 2028/);
  let values = await api.request(`/api/kpis/${kpiId}/values`, { token: cpu });
  assert.equal(values.body.values.find((v) => v.year === year && v.month === month).status, 'draft');

  // Too late (well past the grace window): also blocked.
  r = await api.request(`/api/kpis/${kpiId}/submit`, { method: 'POST', token: rep, body: { year, month }, ...at('2028-05-20T00:00:00Z') });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /closed on 3 May 2028/);

  // Inside the late grace window (2 May): accepted, but flagged late — both
  // in the immediate response and when read back afterward.
  r = await api.request(`/api/kpis/${kpiId}/submit`, { method: 'POST', token: rep, body: { year, month }, ...at('2028-05-02T09:00:00Z') });
  assert.equal(r.status, 200);
  assert.equal(r.body.late, true);

  values = await api.request(`/api/kpis/${kpiId}/values`, { token: cpu });
  const row = values.body.values.find((v) => v.year === year && v.month === month);
  assert.equal(row.status, 'submitted');
  assert.equal(row.late, true);

  // A second, freshly-created KPI submitted ON TIME must read back late: false.
  const created2 = await api.request('/api/kpis', {
    method: 'POST', token: cpu,
    body: { ownerType: 'sub', ownerId: 1, name: 'Submission Window On-Time Regression KPI', type: 'Output', measure: 'units', baseline: 0, target: 100 },
  });
  const kpiId2 = created2.body.kpi.id;
  await api.request(`/api/kpis/${kpiId2}/value`, { method: 'PUT', token: rep, body: { year, month, value: 10 } });
  r = await api.request(`/api/kpis/${kpiId2}/submit`, { method: 'POST', token: rep, body: { year, month }, ...at('2028-04-26T00:00:00Z') });
  assert.equal(r.status, 200);
  assert.equal(r.body.late, false);
  values = await api.request(`/api/kpis/${kpiId2}/values`, { token: cpu });
  assert.equal(values.body.values.find((v) => v.year === year && v.month === month).late, false);

  // bulk-submit is gated the exact same way.
  const created3 = await api.request('/api/kpis', {
    method: 'POST', token: cpu,
    body: { ownerType: 'sub', ownerId: 1, name: 'Submission Window Bulk Regression KPI', type: 'Output', measure: 'units', baseline: 0, target: 100 },
  });
  const kpiId3 = created3.body.kpi.id;
  await api.request(`/api/kpis/${kpiId3}/value`, { method: 'PUT', token: rep, body: { year, month, value: 5 } });
  r = await api.request('/api/kpis/bulk-submit', {
    method: 'POST', token: rep, body: { year, month, ids: [kpiId3] }, ...at('2028-04-10T00:00:00Z'),
  });
  assert.equal(r.status, 403);
  r = await api.request('/api/kpis/bulk-submit', {
    method: 'POST', token: rep, body: { year, month, ids: [kpiId3] }, ...at('2028-04-26T00:00:00Z'),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.submitted, 1);
});

test('POST /kpis/:id/contribution/submit (an assigned Individual\'s own figure toward a shared Unit KPI) is gated by the same window', async () => {
  // GET /api/users is ICT-admin-only (see routes/users.js's requireRole)
  // and ictadmin also holds create_kpi — use it throughout, same as
  // cascade-recompute.test.js's own identical org/user lookup pattern.
  const { token: ictadmin } = await api.login('l.chikomo@zou.ac.zw');

  // Pick a real seeded Individual and derive their real Unit and Unit Head
  // login from it — rather than hardcoding a unit id whose seeded
  // population isn't guaranteed.
  const org = await api.request('/api/org', { token: ictadmin });
  const individual = org.body.individuals[0];
  assert.ok(individual, 'expected at least one seeded individual');
  const unit = org.body.units.find((u) => u.id === individual.unit_id);
  assert.ok(unit, 'expected the seeded individual\'s unit to exist');

  const users = await api.request('/api/users', { token: ictadmin });
  const individualUser = users.body.users.find((u) => u.role === 'individual' && u.scope_id === individual.id);
  const headUser = users.body.users.find((u) => u.role === 'unithead' && u.scope_id === unit.id);
  assert.ok(individualUser && headUser, 'expected real login accounts for both the Individual and their Unit Head');
  const { token: indivToken } = await api.login(individualUser.email);
  const { token: unitHead } = await api.login(headUser.email);

  const created = await api.request('/api/kpis', {
    method: 'POST', token: ictadmin,
    body: { ownerType: 'unit', ownerId: unit.id, name: 'Submission Window Contribution Regression KPI', type: 'Output', measure: '%', baseline: 0, target: 100 },
  });
  assert.equal(created.status, 201);
  const kpiId = created.body.kpi.id;

  const assign = await api.request(`/api/kpis/${kpiId}/assign`, { method: 'POST', token: unitHead, body: { individualId: individual.id } });
  assert.equal(assign.status, 201);

  const year = 2028, month = 7;
  const enter = await api.request(`/api/kpis/${kpiId}/contribution`, { method: 'PUT', token: indivToken, body: { year, month, value: 12 } });
  assert.equal(enter.status, 200);

  // Blocked before the window opens.
  let r = await api.request(`/api/kpis/${kpiId}/contribution/submit`, { method: 'POST', token: indivToken, body: { year, month }, ...at('2028-07-01T00:00:00Z') });
  assert.equal(r.status, 403);

  // Accepted once open, and not flagged late when submitted on time.
  r = await api.request(`/api/kpis/${kpiId}/contribution/submit`, { method: 'POST', token: indivToken, body: { year, month }, ...at('2028-07-26T00:00:00Z') });
  assert.equal(r.status, 200);
  assert.equal(r.body.late, false);

  const contributions = await api.request(`/api/kpis/contributions?year=${year}&month=${month}`, { token: unitHead });
  const row = contributions.body.contributions.find((c) => c.kpi_id === kpiId && c.individual_id === individual.id);
  assert.equal(row.status, 'submitted');
  assert.equal(row.late, false);
});
