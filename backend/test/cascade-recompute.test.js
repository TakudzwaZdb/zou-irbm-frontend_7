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

// The one bug this whole "correct all" pass was built around: a cumulative
// KPI's official value is always "the previous period's official total plus
// this period's own entry" (see kpis.js's previousOfficialValue). Amending
// an already-approved period and re-approving it must ripple that new total
// forward through every later already-approved period too — before the fix,
// only the amended period itself updated, silently leaving every later
// period's official total built on the stale number. This test builds a
// real multi-month chain through the real API (enter → submit → approve, an
// actual Individual and their actual Unit Head account, not a direct DB
// write) and then amends the first period, asserting the SECOND period's
// value moves too.
test('amending and re-approving an earlier period cascades the new total forward', async () => {
  const org = await api.request('/api/org', { token: ictadmin });
  const individual = org.body.individuals[0];
  const unit = org.body.units.find((u) => u.id === individual.unit_id);
  assert.ok(unit, 'expected the seeded individual\'s unit to exist');

  // Find the real login accounts for this Individual and their Unit Head —
  // exactly the two roles who actually own/approve an Individual-owned KPI
  // (see kpis.js's isOwner/isApprover).
  const users = await api.request('/api/users', { token: ictadmin });
  const individualUser = users.body.users.find((u) => u.role === 'individual' && u.scope_id === individual.id);
  const headUser = users.body.users.find((u) => u.role === 'unithead' && u.scope_id === individual.unit_id);
  assert.ok(individualUser && headUser, 'expected real login accounts for both the Individual and their Unit Head');

  const { token: indivToken } = await api.login(individualUser.email);
  const { token: headToken } = await api.login(headUser.email);

  const kpiRes = await api.request('/api/kpis', {
    method: 'POST', token: ictadmin,
    body: { ownerType: 'individual', ownerId: individual.id, name: 'Cascade Test KPI', type: 'Output', measure: 'units', baseline: 0, target: 1000 },
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
    r = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: headToken, body: { year, month } });
    assert.equal(r.status, 200, `approve ${year}-${month} failed: ${JSON.stringify(r.body)}`);
  }

  // Three consecutive months, entered smallest-first: 10, then 15, then 20.
  // Baseline is 0, so the real running totals should be 10, 25, 45.
  await enterSubmitApprove(2025, 1, 10);
  await enterSubmitApprove(2025, 2, 15);
  await enterSubmitApprove(2025, 3, 20);

  let jan = await getValue(ictadmin, kpiId, 2025, 1);
  let feb = await getValue(ictadmin, kpiId, 2025, 2);
  let mar = await getValue(ictadmin, kpiId, 2025, 3);
  assert.equal(jan.value, 10);
  assert.equal(feb.value, 25, 'February must be January\'s total plus February\'s own entry');
  assert.equal(mar.value, 45, 'March must build on February\'s total');

  // Now amend January's entry from 10 to 30 (an entered_value correction —
  // e.g. a late-discovered data error) and re-approve it. This is exactly
  // the "amend an already-approved period" path the correctness audit
  // flagged: before the fix, only January's own value updated (to 30) and
  // February/March silently kept their stale totals (25 and 45) — built on
  // top of the OLD January figure — until someone happened to re-touch them.
  let r = await api.request(`/api/kpis/${kpiId}/value`, { method: 'PUT', token: indivToken, body: { year: 2025, month: 1, value: 30 } });
  assert.equal(r.status, 200);
  jan = await getValue(ictadmin, kpiId, 2025, 1);
  assert.equal(jan.status, 'submitted', 'amending an approved period must return it to submitted, pending re-approval');

  r = await api.request(`/api/kpis/${kpiId}/approve`, { method: 'POST', token: headToken, body: { year: 2025, month: 1 } });
  assert.equal(r.status, 200);

  jan = await getValue(ictadmin, kpiId, 2025, 1);
  feb = await getValue(ictadmin, kpiId, 2025, 2);
  mar = await getValue(ictadmin, kpiId, 2025, 3);
  assert.equal(jan.value, 30, 'January\'s own total should now be the corrected 30');
  assert.equal(feb.value, 45, 'February must cascade-recompute: 30 (new Jan total) + 15 (Feb\'s own entry)');
  assert.equal(mar.value, 65, 'March must cascade-recompute too: 45 (new Feb total) + 20 (Mar\'s own entry)');

  // And the cascade must be traceable — never a silent correction.
  const audit = await api.request('/api/audit?limit=500', { token: ictadmin });
  const cascadeEntries = audit.body.entries.filter((e) => e.action === 'cascade_recompute' && e.entity_id === kpiId);
  assert.ok(cascadeEntries.length >= 2, 'expected an audit trail entry for each later period the cascade actually recomputed (February and March)');
});
