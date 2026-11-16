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

  const routes = [
    { method: 'POST', path: '/api/plans/units/1/submit', token: unitHead },
    { method: 'POST', path: '/api/plans/units/1/approve', token: cpu },
    { method: 'POST', path: '/api/plans/units/1/return', token: cpu, body: { comment: 'test' } },
    { method: 'POST', path: '/api/plans/subs/1/submit', token: rep },
    { method: 'POST', path: '/api/plans/subs/1/approve', token: cpu },
    { method: 'POST', path: '/api/plans/subs/1/return', token: cpu, body: { comment: 'test' } },
    { method: 'POST', path: '/api/plans/programmes/1/submit', token: programme },
    { method: 'POST', path: '/api/plans/programmes/1/approve', token: cpu },
    { method: 'POST', path: '/api/plans/programmes/1/return', token: cpu, body: { comment: 'test' } },
    { method: 'POST', path: '/api/plans/university/approve', token: cpu },
    { method: 'POST', path: '/api/plans/university/return', token: cpu, body: { comment: 'test' } },
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

// CPU is the only role authorized to approve or return annual plan proposals.
test("CPU alone approves and returns Sub-programme proposals", async () => {
  const cycleYear = 2031; // an isolated cycle year this test file owns, so it never collides with plan data another test in this suite touches
  const { token: rep } = await api.login('p.marecha@zou.ac.zw'); // Sub-programme Rep, Administration (sub id 1, under Governance & Administration)
  const { token: programmeHead } = await api.login('s.chitiyo@zou.ac.zw'); // Programme Head, Governance & Administration
  const { token: otherProgrammeHead } = await api.login('b.manyanga@zou.ac.zw'); // Programme Head of a DIFFERENT Programme (Human Capital Development)
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');

  // Rep drafts and submits the Sub-programme's own narrative and targets.
  const draft = await api.request('/api/plans/subs/1', {
    method: 'PUT', token: rep,
    body: { cycleYear, narrative: 'Test narrative for the approval-authority regression check.', targets: 'Complete the planned service improvements.' },
  });
  assert.equal(draft.status, 200);
  const submit = await api.request('/api/plans/subs/1/submit', { method: 'POST', token: rep, body: { cycleYear } });
  assert.equal(submit.status, 200);

  const headApprove = await api.request('/api/plans/subs/1/approve', { method: 'POST', token: programmeHead, body: { cycleYear } });
  assert.equal(headApprove.status, 403);
  const otherHeadReturn = await api.request('/api/plans/subs/1/return', {
    method: 'POST', token: otherProgrammeHead, body: { cycleYear, comment: 'should not be allowed' },
  });
  assert.equal(otherHeadReturn.status, 403);

  const cpuReturn = await api.request('/api/plans/subs/1/return', {
    method: 'POST', token: cpu, body: { cycleYear, comment: 'Please clarify the target.' },
  });
  assert.equal(cpuReturn.status, 200);
  const returned = await api.request('/api/plans?year=' + cycleYear, { token: programmeHead });
  assert.equal(returned.body.subs.find((s) => s.id === 1).proposal.status, 'draft');

  const revised = await api.request('/api/plans/subs/1', {
    method: 'PUT', token: rep,
    body: { cycleYear, narrative: 'Revised plan narrative.', targets: 'Deliver the target service improvements.' },
  });
  assert.equal(revised.status, 200);
  const resubmit = await api.request('/api/plans/subs/1/submit', { method: 'POST', token: rep, body: { cycleYear } });
  assert.equal(resubmit.status, 200);
  const cpuApprove = await api.request('/api/plans/subs/1/approve', { method: 'POST', token: cpu, body: { cycleYear } });
  assert.equal(cpuApprove.status, 200);
  const after = await api.request('/api/plans?year=' + cycleYear, { token: programmeHead });
  assert.equal(after.body.subs.find((s) => s.id === 1).proposal.status, 'approved');
});

test('a plan requires a narrative and either a budget or measurable targets', async () => {
  const cycleYear = 2032;
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw');
  const emptyDraft = await api.request('/api/plans/units/1', {
    method: 'PUT', token: unitHead, body: { cycleYear, narrative: 'A complete narrative.', budget: null, targets: '' },
  });
  assert.equal(emptyDraft.status, 200);
  const rejected = await api.request('/api/plans/units/1/submit', { method: 'POST', token: unitHead, body: { cycleYear } });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /budget or measurable targets/i);

  const targetDraft = await api.request('/api/plans/units/1', {
    method: 'PUT', token: unitHead, body: { cycleYear, narrative: 'A complete narrative.', budget: null, targets: 'Reduce response time to 2 days.' },
  });
  assert.equal(targetDraft.status, 200);
  const submitted = await api.request('/api/plans/units/1/submit', { method: 'POST', token: unitHead, body: { cycleYear } });
  assert.equal(submitted.status, 200);

  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw');
  const repApprove = await api.request('/api/plans/units/1/approve', { method: 'POST', token: rep, body: { cycleYear } });
  assert.equal(repApprove.status, 403);
  const cpuApprove = await api.request('/api/plans/units/1/approve', { method: 'POST', token: cpu, body: { cycleYear } });
  assert.equal(cpuApprove.status, 200);
});

