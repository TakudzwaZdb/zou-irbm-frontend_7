// The annual planning & budget cycle: a real submission/approval cascade,
// structurally the same shape as the KPI one in kpis.js, but for a
// Unit/Department/Faculty/Region's next-cycle plan proposal — a narrative
// plus a requested budget figure — rolling up through Sub-programme and
// Programme to a single University Annual Plan that CPU compiles and
// submits. Only a Unit ever enters its own budget number; every tier above
// it is a live, computed sum of what's beneath it — never a separately
// typed-in figure — so the numbers can't drift from what units actually
// asked for.
const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm, requireAnyPerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function getRow(cycleYear, ownerType, ownerId) {
  if (ownerId == null) {
    return db.prepare('SELECT * FROM plan_proposals WHERE cycle_year = ? AND owner_type = ?').get(cycleYear, ownerType);
  }
  return db.prepare('SELECT * FROM plan_proposals WHERE cycle_year = ? AND owner_type = ? AND owner_id = ?').get(cycleYear, ownerType, ownerId);
}

function upsertDraft(cycleYear, ownerType, ownerId, fields) {
  const existing = getRow(cycleYear, ownerType, ownerId);
  if (existing) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE plan_proposals SET ${sets} WHERE id = ?`).run(...Object.values(fields), existing.id);
    return getRow(cycleYear, ownerType, ownerId);
  }
  const cols = ['cycle_year', 'owner_type', 'owner_id', ...Object.keys(fields)];
  const placeholders = cols.map(() => '?').join(', ');
  const id = db.prepare(`INSERT INTO plan_proposals (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(cycleYear, ownerType, ownerId, ...Object.values(fields)).lastInsertRowid;
  return db.prepare('SELECT * FROM plan_proposals WHERE id = ?').get(id);
}

function isUnitOwner(user, unitId) { return user.role === 'unithead' && user.scope_id === unitId; }
function isSubOwner(user, subId) { return user.role === 'rep' && user.scope_id === subId; }
function unitSubId(unitId) { return db.prepare('SELECT sub_id FROM units WHERE id = ?').get(unitId)?.sub_id; }
function subProgrammeId(subId) { return db.prepare('SELECT programme_id FROM subs WHERE id = ?').get(subId)?.programme_id; }
// A Programme Head's real, server-enforced scope check — same pattern as
// isUnitOwner/isSubOwner above: role AND scope_id must both match, never
// trusting programmes.head_user_id (display-only, like units.head_user_id /
// subs.rep_user_id elsewhere in this app).
function isProgrammeHeadOwner(user, programmeId) { return user.role === 'programme' && user.scope_id === programmeId; }

// ---- read: the whole compiled picture for one cycle year -----------------
router.get('/', (req, res) => {
  const cycleYear = Number(req.query.year);
  if (!cycleYear) return res.status(400).json({ error: 'year query param is required.' });

  const units = db.prepare('SELECT id, sub_id, name FROM units ORDER BY id').all().map((u) => ({
    ...u, proposal: getRow(cycleYear, 'unit', u.id) || null,
  }));

  const subs = db.prepare('SELECT id, programme_id, name FROM subs ORDER BY id').all().map((s) => {
    const myUnits = units.filter((u) => u.sub_id === s.id);
    const approvedBudget = myUnits.reduce((sum, u) => sum + (u.proposal?.status === 'approved' ? Number(u.proposal.budget || 0) : 0), 0);
    const provisionalBudget = myUnits.reduce((sum, u) => sum + (u.proposal && u.proposal.status !== 'draft' ? Number(u.proposal.budget || 0) : 0), 0);
    return {
      ...s, unitCount: myUnits.length, approvedBudget, provisionalBudget,
      proposal: getRow(cycleYear, 'sub', s.id) || null,
    };
  });

  const programmes = db.prepare('SELECT id, name FROM programmes ORDER BY id').all().map((p) => {
    const mySubs = subs.filter((s) => s.programme_id === p.id);
    const approvedBudget = mySubs.reduce((sum, s) => sum + s.approvedBudget, 0);
    const provisionalBudget = mySubs.reduce((sum, s) => sum + s.provisionalBudget, 0);
    return {
      ...p, subCount: mySubs.length, approvedBudget, provisionalBudget,
      proposal: getRow(cycleYear, 'programme', p.id) || null,
    };
  });

  const universityApprovedBudget = programmes.reduce((sum, p) => sum + p.approvedBudget, 0);
  const universityProvisionalBudget = programmes.reduce((sum, p) => sum + p.provisionalBudget, 0);

  res.json({
    cycleYear, units, subs, programmes,
    university: {
      approvedBudget: universityApprovedBudget, provisionalBudget: universityProvisionalBudget,
      proposal: getRow(cycleYear, 'university', null) || null,
    },
  });
});

// ---- Unit tier: enter/submit, Sub Rep approves/returns --------------------
router.put('/units/:unitId', requirePerm('data_entry'), (req, res) => {
  const unitId = Number(req.params.unitId);
  if (!isUnitOwner(req.user, unitId)) return res.status(403).json({ error: 'You can only edit your own unit\'s plan proposal.' });
  const { cycleYear, narrative, budget } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const existing = getRow(cycleYear, 'unit', unitId);
  if (existing && existing.status !== 'draft') return res.status(400).json({ error: 'This proposal is locked while submitted or approved — ask your Sub-programme Rep to return it first.' });
  const row = upsertDraft(cycleYear, 'unit', unitId, { narrative: narrative || null, budget: budget == null ? null : Number(budget), status: 'draft' });
  res.json({ proposal: row });
});

router.post('/units/:unitId/submit', requirePerm('data_entry'), (req, res) => {
  const unitId = Number(req.params.unitId);
  if (!isUnitOwner(req.user, unitId)) return res.status(403).json({ error: 'You can only submit your own unit\'s plan proposal.' });
  const { cycleYear } = req.body || {};
  const row = getRow(cycleYear, 'unit', unitId);
  if (!row || row.budget == null) return res.status(400).json({ error: 'Enter a narrative and budget before submitting.' });
  db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_plan', 'plan_proposal', row.id, `Unit plan proposal for ${cycleYear} submitted (budget ${row.budget}).`
  );
  res.json({ ok: true });
});

