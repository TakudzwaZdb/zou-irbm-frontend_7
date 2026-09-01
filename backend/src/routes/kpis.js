const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ---- scope helpers -------------------------------------------------------
// These are what make permission checks real rather than cosmetic: every
// mutating endpoint below re-derives the KPI's owning chain from the
// database and checks it against req.user's own role/scope, never trusting
// anything the client claims about "whose KPI this is".

function unitSubId(unitId) {
  const row = db.prepare('SELECT sub_id FROM units WHERE id = ?').get(unitId);
  return row ? row.sub_id : null;
}
function individualUnitId(individualId) {
  const row = db.prepare('SELECT unit_id FROM individuals WHERE id = ?').get(individualId);
  return row ? row.unit_id : null;
}
function kpiSubId(kpi) {
  if (kpi.owner_type === 'sub') return kpi.owner_id;
  if (kpi.owner_type === 'unit') return unitSubId(kpi.owner_id);
  return unitSubId(individualUnitId(kpi.owner_id));
}

// Has this Individual been assigned this specific Unit-owned KPI by their
// Unit Head (see the kpi_assignments table / POST :id/assign below)? This is
// what lets a staff member enter & submit data for one of their unit's KPIs
// — "one of their duties" — without becoming its owner: approval still goes
// to the Sub-programme Rep exactly as if the Unit Head had entered it.
function isAssignedIndividual(user, kpi) {
  if (kpi.owner_type !== 'unit' || user.role !== 'individual') return false;
  return !!db.prepare('SELECT 1 FROM kpi_assignments WHERE kpi_id = ? AND individual_id = ?').get(kpi.id, user.scope_id);
}

// Does this user directly own (enter data for) this KPI's own official
// value? An assigned Individual is NOT an owner of the shared Unit value
// any more (see kpi_contributions below) — they own their own contribution
// row instead, entered/submitted through the /contribution endpoints, and
// reviewed by their Unit Head before it ever reaches this KPI's real value.
function isOwner(user, kpi) {
  if (kpi.owner_type === 'sub') return user.role === 'rep' && user.scope_id === kpi.owner_id;
  if (kpi.owner_type === 'unit') return user.role === 'unithead' && user.scope_id === kpi.owner_id;
  return user.role === 'individual' && user.scope_id === kpi.owner_id;
}

// Is this user the Unit Head who owns this Unit-scoped KPI? (The only person
// allowed to assign/unassign it to someone in their unit.)
function isUnitHeadOwner(user, kpi) {
  return user.role === 'unithead' && kpi.owner_type === 'unit' && user.scope_id === kpi.owner_id;
}

// Is this user the tier ABOVE this KPI's owner (i.e. can approve/return it)
// AT ITS CURRENT STAGE? `status` matters only for a sub-owned KPI, which
// now passes through two real approval stages rather than one: the Sub
// Rep's own Programme Head reviews it first (while it's 'submitted'), and
// only once THEY approve — moving it to 'programme_approved' — does it
// reach CPU for the real, final sign-off (see POST /:id/approve below,
// which is also where the automated cumulative value actually gets
// computed, deliberately only at that last step). Individual- and
// Unit-owned KPIs are unaffected — still one approver, one stage, exactly
// as before — since the caller always passes the row's current status.
function isApprover(user, kpi, status) {
  if (kpi.owner_type === 'individual') {
    return user.role === 'unithead' && user.scope_id === individualUnitId(kpi.owner_id);
  }
  if (kpi.owner_type === 'unit') {
    return user.role === 'rep' && user.scope_id === unitSubId(kpi.owner_id);
  }
  // sub-owned KPIs: Programme Head first (at 'submitted'), CPU last (at
  // 'programme_approved') — CPU is also the fallback approver when status
  // is unknown/omitted, so any caller that doesn't pass a status (there are
  // none left, but this keeps the function safe to call defensively) still
  // gets a sensible, non-crashing answer.
  if (status === 'programme_approved') return user.role === 'cpu';
  const programmeId = db.prepare('SELECT programme_id FROM subs WHERE id = ?').get(kpi.owner_id)?.programme_id;
  return user.role === 'programme' && programmeId != null && user.scope_id === programmeId;
}

