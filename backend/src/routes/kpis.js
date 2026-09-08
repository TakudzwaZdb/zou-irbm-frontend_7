const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { canReadKpi } = require('../utils/scope');

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
  return !!db.prepare('SELECT 1 FROM kpi_assignments WHERE kpi_id = ? AND individual_id = ? AND deleted_at IS NULL').get(kpi.id, user.scope_id);
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

// Is this user the tier ABOVE this KPI's owner (i.e. can approve/return it)?
// Every tier is single-stage, one real approver, straight to 'approved':
// Individual-owned by their Unit Head, Unit-owned by their Sub-programme
// Rep, and Sub-owned by that Sub-programme's own Programme Head — the same
// shape all the way up. A sub-owned KPI used to pass through a second CPU
// sign-off stage after the Programme Head ('programme_approved', an
// intermediate status); that's been removed by deliberate request — the
// Programme Head's own approval is now final, and CPU has no approval role
// in this cascade at all. See db.js's one-time migration for any row still
// sitting at the retired 'programme_approved' status from before this
// change, and POST /:id/approve below for where the cumulative value is
// actually computed (now at the Programme Head's approval, for a sub-owned
// KPI, exactly like every other tier's one true approval).
function isApprover(user, kpi) {
  if (kpi.owner_type === 'individual') {
    return user.role === 'unithead' && user.scope_id === individualUnitId(kpi.owner_id);
  }
  if (kpi.owner_type === 'unit') {
    return user.role === 'rep' && user.scope_id === unitSubId(kpi.owner_id);
  }
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
  // Excludes soft-removed KPIs (deleted_at set — see DELETE /:id below) from
  // every action route that resolves a KPI by id: a removed KPI's history
  // stays in the database, but it can't be edited, valued, approved, or
  // otherwise acted on again until it's restored.
  const kpi = db.prepare('SELECT * FROM kpis WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
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
  if (row.status !== 'submitted') return row;
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
function recomputeUnitTotal(kpiId, year, month, userId) {
  const hasAssignees = db.prepare('SELECT 1 FROM kpi_assignments WHERE kpi_id = ? AND deleted_at IS NULL').get(kpiId);
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
  // This month's total just changed (or was set for the first time) — walk
  // every later period forward and correct any that were chained off the
  // old figure. See cascadeRecomputeForward below for why this matters even
  // for a period that isn't formally "approved" yet: an automated KPI's
  // value is a real, live-displayed number the moment any contribution is
  // approved, and previousOfficialValue treats it as a real link in the
  // chain regardless of status.
  cascadeRecomputeForward(kpiId, year, month, userId);
}

// The forward half of the cumulative engine, and the fix for a real,
// confirmed gap: recomputeUnitTotal and POST :id/approve both correctly set
// THIS period's own official value from whatever the chain looked like at
// the moment they ran — but until this function existed, nothing ever
// revisited a LATER period that had already built its own value on top of
// this one. Amend and re-approve an old month, and every later approved
// month silently kept its stale total forever, along with every RAG/
// variance/rollup figure built on it — reproduced live during this app's
// correctness audit (Jan 100→300 left Feb frozen at the old 150 instead of
// the correct 350).
//
// This walks forward chronologically from the period that just changed and
// rebuilds each later period from the exact same rule that produced it in
// the first place: previousOfficialValue (itself now correct, since we're
// walking in order — its own DB query always sees whatever this loop just
// wrote) plus that period's own already-recorded contribution — entered_value
// for a directly-entered KPI, or a fresh sum of that period's own approved
// contributions for an automated one (never read back from a total that
// might itself have been stale). A period whose recomputed total doesn't
// actually change is left untouched — no audit noise, no unnecessary write.
// An already-approved directly-entered period's status is deliberately
// never reverted here (unlike a fresh amendment via PUT :id/value): the
// figure is corrected in place and logged as a system correction, not
// silently un-approved out from under whoever signed off on it. A period
// still mid-amendment (non-automated, value non-null but status no longer
// 'approved') is skipped — its own upcoming re-approval will call
// previousOfficialValue itself at that time and pick up the right base
// automatically, so touching it early here would be redundant.
function cascadeRecomputeForward(kpiId, year, month, userId) {
  const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
  if (!kpi) return;
  const laterRows = db.prepare(
    `SELECT * FROM kpi_values WHERE kpi_id = ? AND value IS NOT NULL
     AND (year > ? OR (year = ? AND month > ?))
     ORDER BY year ASC, month ASC`
  ).all(kpiId, year, year, month);

  for (const period of laterRows) {
    if (!kpi.is_automated && period.status !== 'approved') continue;

    const base = previousOfficialValue(kpiId, period.year, period.month, kpi.baseline);
    let newValue;
    if (kpi.is_automated) {
      const contributions = db.prepare(
        "SELECT value FROM kpi_contributions WHERE kpi_id = ? AND year = ? AND month = ? AND status = 'approved'"
      ).all(kpiId, period.year, period.month);
      // Nothing approved for this period any more — recomputeUnitTotal
      // would already have nulled its value itself when that happened, so
      // a non-null row here with no approved contributions shouldn't occur;
      // skip rather than guess if it somehow does.
      if (contributions.length === 0) continue;
      newValue = base + contributions.reduce((s, r) => s + Number(r.value || 0), 0);
    } else {
      newValue = base + Number(period.entered_value || 0);
    }
    if (newValue === period.value) continue;

    const oldValue = period.value;
    db.prepare('UPDATE kpi_values SET value = ? WHERE id = ?').run(newValue, period.id);
    db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      userId || null, 'cascade_recompute', 'kpi', kpiId,
      `${period.year}-${String(period.month).padStart(2, '0')} automatically recalculated from ${oldValue} to ${newValue} — an earlier period it was built on top of just changed.`
    );
    // period.value written above now feeds the NEXT iteration's
    // previousOfficialValue lookup (a fresh query, not a cached figure),
    // so the chain stays correct all the way forward even when several
    // periods in a row need correcting.
  }
}

// ---- routes ---------------------------------------------------------------

router.get('/', (req, res) => {
  // Soft-removed KPIs (deleted_at set — see DELETE /:id below) drop out of
  // every active list — data entry, KPI Management's catalogue, ownership
  // lookups — without their recorded values ever being destroyed.
  //
  // Scope-filtered by canReadKpi (see utils/scope.js): a signed-in account
  // only ever sees KPIs within its own branch of the org tree (or all of
  // them, for the global oversight roles) — closing the gap where this used
  // to hand back every KPI in the university to anyone with a valid login,
  // regardless of what the UI would actually show them.
  const kpis = db.prepare('SELECT * FROM kpis WHERE deleted_at IS NULL ORDER BY id').all()
    .filter((kpi) => canReadKpi(req.user, kpi));
  res.json({ kpis });
});

// ---- bulk data entry -------------------------------------------------
// Powers a single-table "My Data Entry" UI: capture every KPI's figure
// once and submit once, instead of one PUT + one POST per KPI card. Each
// row is re-validated against the real database and this caller's real
// ownership — exactly the same checks PUT /:id/value and POST /:id/submit
// already make one row at a time (isOwner is re-derived here per KPI, not
// trusted from whatever the client's selection claims) — fully up front,
// before anything is written. Either every row in the batch is written, or
// (on the first invalid one) none are — a single db.transaction, so a
// partial batch is never left for the caller to reconcile by hand.
//
// Registered here, right after the collection-level GET /, and deliberately
// BEFORE every /:id route below — Express matches routes in registration
// order, and a plain string route like '/bulk-value' would otherwise be
// swallowed by an earlier, more general '/:id' pattern (id="bulk-value"),
// hitting the wrong handler with the wrong permission check entirely. Found
// live in this session's own testing before it ever reached a user: a call
// here returned "Missing permission: create_kpi" — PUT /:id's own check —
// instead of ever running this route's body.
router.put('/bulk-value', requirePerm('data_entry'), (req, res) => {
  const { year, month, entries } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries must be a non-empty array of { id, value }.' });
  }

  const prepared = [];
  for (const entry of entries) {
    const kpiId = Number(entry?.id);
    if (!kpiId) return res.status(400).json({ error: 'Each entry needs a numeric KPI id.' });
    const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
    if (!kpi) return res.status(404).json({ error: `KPI #${kpiId} not found.` });
    if (!isOwner(req.user, kpi)) return res.status(403).json({ error: `You can only enter data for KPIs you own (KPI #${kpiId}).` });
    // An automated (shared/contribution-summed) KPI's own value comes from
    // approved team contributions, not direct entry — same distinction the
    // frontend's table only ever offers an editable cell for a non-shared
    // row for; this is the server-side backstop against a stale or crafted
    // payload trying to bulk-write one anyway.
    if (kpi.is_automated) return res.status(400).json({ error: `"${kpi.name}" is automated — its value comes from team contributions, not direct entry.` });
    const value = entry.value;
    if (value != null && !Number.isFinite(Number(value))) {
      return res.status(400).json({ error: `Value for "${kpi.name}" must be a number.` });
    }
    prepared.push({ kpi, value: value == null ? null : Number(value) });
  }

  const applyAll = db.transaction(() => {
    const results = [];
    for (const { kpi, value } of prepared) {
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
        `${year}-${String(month).padStart(2, '0')} entry set to ${value} (bulk save, ${prepared.length} KPI${prepared.length > 1 ? 's' : ''} in this batch)${wasApproved ? ' — amendment on a previously approved period, returned to submitted.' : '.'}`
      );
      results.push(db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month));
    }
    return results;
  });

  res.json({ values: applyAll() });
});