router.post('/units/:unitId/approve', requirePerm('approve_own_tier'), (req, res) => {
  const unitId = Number(req.params.unitId);
  if (!isSubOwner(req.user, unitSubId(unitId))) return res.status(403).json({ error: 'You are not the approver for this unit.' });
  const { cycleYear } = req.body || {};
  const row = getRow(cycleYear, 'unit', unitId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_plan', 'plan_proposal', row.id, `Unit plan proposal for ${cycleYear} approved.`
  );
  res.json({ ok: true });
});

router.post('/units/:unitId/return', requirePerm('approve_own_tier'), (req, res) => {
  const unitId = Number(req.params.unitId);
  if (!isSubOwner(req.user, unitSubId(unitId))) return res.status(403).json({ error: 'You are not the approver for this unit.' });
  const { cycleYear, comment } = req.body || {};
  if (!comment) return res.status(400).json({ error: 'A reason is required when returning a proposal.' });
  const row = getRow(cycleYear, 'unit', unitId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment, row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_plan', 'plan_proposal', row.id, `Unit plan proposal for ${cycleYear} returned: "${comment}"`
  );
  res.json({ ok: true });
});

// ---- Sub-programme tier: narrative only — its budget is always the sum of
// its units above, never entered here — submitted by the Rep, approved by CPU
router.put('/subs/:subId', requirePerm('data_entry'), (req, res) => {
  const subId = Number(req.params.subId);
  if (!isSubOwner(req.user, subId)) return res.status(403).json({ error: 'You can only edit your own sub-programme\'s plan proposal.' });
  const { cycleYear, narrative } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const existing = getRow(cycleYear, 'sub', subId);
  if (existing && existing.status !== 'draft') return res.status(400).json({ error: 'This proposal is locked while submitted or approved — ask CPU to return it first.' });
  const row = upsertDraft(cycleYear, 'sub', subId, { narrative: narrative || null, status: 'draft' });
  res.json({ proposal: row });
});

router.post('/subs/:subId/submit', requirePerm('data_entry'), (req, res) => {
  const subId = Number(req.params.subId);
  if (!isSubOwner(req.user, subId)) return res.status(403).json({ error: 'You can only submit your own sub-programme\'s plan proposal.' });
  const { cycleYear } = req.body || {};
  const row = getRow(cycleYear, 'sub', subId);
  if (!row || !row.narrative) return res.status(400).json({ error: 'Enter a planning narrative before submitting.' });
  db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_plan', 'plan_proposal', row.id, `Sub-programme plan proposal for ${cycleYear} submitted.`
  );
  res.json({ ok: true });
});

router.post('/subs/:subId/approve', requireAnyPerm('approve_own_tier', 'data_entry'), (req, res) => {
  const subId = Number(req.params.subId);
  // Approved either by CPU (org-wide oversight, unchanged) or by the
  // Programme Head who owns the Programme this Sub-programme sits under —
  // a real, scope-checked authority, not a role label alone.
  if (req.user.role !== 'cpu' && !isProgrammeHeadOwner(req.user, subProgrammeId(subId))) {
    return res.status(403).json({ error: 'Only CPU or your Programme Head approves Sub-programme plan proposals.' });
  }
  const { cycleYear } = req.body || {};
  const row = getRow(cycleYear, 'sub', subId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_plan', 'plan_proposal', row.id, `Sub-programme plan proposal for ${cycleYear} approved.`
  );
  res.json({ ok: true });
});