// Is this KPI within a role-scoped user's jurisdiction at all (for edit_targets,
// which a Sub Rep or Unit Head might be granted for "their own patch")?
// Global roles (cpu/ictadmin/exec) are never restricted by this check.
function inJurisdiction(user, kpi) {
  if (['cpu', 'ictadmin', 'exec'].includes(user.role)) return true;
  if (user.role === 'rep') return kpiSubId(kpi) === user.scope_id;
  if (user.role === 'unithead') {
    if (kpi.owner_type === 'unit') return kpi.owner_id === user.scope_id;
    if (kpi.owner_type === 'individual') return individualUnitId(kpi.owner_id) === user.scope_id;
    return false;
  }
  if (user.role === 'individual') return kpi.owner_type === 'individual' && kpi.owner_id === user.scope_id;
  return false;
}

function getKpiOr404(req, res) {
  const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(req.params.id);
  if (!kpi) { res.status(404).json({ error: 'KPI not found.' }); return null; }
  return kpi;
}

// The automated cumulative-performance engine, in one place: "what was this
// KPI's official total as of the most recent period BEFORE this one?" —
// real chronological order (December of last year counts as "before"
// January of this one), skipping over any period that was never actually
// approved (its value is still NULL), all the way back if it has to. A KPI
// with no approved period at all yet starts from its own baseline — the
// same number the monthly pace tracker already treats as "where this KPI
// started" (see lib/scope.js's assumedMonthlyBaseline on the frontend).
// override_value wins over value when both are set, matching every other
// reader of a kpi_values row (computeRag, the pace tracker, Reports).
function previousOfficialValue(kpiId, year, month, baseline) {
  const row = db.prepare(
    `SELECT value, override_value FROM kpi_values
     WHERE kpi_id = ? AND value IS NOT NULL AND (year < ? OR (year = ? AND month < ?))
     ORDER BY year DESC, month DESC LIMIT 1`
  ).get(kpiId, year, year, month);
  if (!row) return baseline;
  return row.override_value != null ? row.override_value : row.value;
}

// A submitted-but-not-yet-approved row's own `value` is deliberately still
// NULL — it only ever becomes the KPI's real official figure at final
// approval (see POST :id/approve above) — so whoever is reviewing it would
// otherwise see a completely blank "Current" figure and score, with nothing
// to actually judge the submission against before they approve or return
// it. This attaches a read-only `preview_value` — never stored, recomputed
// fresh on every read, and never trusted for anything real — showing what
// the official cumulative total WOULD become if this exact submission were
// approved as-is: previousOfficialValue + entered_value, the identical math
// POST :id/approve itself uses. Automated (shared/contribution-summed)
// KPIs are deliberately excluded: their `value` is already kept live by
// recomputeUnitTotal the moment any contribution is approved, well before
// the KPI's own tier-above approval, so there's already a real figure to
// show — nothing to preview.
function attachPreview(row) {
  if (!row || row.value != null || row.entered_value == null) return row;
  if (!['submitted', 'programme_approved'].includes(row.status)) return row;
  const kpi = db.prepare('SELECT baseline, is_automated FROM kpis WHERE id = ?').get(row.kpi_id);
  if (!kpi || kpi.is_automated) return row;
  const base = previousOfficialValue(row.kpi_id, row.year, row.month, kpi.baseline);
  return { ...row, preview_value: base + Number(row.entered_value) };
}