router.post('/bulk-submit', requirePerm('data_entry'), (req, res) => {
  const { year, month, ids } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array of KPI ids.' });
  }

  const prepared = [];
  for (const rawId of ids) {
    const kpiId = Number(rawId);
    if (!kpiId) return res.status(400).json({ error: 'Each id must be numeric.' });
    const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
    if (!kpi) return res.status(404).json({ error: `KPI #${kpiId} not found.` });
    if (!isOwner(req.user, kpi)) return res.status(403).json({ error: `You can only submit KPIs you own (KPI #${kpiId}).` });
    const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
    if (!row) return res.status(404).json({ error: `No value recorded for "${kpi.name}" for that period yet.` });
    // Same distinction POST /:id/submit already makes: an automated KPI is
    // gated on `value` (recomputeUnitTotal fills it from approved team
    // contributions), every directly-entered KPI on `entered_value`.
    const missing = kpi.is_automated ? row.value == null : row.entered_value == null;
    if (missing) return res.status(400).json({ error: `Enter a value before submitting "${kpi.name}".` });
    prepared.push({ kpi, row });
  }

  const applyAll = db.transaction(() => {
    for (const { kpi, row } of prepared) {
      db.prepare('UPDATE kpi_values SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
      db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id, 'submit', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} submitted for review (bulk submit, ${prepared.length} KPI${prepared.length > 1 ? 's' : ''} in this batch).`
      );
    }
    return prepared.length;
  });

  res.json({ ok: true, submitted: applyAll() });
});

router.get('/:id/values', (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!canReadKpi(req.user, kpi)) return res.status(403).json({ error: 'That KPI is outside your scope.' });
  const rows = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? ORDER BY year, month').all(kpi.id);
  res.json({ values: rows.map(attachPreview) });
});

// Small in-request cache: values-by-period reads join back to `kpis` purely
// to scope-check each row, and the same handful of KPI rows gets looked up
// over and over across a batch — cheap at this app's size, but no reason to
// re-query the same id twice in one response.
function readableKpiIds(user) {
  const kpis = db.prepare('SELECT * FROM kpis').all(); // deliberately unfiltered by deleted_at — a value row for an already-removed KPI still needs its scope checked the same way
  const allowed = new Set();
  kpis.forEach((kpi) => { if (canReadKpi(user, kpi)) allowed.add(kpi.id); });
  return allowed;
}

// Batch read for a single period across all KPIs — used by the "My Data
// Entry" / "Approvals Queue" / "Reviews" pages to avoid one request per KPI.
// attachPreview is what lets an approver actually see a submitted figure's
// projected score before they act on it, rather than a blank "no data" —
// see attachPreview's own comment above for why that gap existed at all.
//
// Scope-filtered the same way as GET / (see canReadKpi in utils/scope.js):
// this used to hand back every KPI's figure for the period to any signed-in
// account, including ones for KPIs well outside their own branch.
router.get('/values', (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year and month query params are required.' });
  const allowed = readableKpiIds(req.user);
  const rows = db.prepare('SELECT * FROM kpi_values WHERE year = ? AND month = ?').all(year, month)
    .filter((row) => allowed.has(row.kpi_id));
  res.json({ values: rows.map(attachPreview) });
});

// A range read across several months in one year — used by the quarterly /
// bi-annual / annual performance views, which report on the LATEST value
// available within the range rather than requiring a value for every month
// (data entry itself stays monthly; this is only a read-side rollup lens).
router.get('/values-range', (req, res) => {
  const year = Number(req.query.year), fromMonth = Number(req.query.fromMonth), toMonth = Number(req.query.toMonth);
  if (!year || !fromMonth || !toMonth) return res.status(400).json({ error: 'year, fromMonth, and toMonth query params are required.' });
  const allowed = readableKpiIds(req.user);
  const rows = db.prepare('SELECT * FROM kpi_values WHERE year = ? AND month BETWEEN ? AND ? ORDER BY month').all(year, fromMonth, toMonth)
    .filter((row) => allowed.has(row.kpi_id));
  res.json({ values: rows });
});

// Every current assignment, system-wide — small enough to serve whole and
// let the frontend narrow it per-unit/per-individual, the same pattern
// GET /org already uses for the org tree.
router.get('/assignments', (req, res) => {
  // Soft-removed assignments (deleted_at set — see DELETE /:id/assign/:individualId
  // below) drop out of the active list without who-assigned-whom-and-when
  // ever being destroyed.
  const allowed = readableKpiIds(req.user);
  const assignments = db.prepare('SELECT * FROM kpi_assignments WHERE deleted_at IS NULL ORDER BY id').all()
    .filter((a) => allowed.has(a.kpi_id));
  res.json({ assignments });
});

// Delegate this Unit-owned KPI to an Individual within that same unit.
// Unit Head only, and only for their own unit's KPI and their own unit's
// people — see isUnitHeadOwner above. If this exact pairing was assigned
// before and later unassigned, that row still exists (deleted_at stamped,
// not deleted — see the DELETE route below) and the UNIQUE(kpi_id,
// individual_id) constraint means a plain INSERT would collide with it, so
// this restores that row instead of inserting a duplicate — same
// restore-over-insert care every other re-creation-after-removal in this
// app takes.
router.post('/:id/assign', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'Only the Unit Head who owns this KPI can assign it.' });
  const { individualId } = req.body || {};
  if (!individualId) return res.status(400).json({ error: 'individualId is required.' });
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ?').get(individualId);
  if (!individual || individual.unit_id !== kpi.owner_id) {
    return res.status(400).json({ error: 'That person is not in this unit.' });
  }

  const existing = db.prepare('SELECT * FROM kpi_assignments WHERE kpi_id = ? AND individual_id = ?').get(kpi.id, individualId);
  if (existing) {
    db.prepare(
      "UPDATE kpi_assignments SET deleted_at = NULL, assigned_by = ?, assigned_at = datetime('now') WHERE id = ?"
    ).run(req.user.id, existing.id);
  } else {
    db.prepare('INSERT INTO kpi_assignments (kpi_id, individual_id, assigned_by) VALUES (?, ?, ?)').run(kpi.id, individualId, req.user.id);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'assign_kpi', 'kpi', kpi.id, `Assigned "${kpi.name}" to ${individual.name} (${individual.role_title}).`
  );
  res.status(201).json({ ok: true });
});

// Nothing is deleted — deleted_at stamped, same as every other removal in
// this app, so who was assigned, by whom, and when is never lost, and
// re-assigning the same person (POST above) restores this exact row.
router.delete('/:id/assign/:individualId', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'Only the Unit Head who owns this KPI can unassign it.' });
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ?').get(req.params.individualId);

  db.prepare(
    "UPDATE kpi_assignments SET deleted_at = datetime('now') WHERE kpi_id = ? AND individual_id = ? AND deleted_at IS NULL"
  ).run(kpi.id, req.params.individualId);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'unassign_kpi', 'kpi', kpi.id, `Unassigned "${kpi.name}" from ${individual ? individual.name : `individual #${req.params.individualId}`}. Re-assigning them restores this.`
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
  const allowed = readableKpiIds(req.user);
  const contributions = db.prepare('SELECT * FROM kpi_contributions WHERE year = ? AND month = ?').all(year, month)
    .filter((c) => allowed.has(c.kpi_id));
  res.json({ contributions });
});

// An assigned Individual sets/updates their OWN figure toward a shared
// Unit-owned KPI — never the KPI's own kpi_values row (see isOwner above).
router.put('/:id/contribution', requirePerm('data_entry'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!isAssignedIndividual(req.user, kpi)) return res.status(403).json({ error: 'You are not assigned to contribute to this KPI.' });
  const { year, month, value } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  if (value != null && !Number.isFinite(Number(value))) {
    return res.status(400).json({ error: 'value must be a number.' });
  }

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
  recomputeUnitTotal(kpi.id, year, month, req.user.id);
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
  recomputeUnitTotal(kpi.id, year, month, req.user.id);
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
  recomputeUnitTotal(kpi.id, year, month, req.user.id);
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

// Removes a KPI — stamped deleted_at, never a real SQL DELETE. Its recorded
// values, assignments, contributions, and template link all stay exactly as
// they were (nothing here references kpis(id) ON DELETE CASCADE anymore in
// practice, since the kpis row itself is never actually gone) — a removed
// KPI's whole performance history remains genuinely intact and traceable,
// not just summarized in an audit_log line. Fully reversible: POST
// /:id/restore below clears the stamp and the KPI reappears everywhere
// exactly as it was, values and all.
router.delete('/:id', requirePerm('create_kpi'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  if (!inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });

  db.prepare("UPDATE kpis SET deleted_at = datetime('now') WHERE id = ?").run(kpi.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_kpi', 'kpi', kpi.id,
    `KPI "${kpi.name}" (owner: ${kpi.owner_type} #${kpi.owner_id}) removed. Its recorded values are kept and it's recoverable from Recently Removed.`
  );
  res.json({ ok: true });
});

// Recently-removed KPIs — the same "Recently Removed" idea routes/org.js's
// GET /api/org/removed already provides for the org structure, scoped to
// this create_kpi holder's own jurisdiction so a Unit Head only sees KPIs
// they could actually restore.
router.get('/removed', requirePerm('create_kpi'), (req, res) => {
  const rows = db.prepare("SELECT * FROM kpis WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all();
  res.json({ kpis: rows.filter((k) => inJurisdiction(req.user, k)) });
});

// Restore a previously-removed KPI — clears deleted_at and it reappears in
// every active list/lookup exactly as it was, values and all.
router.post('/:id/restore', requirePerm('create_kpi'), (req, res) => {
  const kpi = db.prepare('SELECT * FROM kpis WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!kpi) return res.status(404).json({ error: 'Removed KPI not found.' });
  if (!inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });

  db.prepare('UPDATE kpis SET deleted_at = NULL WHERE id = ?').run(kpi.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_kpi', 'kpi', kpi.id, `KPI "${kpi.name}" restored.`
  );
  res.json({ kpi: db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
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
  // A cleared/blank entry (still drafting) is fine — anything actually
  // supplied must be a real finite number, not a string, array, object, or
  // NaN/Infinity smuggled through as JSON, since this becomes a real figure
  // in every RAG/variance/rollup calculation that reads it.
  if (value != null && !Number.isFinite(Number(value))) {
    return res.status(400).json({ error: 'value must be a number.' });
  }

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
  // Single stage, every tier alike: 'submitted' is the only pending status
  // now (see isApprover's own comment above for why the old sub-owned
  // 'programme_approved' intermediate stage was retired).
  const pendingStatuses = ['submitted'];
  if (!row || !pendingStatuses.includes(row.status)) return res.status(400).json({ error: 'Nothing pending review for that period.' });
  if (!isApprover(req.user, kpi)) return res.status(403).json({ error: 'You are not the approver for this KPI.' });

  // This is where "current performance" actually becomes official — the
  // one true approval for every tier alike, including a sub-owned KPI now
  // approved directly and finally by its Programme Head (no further CPU
  // stage). This is where the automated cumulative-addition actually
  // happens (see previousOfficialValue above): the newly-approved figure
  // is added to whatever this KPI's official total already was as of the
  // most recent earlier period, so "current performance" always reads as
  // a real running total. An automated (shared) KPI's own row skips this —
  // recomputeUnitTotal already applied the exact same rule the moment its
  // contributions were approved.
  let detail = `${year}-${String(month).padStart(2, '0')} approved.`;
  if (!kpi.is_automated) {
    const base = previousOfficialValue(kpi.id, Number(year), Number(month), kpi.baseline);
    const newValue = base + Number(row.entered_value);
    db.prepare('UPDATE kpi_values SET value = ?, status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(newValue, row.id);
    detail = `${year}-${String(month).padStart(2, '0')} approved: ${row.entered_value} added to the previous total of ${base} → ${newValue}.`;
    // This is exactly the "amend an old period, re-approve it" moment the
    // correctness audit flagged — this period's own total may have just
    // changed (a first-time approval, or a corrected re-approval), so walk
    // every later already-approved period forward and fix any that were
    // built on top of the old figure. See cascadeRecomputeForward above.
    cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
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
  const pendingStatuses = ['submitted'];
  if (!row || !pendingStatuses.includes(row.status)) return res.status(400).json({ error: 'Nothing pending review for that period.' });
  if (!isApprover(req.user, kpi)) return res.status(403).json({ error: 'You are not the approver for this KPI.' });

  // A return always goes all the way back to whoever actually owns the
  // data as a plain draft with the reviewer's comment attached — the same
  // rule every other return in this app already follows (never bounced to
  // an intermediate reviewer to pass along; there is no intermediate stage
  // in this cascade any more).
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

  // A fresh override supersedes any earlier one that was cleared and left
  // sitting in the _cleared shadow columns below — that shadow is a "restore
  // what I just cleared" target, not a permanent log, so it's retired the
  // moment a genuinely new override is applied over it.
  db.prepare(
    'UPDATE kpi_values SET override_value = ?, override_note = ?, override_cleared_value = NULL, override_cleared_note = NULL, override_cleared_at = NULL WHERE id = ?'
  ).run(value, note, row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} overridden to ${value}. Note: "${note}"`
  );
  // previousOfficialValue prefers override_value over value whenever both
  // exist, so this new override just changed what every LATER period's base
  // resolves to — walk them forward the same as any other change to this
  // period's effective figure.
  cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
  res.json({ ok: true });
});

// Clearing an override never destroys it: the live value/note move into
// override_cleared_value/override_cleared_note (stamped override_cleared_at)
// before being nulled, so POST /:id/override/restore below can put them
// straight back — the same shadow-and-restore shape every deletion in this
// app uses, just scoped to one field pair on an existing row instead of a
// whole entity, since there's no separate row here to stamp deleted_at on.
router.delete('/:id/override', requirePerm('apply_override'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  const { year, month } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period.' });
  if (row.override_value == null) return res.status(400).json({ error: 'There is no active override for that period.' });
  db.prepare(
    "UPDATE kpi_values SET override_cleared_value = override_value, override_cleared_note = override_note, override_cleared_at = datetime('now'), override_value = NULL, override_note = NULL WHERE id = ?"
  ).run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override_clear', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} override removed (was ${row.override_value}, "${row.override_note}"). Nothing is deleted — it's recoverable.`
  );
  // This period's effective figure just fell back from override_value to
  // its plain computed value — every later period's base needs the same
  // forward walk as any other change here.
  cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
  res.json({ ok: true });
});

// Restore a just-cleared override — copies override_cleared_value/note back
// onto the live fields and clears the shadow, undoing exactly what the
// DELETE above just did. Requires a clean slate (no live override already
// in place) so it never silently clobbers a genuinely new one someone
// applied since — same invariant a Programme/Individual restore keeps by
// only ever restoring into a normal, non-conflicting active state.
router.post('/:id/override/restore', requirePerm('apply_override'), (req, res) => {
  const kpi = getKpiOr404(req, res); if (!kpi) return;
  const { year, month } = req.body || {};
  const row = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period.' });
  if (row.override_cleared_at == null) return res.status(404).json({ error: 'No recently-cleared override to restore for that period.' });
  if (row.override_value != null) return res.status(400).json({ error: 'There is already an active override for that period — clear it first.' });
  db.prepare(
    'UPDATE kpi_values SET override_value = override_cleared_value, override_note = override_cleared_note, override_cleared_value = NULL, override_cleared_note = NULL, override_cleared_at = NULL WHERE id = ?'
  ).run(row.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override_restore', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} override restored to ${row.override_cleared_value}.`
  );
  // Same reasoning as applying a fresh override — this period's effective
  // figure just changed again, so later periods need re-walking forward.
  cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
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