test('CPU pending-plan feed includes submitted plans and clears approved plans', async () => {
  const cycleYear = 2034;
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw');
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw');

  const draft = await api.request('/api/plans/units/1', {
    method: 'PUT', token: unitHead,
    body: { cycleYear, narrative: 'Pending feed test.', targets: 'Complete the work plan.' },
  });
  assert.equal(draft.status, 200);
  const submit = await api.request('/api/plans/units/1/submit', {
    method: 'POST', token: unitHead, body: { cycleYear },
  });
  assert.equal(submit.status, 200);

  const denied = await api.request('/api/plans/pending', { token: rep });
  assert.equal(denied.status, 403);

  const pending = await api.request('/api/plans/pending', { token: cpu });
  assert.equal(pending.status, 200);
  assert.ok(pending.body.proposals.some((proposal) =>
    proposal.owner_type === 'unit' && proposal.owner_name && proposal.cycle_year === cycleYear));

  const approve = await api.request('/api/plans/units/1/approve', {
    method: 'POST', token: cpu, body: { cycleYear },
  });
  assert.equal(approve.status, 200);
  const cleared = await api.request('/api/plans/pending', { token: cpu });
  assert.ok(!cleared.body.proposals.some((proposal) =>
    proposal.owner_type === 'unit' && proposal.cycle_year === cycleYear));
});