// The automated heart of the shared-KPI feature: whenever a contribution is
// approved, changed after approval, or returned, recompute this KPI's own
// official value for that period as the SUM of every currently-approved
// contribution — this is "the overall score of that KPI", built from real
// approved numbers, never a guess. A KPI with no assignees at all is
// untouched (this only ever runs for KPIs someone has actually assigned).
// Once a KPI has been through this once it's permanently marked automated
// (matching the existing is_automated/override mechanism everywhere else in
// the app), so a Sub-programme Rep can still hand-override the computed
// total if a real-world correction is ever needed. This never submits or
// approves the Unit's own value on anyone's behalf — the Unit Head still
// has to explicitly review and click Submit, same as any other Unit KPI,
// which is what sends it on to the Sub-programme Rep.
function recomputeUnitTotal(kpiId, year, month) {
  const hasAssignees = db.prepare('SELECT 1 FROM kpi_assignments WHERE kpi_id = ?').get(kpiId);
  if (!hasAssignees) return;
  const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
  const rows = db.prepare(
    "SELECT value FROM kpi_contributions WHERE kpi_id = ? AND year = ? AND month = ? AND status = 'approved'"
  ).all(kpiId, year, month);
  const anyApproved = rows.length > 0;
  // Each contributor's own figure is that person's contribution FOR THIS
  // MONTH ALONE (never a running total they'd have to track themselves) —
  // summing them gives this month's total contribution, which then gets
  // added to the Unit's own previous month's official figure below, the
  // exact same automated cumulative rule a directly-owned KPI gets at its
  // own approval (see previousOfficialValue / POST :id/approve).
  const periodTotal = anyApproved ? rows.reduce((s, r) => s + Number(r.value || 0), 0) : null;
  const sum = periodTotal != null ? previousOfficialValue(kpiId, year, month, kpi.baseline) + periodTotal : null;

  db.prepare('UPDATE kpis SET is_automated = 1 WHERE id = ? AND is_automated = 0').run(kpiId);

  const existing = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpiId, year, month);
  if (existing) {
    const wasApproved = existing.status === 'approved';
    // Same amendment rule as a manual edit in PUT /:id/value: if the Rep had
    // already approved this period and the computed total just changed
    // underneath them, it goes back to "submitted" so they re-review the
    // new number rather than an approval silently going stale.
    db.prepare('UPDATE kpi_values SET value = ?, status = ? WHERE id = ?')
      .run(sum, wasApproved ? 'submitted' : existing.status, existing.id);
  } else {
    db.prepare('INSERT INTO kpi_values (kpi_id, year, month, value, status) VALUES (?, ?, ?, ?, \'draft\')').run(kpiId, year, month, sum);
  }
}

// ---- routes ---------------------------------------------------------------

router.get('/', (req, res) => {
  res.json({ kpis: db.prepare('SELECT * FROM kpis ORDER BY id').all() });
});

router.get('/:id/values', (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  const rows = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? ORDER BY year, month').all(kpi.id);
  res.json({ values: rows.map(attachPreview) });
});

// Batch read for a single period across all KPIs — used by the "My Data
// Entry" / "Approvals Queue" / "Reviews" pages to avoid one request per KPI.
// attachPreview is what lets an approver actually see a submitted figure's
// projected score before they act on it, rather than a blank "no data" —
// see attachPreview's own comment above for why that gap existed at all.
router.get('/values', (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year and month query params are required.' });
  const rows = db.prepare('SELECT * FROM kpi_values WHERE year = ? AND month = ?').all(year, month);
  res.json({ values: rows.map(attachPreview) });
});

// A range read across several months in one year — used by the quarterly /
// bi-annual / annual performance views, which report on the LATEST value
// available within the range rather than requiring a value for every month
// (data entry itself stays monthly; this is only a read-side rollup lens).
router.get('/values-range', (req, res) => {
  const year = Number(req.query.year), fromMonth = Number(req.query.fromMonth), toMonth = Number(req.query.toMonth);
  if (!year || !fromMonth || !toMonth) return res.status(400).json({ error: 'year, fromMonth, and toMonth query params are required.' });
  const rows = db.prepare('SELECT * FROM kpi_values WHERE year = ? AND month BETWEEN ? AND ? ORDER BY month').all(year, fromMonth, toMonth);
  res.json({ values: rows });
});

// Every current assignment, system-wide — small enough to serve whole and
// let the frontend narrow it per-unit/per-individual, the same pattern
// GET /org already uses for the org tree.
router.get('/assignments', (req, res) => {
  res.json({ assignments: db.prepare('SELECT * FROM kpi_assignments ORDER BY id').all() });
});

// Delegate this Unit-owned KPI to an Individual within that same unit.
// Unit Head only, and only for their own unit's KPI and their own unit's
// people — see isUnitHeadOwner above.
router.post('/:id/assign', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'Only the Unit Head who owns this KPI can assign it.' });
  const { individualId } = req.body || {};
  if (!individualId) return res.status(400).json({ error: 'individualId is required.' });
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ?').get(individualId);
  if (!individual || individual.unit_id !== kpi.owner_id) {
    return res.status(400).json({ error: 'That person is not in this unit.' });
  }

  db.prepare('INSERT OR IGNORE INTO kpi_assignments (kpi_id, individual_id, assigned_by) VALUES (?, ?, ?)').run(kpi.id, individualId, req.user.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'assign_kpi', 'kpi', kpi.id, `Assigned "${kpi.name}" to ${individual.name} (${individual.role_title}).`
  );
  res.status(201).json({ ok: true });
});

