const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => { await server.stop(); });

// Regression coverage for the real crash bug found during this project's
// own debug pass: 8 of the Annual Plan submit/approve/return routes threw
// an unhandled node:sqlite bind error (TypeError: Provided value cannot be
// bound...) instead of a clean 400 when cycleYear was missing from the
// request body, because getRow(cycleYear, ...) was called with
// cycleYear = undefined. Every one of those routes gets the same check
// here — a real POST against the running server, not a unit test of the
// validation logic in isolation, so a regression that reintroduces the
// crash (a 500, or the connection dying) is what this actually catches.
test('every Annual Plan submit/approve/return route 400s on a missing cycleYear instead of crashing', async () => {
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw');
  const { token: programme } = await api.login('s.chitiyo@zou.ac.zw');
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: council } = await api.login('f.museta@zou.ac.zw');

  const routes = [
    { method: 'POST', path: '/api/plans/units/1/submit', token: unitHead },
    { method: 'POST', path: '/api/plans/units/1/approve', token: rep },
    { method: 'POST', path: '/api/plans/units/1/return', token: rep, body: { comment: 'test' } },
    { method: 'POST', path: '/api/plans/subs/1/submit', token: rep },
    { method: 'POST', path: '/api/plans/subs/1/approve', token: programme },
    { method: 'POST', path: '/api/plans/subs/1/return', token: programme, body: { comment: 'test' } },
    { method: 'POST', path: '/api/plans/programmes/1/submit', token: programme },
    { method: 'POST', path: '/api/plans/university/return', token: council, body: { comment: 'test' } },
  ];

  for (const r of routes) {
    const res = await api.request(r.path, { method: r.method, token: r.token, body: r.body || {} });
    assert.equal(res.status, 400, `${r.method} ${r.path} with no cycleYear should 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /cycleYear/i);
  }
});

test('GET /plans still 400s cleanly on a missing year query param', async () => {
  const { token } = await api.login('t.moyo@zou.ac.zw');
  const res = await api.request('/api/plans', { token });
  assert.equal(res.status, 400);
});

// A Sub-programme's own plan proposal must be approved/returned by its own
// Programme Head, and by nobody else — CPU included, even though CPU holds
// the same `approve_own_tier` permission other tiers' approvers do. This
// used to have a deliberate CPU-as-fallback carve-out; it's been removed,
// so this locks the tightened behavior in as a real regression test against
// the running server, not just a reading of the route source.
test("a Sub-programme's plan proposal can only be approved/returned by its own Programme Head — CPU gets a real 403, not a silent bypass", async () => {
  const cycleYear = 2031; // an isolated cycle year this test file owns, so it never collides with plan data another test in this suite touches
  const { token: rep } = await api.login('p.marecha@zou.ac.zw'); // Sub-programme Rep, Administration (sub id 1, under Governance & Administration)
  const { token: programmeHead } = await api.login('s.chitiyo@zou.ac.zw'); // Programme Head, Governance & Administration
  const { token: otherProgrammeHead } = await api.login('b.manyanga@zou.ac.zw'); // Programme Head of a DIFFERENT Programme (Human Capital Development)
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');

  // Rep drafts and submits the Sub-programme's own planning narrative.
  const draft = await api.request('/api/plans/subs/1', { method: 'PUT', token: rep, body: { cycleYear, narrative: 'Test narrative for the approval-authority regression check.' } });
  assert.equal(draft.status, 200);
  const submit = await api.request('/api/plans/subs/1/submit', { method: 'POST', token: rep, body: { cycleYear } });
  assert.equal(submit.status, 200);

  // CPU: no longer an alternate approver at this tier — real 403, not 200.
  const cpuApprove = await api.request('/api/plans/subs/1/approve', { method: 'POST', token: cpu, body: { cycleYear } });
  assert.equal(cpuApprove.status, 403);
  const cpuReturn = await api.request('/api/plans/subs/1/return', { method: 'POST', token: cpu, body: { cycleYear, comment: 'should not be allowed' } });
  assert.equal(cpuReturn.status, 403);

  // A real Programme Head account, but the WRONG Programme — same 403,
  // proving this is a genuine scope check and not just "any programme role".
  const wrongProgrammeApprove = await api.request('/api/plans/subs/1/approve', { method: 'POST', token: otherProgrammeHead, body: { cycleYear } });
  assert.equal(wrongProgrammeApprove.status, 403);

  // The submission must still be sitting untouched at 'submitted' after
  // three rejected attempts — none of them silently mutated anything.
  const stillPending = await api.request('/api/plans?year=' + cycleYear, { token: programmeHead });
  const subRow = stillPending.body.subs.find((s) => s.id === 1);
  assert.equal(subRow.proposal.status, 'submitted');

  // The Sub-programme's own, correct Programme Head: real 200, real effect.
  const realApprove = await api.request('/api/plans/subs/1/approve', { method: 'POST', token: programmeHead, body: { cycleYear } });
  assert.equal(realApprove.status, 200);
  const after = await api.request('/api/plans?year=' + cycleYear, { token: programmeHead });
  assert.equal(after.body.subs.find((s) => s.id === 1).proposal.status, 'approved');
});