test('one Unit can save and batch-submit multiple named plans for CPU batch approval', async () => {
  const cycleYear = 2035;
  const { token: unitHead } = await api.login('s.chikonzo@zou.ac.zw');
  const { token: rep } = await api.login('p.marecha@zou.ac.zw');
  const { token: programmeHead } = await api.login('s.chitiyo@zou.ac.zw');
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');

  const first = await api.request('/api/plans/items', {
    method: 'POST', token: unitHead,
    body: {
      ownerType: 'unit', ownerId: 1, cycleYear, planTitle: 'Records digitisation',
      narrative: 'Digitise current records.', budget: 1200,
    },
  });
  const second = await api.request('/api/plans/items', {
    method: 'POST', token: unitHead,
    body: { ownerType: 'unit', ownerId: 1, cycleYear, planTitle: 'Staff training' },
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.proposal.narrative, 'Digitise current records.');
  assert.equal(Number(first.body.proposal.budget), 1200);

  const unauthorized = await api.request('/api/plans/items', {
    method: 'POST', token: rep,
    body: { ownerType: 'unit', ownerId: 1, cycleYear, planTitle: 'Not my Unit plan' },
  });
  assert.equal(unauthorized.status, 403);

  const items = [
    { id: first.body.proposal.id, planTitle: 'Records digitisation', narrative: 'Digitise current records.', budget: 1200, targets: '' },
    { id: second.body.proposal.id, planTitle: 'Staff training', narrative: 'Train Unit staff.', budget: 900, targets: 'Train 20 staff members.' },
  ];
  const saved = await api.request('/api/plans/items/drafts', { method: 'PUT', token: unitHead, body: { items } });
  assert.equal(saved.status, 200);

  const submitted = await api.request('/api/plans/items/submit', { method: 'POST', token: unitHead, body: { items } });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.submitted, 2);

  const pending = await api.request(`/api/plans?year=${cycleYear}`, { token: cpu });
  const unitProposals = pending.body.units.find((unit) => unit.id === 1).proposals;
  assert.equal(unitProposals.filter((proposal) => proposal.status === 'submitted').length, 2);
  assert.equal(Number(unitProposals.find((proposal) => proposal.id === items[0].id).budget), 1200);
  assert.equal(unitProposals.find((proposal) => proposal.id === items[1].id).targets, 'Train 20 staff members.');

  const approved = await api.request('/api/plans/items/approve', {
    method: 'POST', token: cpu, body: { proposalIds: items.map((item) => item.id) },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.approved, 2);

  async function submitAndApprovePlan(token, ownerType, ownerId, planTitle, budget) {
    const created = await api.request('/api/plans/items', {
      method: 'POST', token,
      body: { ownerType, ownerId, cycleYear, planTitle },
    });
    assert.equal(created.status, 201);
    const item = { id: created.body.proposal.id, planTitle, narrative: `${planTitle} narrative.`, budget, targets: '' };
    const submission = await api.request('/api/plans/items/submit', {
      method: 'POST', token, body: { items: [item] },
    });
    assert.equal(submission.status, 200);
    const approval = await api.request('/api/plans/items/approve', {
      method: 'POST', token: cpu, body: { proposalIds: [item.id] },
    });
    assert.equal(approval.status, 200);
  }
  await submitAndApprovePlan(rep, 'sub', 1, 'Sub-programme facilities', 400);
  await submitAndApprovePlan(programmeHead, 'programme', 1, 'Programme research equipment', 300);

  const universityDraft = await api.request('/api/plans/university', {
    method: 'PUT', token: cpu, body: { cycleYear, narrative: 'Compiled university plan.' },
  });
  assert.equal(universityDraft.status, 200);
  const universitySubmit = await api.request('/api/plans/university/submit', {
    method: 'POST', token: cpu, body: { cycleYear },
  });
  assert.equal(universitySubmit.status, 200);

  const after = await api.request(`/api/plans?year=${cycleYear}`, { token: cpu });
  const finalProposals = after.body.units.find((unit) => unit.id === 1).proposals;
  assert.equal(finalProposals.filter((proposal) => proposal.status === 'approved').length, 2);
  const approvedUnit = after.body.units.find((unit) => unit.id === 1);
  assert.equal(approvedUnit.approvedBudget, 2100);
  const approvedSub = after.body.subs.find((sub) => sub.id === approvedUnit.sub_id);
  assert.equal(approvedSub.approvedBudget, 2500);
  const approvedProgramme = after.body.programmes.find((programme) => programme.id === approvedSub.programme_id);
  assert.equal(approvedProgramme.approvedBudget, 2800);
  assert.equal(after.body.university.provisionalBudget, 2800);
});

test('CPU is the only approver for Programme and University annual plans', async () => {
  const cycleYear = 2033;
  const { token: programme } = await api.login('s.chitiyo@zou.ac.zw');
  const { token: cpu } = await api.login('t.moyo@zou.ac.zw');
  const { token: council } = await api.login('f.museta@zou.ac.zw');

  const programmeDraft = await api.request('/api/plans/programmes/1', {
    method: 'PUT', token: programme,
    body: { cycleYear, narrative: 'Programme plan narrative.', targets: 'Complete the programme milestones.' },
  });
  assert.equal(programmeDraft.status, 200);
  const programmeSubmit = await api.request('/api/plans/programmes/1/submit', { method: 'POST', token: programme, body: { cycleYear } });
  assert.equal(programmeSubmit.status, 200);
  const programmeReject = await api.request('/api/plans/programmes/1/approve', { method: 'POST', token: programme, body: { cycleYear } });
  assert.equal(programmeReject.status, 403);
  const programmeApprove = await api.request('/api/plans/programmes/1/approve', { method: 'POST', token: cpu, body: { cycleYear } });
  assert.equal(programmeApprove.status, 200);

  const universityDraft = await api.request('/api/plans/university', {
    method: 'PUT', token: cpu,
    body: { cycleYear, narrative: 'University plan narrative.', targets: 'Achieve the university-wide outcomes.' },
  });
  assert.equal(universityDraft.status, 200);
  const universitySubmit = await api.request('/api/plans/university/submit', { method: 'POST', token: cpu, body: { cycleYear } });
  assert.equal(universitySubmit.status, 200);
  const councilReject = await api.request('/api/plans/university/approve', { method: 'POST', token: council, body: { cycleYear } });
  assert.equal(councilReject.status, 403);
  const universityApprove = await api.request('/api/plans/university/approve', { method: 'POST', token: cpu, body: { cycleYear } });
  assert.equal(universityApprove.status, 200);
});