router.delete('/:id/assign/:individualId', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'Only the Unit Head who owns this KPI can unassign it.' });
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ?').get(req.params.individualId);

  db.prepare('DELETE FROM kpi_assignments WHERE kpi_id = ? AND individual_id = ?').run(kpi.id, req.params.individualId);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'unassign_kpi', 'kpi', kpi.id, `Unassigned "${kpi.name}" from ${individual ? individual.name : `individual #${req.params.individualId}`}.`
  );
  res.json({ ok: true });
});

// NOTE: an Individual browsing-and-self-claiming a Unit-owned KPI (the
// previous POST/DELETE :id/claim here) has been removed in favor of
// routes/kpiTemplates.js's Unit-scoped KPI template pool: an Individual
// should only ever be offered KPIs genuinely created for individuals (see
// that file), never their whole Unit's own aggregate KPI. A Unit Head can
// still explicitly delegate one of their Unit's KPIs to a specific person
// via POST/DELETE :id/assign above — that's a duty assigned TO someone by
// their Unit Head, not something the person found by browsing and helped
// themselves to.

// Batch read for a single period across every KPI's contributions — same
// shape/purpose as GET /values above, so My Data Entry (an Individual's own
// contributions), Approvals (a Unit Head's pending contributor reviews),
// and KpiCard (the per-contributor breakdown on a shared KPI) can each load
// what they need in one request instead of one per KPI.
router.get('/contributions', (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year and month query params are required.' });
  res.json({ contributions: db.prepare('SELECT * FROM kpi_contributions WHERE year = ? AND month = ?').all(year, month) });
});

// An assigned Individual sets/updates their OWN figure toward a shared
// Unit-owned KPI — never the KPI's own kpi_values row (see isOwner above).
router.put('/:id/contribution', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isAssignedIndividual(req.user, kpi)) return res.status(403).json({ error: 'You are not assigned to contribute to this KPI.' });
  const { year, month, value } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });

  const existing = db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND individual_id = ? AND year = ? AND month = ?')
    .get(kpi.id, req.user.scope_id, year, month);
  const wasApproved = existing && existing.status === 'approved';
  if (existing) {
    db.prepare(
      `UPDATE kpi_contributions SET value = ?, status = ?, submitted_at = CASE WHEN ? THEN datetime('now') ELSE submitted_at END
       WHERE id = ?`
    ).run(value, wasApproved ? 'submitted' : existing.status, wasApproved ? 1 : 0, existing.id);
  } else {
    db.prepare('INSERT INTO kpi_contributions (kpi_id, individual_id, year, month, value) VALUES (?, ?, ?, ?, ?)')
      .run(kpi.id, req.user.scope_id, year, month, value);
  }
  recomputeUnitTotal(kpi.id, year, month);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, wasApproved ? 'amend_contribution' : 'enter_contribution', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} contribution set to ${value}${wasApproved ? ' (amendment on a previously approved contribution — returned to submitted).' : '.'}`
  );
  res.json({ contribution: db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND individual_id = ? AND year = ? AND month = ?').get(kpi.id, req.user.scope_id, year, month) });
});

router.put('/:id/contribution/explanation', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isAssignedIndividual(req.user, kpi)) return res.status(403).json({ error: 'You are not assigned to contribute to this KPI.' });
  const { year, month, text } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND individual_id = ? AND year = ? AND month = ?').get(kpi.id, req.user.scope_id, year, month);
  if (!row) return res.status(404).json({ error: 'No contribution recorded for that period yet.' });
  db.prepare('UPDATE kpi_contributions SET explanation = ? WHERE id = ?').run(text || null, row.id);
  res.json({ ok: true });
});

router.post('/:id/contribution/submit', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isAssignedIndividual(req.user, kpi)) return res.status(403).json({ error: 'You are not assigned to contribute to this KPI.' });
  const { year, month } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND individual_id = ? AND year = ? AND month = ?').get(kpi.id, req.user.scope_id, year, month);
  if (!row) return res.status(404).json({ error: 'No contribution recorded for that period yet.' });
  if (row.value == null) return res.status(400).json({ error: 'Enter a value before submitting.' });

  db.prepare('UPDATE kpi_contributions SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_contribution', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} contribution submitted to Unit Head for review.`
  );
  res.json({ ok: true });
});