router.post('/subs/:subId/return', requireAnyPerm('approve_own_tier', 'data_entry'), (req, res) => {
  const subId = Number(req.params.subId);
  if (req.user.role !== 'cpu' && !isProgrammeHeadOwner(req.user, subProgrammeId(subId))) {
    return res.status(403).json({ error: 'Only CPU or your Programme Head returns Sub-programme plan proposals.' });
  }
  const { cycleYear, comment } = req.body || {};
  if (!comment) return res.status(400).json({ error: 'A reason is required when returning a proposal.' });
  const row = getRow(cycleYear, 'sub', subId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment, row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_plan', 'plan_proposal', row.id, `Sub-programme plan proposal for ${cycleYear} returned: "${comment}"`
  );
  res.json({ ok: true });
});

// ---- Programme tier: the Programme Head's own compiled narrative, budget
// always derived. Historically there was no separate Programme Head login,
// so CPU stood in for this tier — CPU still can (org-wide oversight, same
// as the Sub-programme tier above), but a real Programme Head now compiles
// and submits their own Programme's plan, scope-checked exactly like every
// other tier in this cascade.
router.put('/programmes/:programmeId', requireAnyPerm('approve_own_tier', 'data_entry'), (req, res) => {
  const programmeId = Number(req.params.programmeId);
  if (req.user.role !== 'cpu' && !isProgrammeHeadOwner(req.user, programmeId)) {
    return res.status(403).json({ error: 'Only CPU or this Programme\'s own Programme Head compiles its plan.' });
  }
  const { cycleYear, narrative } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = upsertDraft(cycleYear, 'programme', programmeId, { narrative: narrative || null, status: 'draft' });
  res.json({ proposal: row });
});

router.post('/programmes/:programmeId/submit', requireAnyPerm('approve_own_tier', 'data_entry'), (req, res) => {
  const programmeId = Number(req.params.programmeId);
  if (req.user.role !== 'cpu' && !isProgrammeHeadOwner(req.user, programmeId)) {
    return res.status(403).json({ error: 'Only CPU or this Programme\'s own Programme Head submits its plan.' });
  }
  const { cycleYear } = req.body || {};
  const row = getRow(cycleYear, 'programme', programmeId);
  if (!row || !row.narrative) return res.status(400).json({ error: 'Enter a planning narrative before submitting.' });
  db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\') WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_plan', 'plan_proposal', row.id, `Programme plan for ${cycleYear} submitted.`
  );
  res.json({ ok: true });
});

// ---- University tier: CPU compiles and submits the whole annual plan,
// the University Council validates and approves (or returns) it — only a
// Council approval actually puts it into effect for the cycle. Same
// draft/submitted/approved shape as every other tier's cascade, and now the
// same "locked while under review" rule the Unit/Sub tiers already enforce
// (previously this route had no such guard at all, which meant CPU could
// silently overwrite even an already-Council-approved, in-effect plan).
router.put('/university', requirePerm('submit_annual_plan'), (req, res) => {
  const { cycleYear, narrative } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const existing = getRow(cycleYear, 'university', null);
  if (existing && existing.status !== 'draft') {
    return res.status(400).json({ error: 'This plan is locked while submitted or approved — ask the University Council to return it first.' });
  }
  const row = upsertDraft(cycleYear, 'university', null, { narrative: narrative || null, status: 'draft' });
  res.json({ proposal: row });
});

router.post('/university/submit', requirePerm('submit_annual_plan'), (req, res) => {
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = getRow(cycleYear, 'university', null);
  if (!row || !row.narrative) return res.status(400).json({ error: 'Enter the compiled annual-plan narrative before submitting.' });
  if (row.status !== 'draft') return res.status(400).json({ error: 'This plan has already been submitted to the University Council.' });
  db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_annual_plan', 'plan_proposal', row.id, `University Annual Plan for ${cycleYear} submitted to the University Council for validation.`
  );
  res.json({ ok: true });
});

// The one gate that puts an Annual Plan into effect: the University
// Council validates the compiled plan AND the structure it was built from
// (every Programme's own compiled position, which is what GET /plans
// already exposes in full to a Council reviewer — same data, same numbers,
// nothing recomputed specially for this) and either approves it — final,
// official for the cycle — or returns it to CPU with a reason, exactly
// like every return elsewhere in this app.
router.post('/university/approve', requirePerm('validate_annual_plan'), (req, res) => {
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = getRow(cycleYear, 'university', null);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending the University Council\'s review for that cycle.' });
  db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_annual_plan', 'plan_proposal', row.id, `University Annual Plan for ${cycleYear} validated and approved by the University Council — now in effect.`
  );
  res.json({ ok: true });
});

router.post('/university/return', requirePerm('validate_annual_plan'), (req, res) => {
  const { cycleYear, comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'A reason is required when returning the plan.' });
  const row = getRow(cycleYear, 'university', null);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending the University Council\'s review for that cycle.' });
  db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment.trim(), row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_annual_plan', 'plan_proposal', row.id, `University Annual Plan for ${cycleYear} returned by the University Council: "${comment.trim()}"`
  );
  res.json({ ok: true });
});

module.exports = router;