// The Unit Head who owns this shared KPI approves ONE contributor's
// submitted figure — this is the "individuals submit to their Unit Head for
// approval" step. Approving recomputes the KPI's own automated total (see
// recomputeUnitTotal) so it always reflects the real sum of what's actually
// been approved so far, never a stale or partial number.
router.post('/:id/contribution/:individualId/approve', requirePerm('approve_own_tier'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'You are not the approver for this contribution.' });
  const { year, month } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND individual_id = ? AND year = ? AND month = ?').get(kpi.id, req.params.individualId, year, month);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that period.' });

  db.prepare('UPDATE kpi_contributions SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  recomputeUnitTotal(kpi.id, year, month);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_contribution', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} contribution from individual #${req.params.individualId} approved.`
  );
  res.json({ ok: true });
});

router.post('/:id/contribution/:individualId/return', requirePerm('approve_own_tier'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'You are not the approver for this contribution.' });
  const { year, month, comment } = req.body || {};
  if (!comment) return res.status(400).json({ error: 'A reason is required when returning a submission.' });
  const row = db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND individual_id = ? AND year = ? AND month = ?').get(kpi.id, req.params.individualId, year, month);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that period.' });

  db.prepare('UPDATE kpi_contributions SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment, row.id);
  recomputeUnitTotal(kpi.id, year, month);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_contribution', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} contribution from individual #${req.params.individualId} returned: "${comment}"`
  );
  res.json({ ok: true });
});

// Creating a KPI for a Unit can also seed its initial custodian list in the
// same step — several people routinely need to be assigned to the same KPI
// (see kpi_contributions above), and making that a second, separate trip
// through "Assign to a team member" for each person was needless friction.
// Whoever is trusted to create the KPI in the first place is trusted to
// name its initial assignees too; ongoing add/remove after creation stays
// the Unit Head's own call via POST/DELETE :id/assign, unchanged.
router.post('/', requirePerm('create_kpi'), (req, res) => {
  const { ownerType, ownerId, name, type, measure, baseline, target, assigneeIds } = req.body || {};
  if (!ownerType || !ownerId || !name || !type || !measure || baseline == null || target == null) {
    return res.status(400).json({ error: 'ownerType, ownerId, name, type, measure, baseline, and target are all required.' });
  }
  if (!['sub', 'unit', 'individual'].includes(ownerType)) return res.status(400).json({ error: 'Invalid ownerType.' });

  const assignees = [...new Set((assigneeIds || []).map(Number))].filter(Boolean);
  if (assignees.length > 0) {
    if (ownerType !== 'unit') {
      return res.status(400).json({ error: 'Custodians can only be assigned to a Unit-owned KPI.' });
    }
    for (const iid of assignees) {
      const individual = db.prepare('SELECT * FROM individuals WHERE id = ?').get(iid);
      if (!individual || individual.unit_id !== Number(ownerId)) {
        return res.status(400).json({ error: `Individual #${iid} is not in this unit.` });
      }
    }
  }

  const createTxn = db.transaction(() => {
    const id = db
      .prepare('INSERT INTO kpis (owner_type, owner_id, name, type, measure, baseline, target) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ownerType, ownerId, name, type, measure, Number(baseline), Number(target)).lastInsertRowid;

    const now = new Date();
    db.prepare('INSERT INTO kpi_values (kpi_id, year, month, status) VALUES (?, ?, ?, \'draft\')').run(id, now.getFullYear(), now.getMonth() + 1);

    for (const iid of assignees) {
      db.prepare('INSERT OR IGNORE INTO kpi_assignments (kpi_id, individual_id, assigned_by) VALUES (?, ?, ?)').run(id, iid, req.user.id);
    }
    return id;
  });
  const id = createTxn();

  const assignNote = assignees.length ? ` Assigned to ${assignees.length} custodian(s) at creation.` : '';
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_kpi', 'kpi', id, `KPI "${name}" created (owner: ${ownerType} #${ownerId}, baseline ${baseline}, target ${target}).${assignNote}`
  );
  res.status(201).json({ kpi: db.prepare('SELECT * FROM kpis WHERE id = ?').get(id) });
});

router.patch('/:id/targets', requirePerm('edit_targets'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });
  const { baseline, target } = req.body || {};
  if (baseline == null || target == null) return res.status(400).json({ error: 'baseline and target are required.' });

  db.prepare('UPDATE kpis SET baseline = ?, target = ? WHERE id = ?').run(Number(baseline), Number(target), kpi.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'edit_targets', 'kpi', kpi.id, `Baseline ${kpi.baseline} → ${baseline}; Target ${kpi.target} → ${target}.`
  );
  res.json({ kpi: db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

// A fuller edit than PATCH :id/targets above — the KPI's actual definition
// (name/type/measure), not just its numbers. Gated by the same `create_kpi`
// permission that creates the catalog entry in the first place, one tier
// broader than `edit_targets` (which only ever touches baseline/target) —
// redefining what a KPI even measures is a bigger authority than adjusting
// its numbers. Ownership (owner_type/owner_id) is deliberately NOT editable
// here: moving a KPI to a different owner mid-cycle would strand its real
// approval history and any live assignments/contributions against an owner
// they were never actually recorded under — retiring it (delete) and
// creating a fresh one under the right owner is the honest way to do that.
router.put('/:id', requirePerm('create_kpi'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });
  const { name, type, measure, baseline, target } = req.body || {};
  if (!name || !type || !measure || baseline == null || target == null) {
    return res.status(400).json({ error: 'name, type, measure, baseline, and target are all required.' });
  }

  db.prepare('UPDATE kpis SET name = ?, type = ?, measure = ?, baseline = ?, target = ? WHERE id = ?')
    .run(name, type, measure, Number(baseline), Number(target), kpi.id);
  const changes = [];
  if (name !== kpi.name) changes.push(`name "${kpi.name}" → "${name}"`);
  if (type !== kpi.type) changes.push(`type "${kpi.type}" → "${type}"`);
  if (measure !== kpi.measure) changes.push(`measure "${kpi.measure}" → "${measure}"`);
  if (Number(baseline) !== kpi.baseline) changes.push(`baseline ${kpi.baseline} → ${baseline}`);
  if (Number(target) !== kpi.target) changes.push(`target ${kpi.target} → ${target}`);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'edit_kpi', 'kpi', kpi.id, changes.length ? `KPI updated: ${changes.join('; ')}.` : 'KPI saved with no changes.'
  );
  res.json({ kpi: db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

// Deletes a KPI outright — its recorded values, any assignments, and any
// contributions all cascade with it (kpi_values/kpi_assignments/
// kpi_contributions all reference kpis(id) ON DELETE CASCADE, see db.js).
// Past audit_log entries about this KPI are left exactly as the individual-
// removal route above already treats them: a real historical record of what
// happened, each entry self-contained (it already names the KPI in its own
// `detail` text), not tidied away just because the KPI itself is gone now.
router.delete('/:id', requirePerm('create_kpi'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });

  db.prepare('DELETE FROM kpis WHERE id = ?').run(kpi.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'delete_kpi', 'kpi', kpi.id,
    `KPI "${kpi.name}" (owner: ${kpi.owner_type} #${kpi.owner_id}) deleted, along with all its recorded values, assignments, and contributions.`
  );
  res.json({ ok: true });
});

// What gets typed here is THIS PERIOD'S OWN figure — never a running total
// the submitter has to calculate by hand — so it's stored in entered_value,
// never directly into value (the KPI's official cumulative figure; see
// db.js's note above this table). value is deliberately left untouched
// here, even on an amendment to an already-approved period: nothing about
// "the official current performance" changes until an approver actually
// re-approves it (see POST :id/approve below) — same principle a
// contributor's own kpi_contributions figure already worked on before this.
router.put('/:id/value', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isOwner(req.user, kpi)) return res.status(403).json({ error: 'You can only enter data for KPIs you own.' });
  const { year, month, value } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });

  const existing = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  const wasApproved = existing && existing.status === 'approved';
  if (existing) {
    db.prepare(
      `UPDATE kpi_values SET entered_value = ?, status = ?, submitted_at = CASE WHEN ? THEN datetime('now') ELSE submitted_at END
       WHERE id = ?`
    ).run(value, wasApproved ? 'submitted' : existing.status, wasApproved ? 1 : 0, existing.id);
  } else {
    db.prepare('INSERT INTO kpi_values (kpi_id, year, month, entered_value, status) VALUES (?, ?, ?, ?, \'draft\')').run(kpi.id, year, month, value);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, wasApproved ? 'amend_value' : 'enter_value', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} entry set to ${value}${wasApproved ? ' (amendment on a previously approved period — returned to submitted; the official total stays as last approved until this is re-approved).' : ' — added to the previous period once approved.'}`
  );
  res.json({ value: db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month) });
});

router.post('/:id/submit', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isOwner(req.user, kpi)) return res.status(403).json({ error: 'You can only submit KPIs you own.' });
  const { year, month } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period yet.' });
  // An automated (shared/contribution-summed) KPI's own row is never typed
  // into directly — its `value` is what recomputeUnitTotal already fills in
  // from approved contributions — so it's the one still gated on `value`
  // here; every directly-entered KPI (any owner tier) is gated on the
  // entered_value this route above actually writes to.
  const missing = kpi.is_automated ? row.value == null : row.entered_value == null;
  if (missing) return res.status(400).json({ error: 'Enter a value before submitting.' });

  db.prepare('UPDATE kpi_values SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} submitted for review.`
  );
  res.json({ ok: true });
});

// This is where "current performance" actually becomes official — the
// automated cumulative-addition moment the whole feature turns on. For a
// directly-entered KPI (any tier: Individual, Unit, or Sub-programme — same
// route, same rule every time), the newly-approved figure is never just
// dropped in on its own: it's added to whatever this KPI's official total
// already was as of the most recent earlier period (see
// previousOfficialValue), so "current performance" always reads as a real
// running total built up submission by submission. An automated (shared)
// KPI's own row skips this — recomputeUnitTotal already applied the exact
// same rule the moment its contributions were approved, so re-deriving it
// here from a null entered_value would wipe out a correct number.
router.post('/:id/approve', requirePerm('approve_own_tier'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  const { year, month } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  // A sub-owned KPI has two real pending stages ('submitted', then
  // 'programme_approved'); every other tier still has exactly one
  // ('submitted'). isApprover checks the CURRENT stage against this
  // caller's role/scope, so a Programme Head can only act while it's
  // 'submitted' and CPU only once it's already 'programme_approved' — one
  // cannot skip ahead of the other, and a 403 for anyone who tries.
  const pendingStatuses = kpi.owner_type === 'sub' ? ['submitted', 'programme_approved'] : ['submitted'];
  if (!row || !pendingStatuses.includes(row.status)) return res.status(400).json({ error: 'Nothing pending review for that period.' });
  if (!isApprover(req.user, kpi, row.status)) return res.status(403).json({ error: 'You are not the approver for this KPI.' });

  // Sub-owned KPI, first stage: the Programme Head's own sign-off — moves
  // it on to CPU, but is deliberately NOT the moment the cumulative value
  // gets computed. A Sub-programme's own performance figure only becomes
  // official once CPU has had the final say, exactly like every other
  // approval in this app is the one moment "official" changes — never
  // provisionally, on an intermediate reviewer's approval alone.
  if (kpi.owner_type === 'sub' && row.status === 'submitted') {
    db.prepare('UPDATE kpi_values SET status = \'programme_approved\', programme_approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
    db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id, 'programme_approve', 'kpi', kpi.id,
      `${year}-${String(month).padStart(2, '0')} approved by Programme Head — forwarded to CPU for final approval.`
    );
    return res.json({ ok: true });
  }

  // Final approval — either the one-and-only stage for an Individual/Unit-
  // owned KPI, or CPU's sign-off on a sub-owned KPI already approved by its
  // Programme Head. This is where the automated cumulative-addition
  // actually happens (see previousOfficialValue above): the newly-approved
  // figure is added to whatever this KPI's official total already was as
  // of the most recent earlier period, so "current performance" always
  // reads as a real running total. An automated (shared) KPI's own row
  // skips this — recomputeUnitTotal already applied the exact same rule
  // the moment its contributions were approved.
  let detail = `${year}-${String(month).padStart(2, '0')} approved.`;
  if (!kpi.is_automated) {
    const base = previousOfficialValue(kpi.id, Number(year), Number(month), kpi.baseline);
    const newValue = base + Number(row.entered_value);
    db.prepare('UPDATE kpi_values SET value = ?, status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(newValue, row.id);
    detail = `${year}-${String(month).padStart(2, '0')} approved: ${row.entered_value} added to the previous total of ${base} → ${newValue}.`;
  } else {
    db.prepare('UPDATE kpi_values SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve', 'kpi', kpi.id, detail
  );
  res.json({ ok: true });
});

router.post('/:id/return', requirePerm('approve_own_tier'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  const { year, month, comment } = req.body || {};
  if (!comment) return res.status(400).json({ error: 'A reason is required when returning a submission.' });
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  const pendingStatuses = kpi.owner_type === 'sub' ? ['submitted', 'programme_approved'] : ['submitted'];
  if (!row || !pendingStatuses.includes(row.status)) return res.status(400).json({ error: 'Nothing pending review for that period.' });
  if (!isApprover(req.user, kpi, row.status)) return res.status(403).json({ error: 'You are not the approver for this KPI.' });

  // A return — whether from the Programme Head's first stage or CPU's
  // final one — always goes all the way back to the Sub Rep as a plain
  // draft with the reviewer's comment attached, the same "back to whoever
  // actually owns the data" rule every other return in this app already
  // follows (never bounced to an intermediate reviewer to pass along).
  db.prepare('UPDATE kpi_values SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment, row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} returned: "${comment}"`
  );
  res.json({ ok: true });
});

router.post('/:id/override', requirePerm('apply_override'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!kpi.is_automated) return res.status(400).json({ error: 'Overrides only apply to automated KPIs.' });
  const { year, month, value, note } = req.body || {};
  if (value == null || !note) return res.status(400).json({ error: 'An override value and a note are both required.' });
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period yet.' });

  db.prepare('UPDATE kpi_values SET override_value = ?, override_note = ? WHERE id = ?').run(value, note, row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} overridden to ${value}. Note: "${note}"`
  );
  res.json({ ok: true });
});

router.delete('/:id/override', requirePerm('apply_override'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  const { year, month } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period.' });
  db.prepare('UPDATE kpi_values SET override_value = NULL, override_note = NULL WHERE id = ?').run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override_clear', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} override removed.`
  );
  res.json({ ok: true });
});

router.put('/:id/explanation', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isOwner(req.user, kpi)) return res.status(403).json({ error: 'You can only annotate KPIs you own.' });
  const { year, month, text } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period yet.' });
  db.prepare('UPDATE kpi_values SET explanation = ? WHERE id = ?').run(text || null, row.id);
  res.json({ ok: true });
});

// ---- personal "hide from my view" preference -----------------------------
// Deliberately open to any signed-in role — this never touches the KPI
// itself or anyone else's view, so there's no ownership/jurisdiction check
// to make: an individual, a Unit Head, a Sub-programme Rep, a Programme
// Head, CPU, exec — every tier can curate what they personally browse.
// requirePerm('data_entry') isn't right here (a role without it, e.g. exec,
// still browses Overview and should still be able to hide) — just
// requireAuth, already applied to the whole router above.

router.get('/hidden', (req, res) => {
  const rows = db.prepare('SELECT kpi_id FROM kpi_hidden WHERE user_id = ?').all(req.user.id);
  res.json({ hidden: rows.map((r) => r.kpi_id) });
});

router.post('/:id/hide', (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  db.prepare('INSERT OR IGNORE INTO kpi_hidden (user_id, kpi_id) VALUES (?, ?)').run(req.user.id, kpi.id);
  res.status(201).json({ ok: true });
});

router.delete('/:id/hide', (req, res) => {
  db.prepare('DELETE FROM kpi_hidden WHERE user_id = ? AND kpi_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
