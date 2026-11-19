// The annual planning & budget cycle: a real submission/approval cascade,
// structurally the same shape as the KPI one in kpis.js, but for a
// Unit/Department/Faculty/Region's next-cycle plan proposals. A scoped
// submitter can create multiple named plans, each with a narrative, budget
// and/or measurable targets; CPU reviews them individually or in batches.
// The University Annual Plan remains a separate CPU-compiled proposal.
const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm, requireAnyPerm } = require('../middleware/auth');
const { isGlobalReader, canReadUnit, canReadSub, canReadProgramme } = require('../utils/scope');

const router = express.Router();
router.use(requireAuth);

async function getRow(cycleYear, ownerType, ownerId) {
  if (ownerId == null) {
    return await db.prepare('SELECT * FROM plan_proposals WHERE cycle_year = ? AND owner_type = ? ORDER BY id').get(cycleYear, ownerType);
  }
  return await db.prepare('SELECT * FROM plan_proposals WHERE cycle_year = ? AND owner_type = ? AND owner_id = ? ORDER BY id').get(cycleYear, ownerType, ownerId);
}

async function getRows(cycleYear, ownerType, ownerId) {
  let rows;
  if (ownerId == null) {
    rows = await db.prepare('SELECT * FROM plan_proposals WHERE cycle_year = ? AND owner_type = ? ORDER BY id').all(cycleYear, ownerType);
  } else {
    rows = await db.prepare('SELECT * FROM plan_proposals WHERE cycle_year = ? AND owner_type = ? AND owner_id = ? ORDER BY id').all(cycleYear, ownerType, ownerId);
  }
  return rows.map((row) => ({
    ...row,
    plan_title: row.plan_title || `${ownerType[0].toUpperCase()}${ownerType.slice(1)} plan ${row.id}`,
  }));
}

// Every call site below passes a fixed object literal (e.g. { narrative,
// budget, status }) — never req.body directly — so `fields`'s keys are
// never attacker-controlled today. Still, since those keys become raw SQL
// column names a few lines down (Object.keys(fields).map(k => `${k} = ?`)),
// this whitelist is what keeps that true even if a future call site is
// ever careless enough to pass request data straight through (see
// SECURITY_REVIEW.md's SQL-injection note on this function).
const UPSERT_DRAFT_ALLOWED_FIELDS = new Set(['narrative', 'budget', 'targets', 'status']);

async function upsertDraft(cycleYear, ownerType, ownerId, fields) {
  const badKeys = Object.keys(fields).filter((k) => !UPSERT_DRAFT_ALLOWED_FIELDS.has(k));
  if (badKeys.length) throw new Error(`upsertDraft: unexpected field(s): ${badKeys.join(', ')}`);
  const existing = await getRow(cycleYear, ownerType, ownerId);
  if (existing) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
    await db.prepare(`UPDATE plan_proposals SET ${sets} WHERE id = ?`).run(...Object.values(fields), existing.id);
    return await getRow(cycleYear, ownerType, ownerId);
  }
  const cols = ['cycle_year', 'owner_type', 'owner_id', ...Object.keys(fields)];
  const placeholders = cols.map(() => '?').join(', ');
  const { lastInsertRowid: id } = await db.prepare(`INSERT INTO plan_proposals (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(cycleYear, ownerType, ownerId, ...Object.values(fields));
  return await db.prepare('SELECT * FROM plan_proposals WHERE id = ?').get(id);
}

function validPlanText(...values) {
  return values.every((value) => value == null || typeof value === 'string');
}
function cleanPlanText(value) {
  return typeof value === 'string' ? value.trim() || null : null;
}
function hasPlanText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function httpError(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  return error;
}

function assignedScopeType(user) {
  return user.scope_type || ({
    programme: 'programme',
    rep: 'sub',
    unithead: 'unit',
  })[user.role] || null;
}
function canSubmitScopedPlan(user, ownerType, ownerId) {
  return user.permissions?.includes('submit_plan_budget')
    && assignedScopeType(user) === ownerType
    && user.scope_id === ownerId;
}
function isUnitOwner(user, unitId) {
  return (user.role === 'unithead' && assignedScopeType(user) === 'unit' && user.scope_id === unitId)
    || canSubmitScopedPlan(user, 'unit', unitId);
}
function isSubOwner(user, subId) {
  return (user.role === 'rep' && assignedScopeType(user) === 'sub' && user.scope_id === subId)
    || canSubmitScopedPlan(user, 'sub', subId);
}
// A Programme Head's real, server-enforced scope check — same pattern as
// isUnitOwner/isSubOwner above: role AND scope_id must both match, never
// trusting programmes.head_user_id (display-only, like units.head_user_id /
// subs.rep_user_id elsewhere in this app).
function isProgrammeHeadOwner(user, programmeId) {
  return (user.role === 'programme' && assignedScopeType(user) === 'programme' && user.scope_id === programmeId)
    || canSubmitScopedPlan(user, 'programme', programmeId);
}

function canManagePlanOwner(user, ownerType, ownerId) {
  if (ownerType === 'unit') return isUnitOwner(user, ownerId);
  if (ownerType === 'sub') return isSubOwner(user, ownerId);
  if (ownerType === 'programme') return isProgrammeHeadOwner(user, ownerId);
  return false;
}

function parsePlanItem(item, requireSubmit = false) {
  const planTitle = cleanPlanText(item?.planTitle);
  const narrative = cleanPlanText(item?.narrative);
  const targets = cleanPlanText(item?.targets);
  const budget = item?.budget == null || item.budget === '' ? null : Number(item.budget);

  if (!planTitle) throw httpError(400, 'Each plan needs a title.');
  if (!validPlanText(item?.narrative, item?.targets)) throw httpError(400, 'Plan narrative and targets must be text.');
  if (budget != null && (!Number.isFinite(budget) || budget < 0)) {
    throw httpError(400, 'Budget must be a non-negative number.');
  }
  if (requireSubmit && !hasPlanText(narrative)) {
    throw httpError(400, `Add a narrative to "${planTitle}" before submitting.`);
  }
  if (requireSubmit && budget == null && !hasPlanText(targets)) {
    throw httpError(400, `Add a budget or measurable targets to "${planTitle}" before submitting.`);
  }
  return { planTitle, narrative, targets, budget };
}

function parseItemIds(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'Select at least one plan.');
  }
  const ids = items.map((item) => Number(item?.id));
  if (ids.some((id) => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw httpError(400, 'Plan selection contains an invalid or duplicate ID.');
  }
  return ids;
}

async function loadEditableItem(user, itemId, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const row = await db.prepare(`SELECT * FROM plan_proposals WHERE id = ?${suffix}`).get(itemId);
  if (!row) throw httpError(404, 'Plan not found.');
  if (!canManagePlanOwner(user, row.owner_type, row.owner_id)) {
    throw httpError(403, 'You can only manage plans belonging to your assigned organisation scope.');
  }
  if (row.status !== 'draft') throw httpError(409, 'Only draft plans can be changed or submitted.');
  return row;
}

async function hasBudgetOrTargets(cycleYear, ownerType, ownerId, proposal) {
  if (proposal.budget != null) return true;
  if (hasPlanText(proposal.targets)) return true;
  if (ownerType === 'unit') return false;

  let query;
  let params;
  if (ownerType === 'sub') {
    query = `
      SELECT 1 FROM units u
      JOIN plan_proposals p ON p.owner_type = 'unit' AND p.owner_id = u.id AND p.cycle_year = ?
      WHERE u.sub_id = ? AND u.deleted_at IS NULL AND p.budget IS NOT NULL
      LIMIT 1
    `;
    params = [cycleYear, ownerId];
  } else if (ownerType === 'programme') {
    query = `
      SELECT 1 FROM units u
      JOIN subs s ON s.id = u.sub_id AND s.deleted_at IS NULL
      JOIN plan_proposals p ON p.owner_type = 'unit' AND p.owner_id = u.id AND p.cycle_year = ?
      WHERE s.programme_id = ? AND u.deleted_at IS NULL AND p.budget IS NOT NULL
      LIMIT 1
    `;
    params = [cycleYear, ownerId];
  } else if (ownerType === 'university') {
    query = `
      SELECT 1 FROM plan_proposals p
      WHERE p.cycle_year = ? AND p.budget IS NOT NULL
        AND (
          (p.owner_type = 'unit' AND EXISTS (SELECT 1 FROM units u WHERE u.id = p.owner_id AND u.deleted_at IS NULL))
          OR (p.owner_type = 'sub' AND EXISTS (SELECT 1 FROM subs s WHERE s.id = p.owner_id AND s.deleted_at IS NULL))
          OR (p.owner_type = 'programme' AND EXISTS (SELECT 1 FROM programmes pg WHERE pg.id = p.owner_id AND pg.deleted_at IS NULL))
        )
      LIMIT 1
    `;
    params = [cycleYear];
  } else {
    return false;
  }
  return Boolean(await db.prepare(query).get(...params));
}

async function canSubmitProposal(cycleYear, ownerType, ownerId, proposal) {
  return hasPlanText(proposal?.narrative)
    && await hasBudgetOrTargets(cycleYear, ownerType, ownerId, proposal);
}

router.get('/pending', async (req, res) => {
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may view pending plan approvals.' });
  const proposals = await db.prepare(`
    SELECT p.id, p.cycle_year, p.owner_type, p.owner_id,
      COALESCE(NULLIF(p.plan_title, ''), 'Plan ' || p.id) AS plan_title,
      p.narrative, p.targets, p.budget, p.submitted_at,
      CASE p.owner_type
        WHEN 'unit' THEN COALESCE(u.name, 'Unit')
        WHEN 'sub' THEN COALESCE(s.name, 'Sub-programme')
        WHEN 'programme' THEN COALESCE(pg.name, 'Programme')
        ELSE 'University Annual Plan'
      END AS owner_name
    FROM plan_proposals p
    LEFT JOIN units u ON p.owner_type = 'unit' AND p.owner_id = u.id
    LEFT JOIN subs s ON p.owner_type = 'sub' AND p.owner_id = s.id
    LEFT JOIN programmes pg ON p.owner_type = 'programme' AND p.owner_id = pg.id
    WHERE p.status = 'submitted'
    ORDER BY p.submitted_at DESC, p.id DESC
  `).all();
  res.json({ proposals });
});

router.post('/items', requireAnyPerm('data_entry', 'approve_own_tier'), async (req, res) => {
  const { cycleYear, ownerType, ownerId: rawOwnerId } = req.body || {};
  const ownerId = Number(rawOwnerId);
  if (!Number.isInteger(cycleYear) || cycleYear < 1) return res.status(400).json({ error: 'A valid cycleYear is required.' });
  if (!['unit', 'sub', 'programme'].includes(ownerType) || !Number.isInteger(ownerId) || ownerId < 1) {
    return res.status(400).json({ error: 'A valid plan owner is required.' });
  }
  if (!canManagePlanOwner(req.user, ownerType, ownerId)) {
    return res.status(403).json({ error: 'You can only add plans within your assigned organisation scope.' });
  }
  const fields = parsePlanItem(req.body || {});
  const { lastInsertRowid: id } = await db.prepare(`
    INSERT INTO plan_proposals (cycle_year, owner_type, owner_id, plan_title, narrative, targets, budget, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(cycleYear, ownerType, ownerId, fields.planTitle, fields.narrative, fields.targets, fields.budget);
  const proposal = await db.prepare('SELECT * FROM plan_proposals WHERE id = ?').get(id);
  res.status(201).json({ proposal });
});

router.put('/items/drafts', requireAnyPerm('data_entry', 'approve_own_tier'), async (req, res) => {
  const { items } = req.body || {};
  let ids;
  try { ids = parseItemIds(items); } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    throw error;
  }
  try {
    await db.transaction(async () => {
      let batchOwner = null;
      for (let index = 0; index < items.length; index += 1) {
        const row = await loadEditableItem(req.user, ids[index], true);
        const owner = `${row.owner_type}:${row.owner_id}:${row.cycle_year}`;
        if (batchOwner && owner !== batchOwner) {
          throw httpError(400, 'Save selected plans from the same organisation and cycle together.');
        }
        batchOwner = owner;
        const fields = parsePlanItem(items[index]);
        await db.prepare(`
          UPDATE plan_proposals
          SET plan_title = ?, narrative = ?, targets = ?, budget = ?
          WHERE id = ? AND status = 'draft'
        `).run(fields.planTitle, fields.narrative, fields.targets, fields.budget, row.id);
      }
    })();
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    throw error;
  }
  res.json({ ok: true, saved: ids.length });
});

router.post('/items/submit', requireAnyPerm('data_entry', 'approve_own_tier', 'submit_plan_budget'), async (req, res) => {
  const { items } = req.body || {};
  let ids;
  try { ids = parseItemIds(items); } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    throw error;
  }
  const canEditDrafts = req.user.permissions?.includes('data_entry') || req.user.permissions?.includes('approve_own_tier');
  try {
    await db.transaction(async () => {
      let batchOwner = null;
      for (let index = 0; index < items.length; index += 1) {
        const row = await loadEditableItem(req.user, ids[index], true);
        const owner = `${row.owner_type}:${row.owner_id}:${row.cycle_year}`;
        if (batchOwner && owner !== batchOwner) {
          throw httpError(400, 'Submit selected plans from the same organisation and cycle together.');
        }
        batchOwner = owner;
        const fields = canEditDrafts
          ? parsePlanItem(items[index], true)
          : parsePlanItem({
            planTitle: row.plan_title || `Plan ${row.id}`,
            narrative: row.narrative,
            targets: row.targets,
            budget: row.budget,
          }, true);
        const result = canEditDrafts
          ? await db.prepare(`
            UPDATE plan_proposals
            SET plan_title = ?, narrative = ?, targets = ?, budget = ?,
                status = 'submitted', submitted_at = datetime('now'), approved_at = NULL, return_comment = NULL
            WHERE id = ? AND status = 'draft'
          `).run(fields.planTitle, fields.narrative, fields.targets, fields.budget, row.id)
          : await db.prepare(`
            UPDATE plan_proposals
            SET status = 'submitted', submitted_at = datetime('now'), approved_at = NULL, return_comment = NULL
            WHERE id = ? AND status = 'draft'
          `).run(row.id);
        if (!result.changes) throw httpError(409, `Plan "${fields.planTitle}" is no longer a draft.`);
        await db.prepare(`
          INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
          VALUES (?, 'submit_plan', 'plan_proposal', ?, ?)
        `).run(req.user.id, row.id, `${row.owner_type} plan "${fields.planTitle}" for ${row.cycle_year} submitted to CPU.`);
      }
    })();
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    throw error;
  }
  res.json({ ok: true, submitted: ids.length });
});

router.delete('/items/:id', requireAnyPerm('data_entry', 'approve_own_tier'), async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId < 1) return res.status(400).json({ error: 'Invalid plan ID.' });
  try {
    const row = await loadEditableItem(req.user, itemId);
    await db.prepare('DELETE FROM plan_proposals WHERE id = ? AND status = \'draft\'').run(row.id);
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    throw error;
  }
  res.json({ ok: true });
});

router.post('/items/approve', requirePerm('approve_annual_plan'), async (req, res) => {
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may approve annual plan and budget proposals.' });
  let ids;
  const proposalIds = Array.isArray(req.body?.proposalIds) ? req.body.proposalIds.map((id) => ({ id })) : req.body?.proposalIds;
  try { ids = parseItemIds(proposalIds); } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    throw error;
  }
  try {
    await db.transaction(async () => {
      for (const id of ids) {
        const row = await db.prepare('SELECT * FROM plan_proposals WHERE id = ? FOR UPDATE').get(id);
        if (!row || row.status !== 'submitted') {
          throw httpError(409, 'All selected plans must still be awaiting CPU approval.');
        }
        await db.prepare(`
          UPDATE plan_proposals SET status = 'approved', approved_at = datetime('now')
          WHERE id = ? AND status = 'submitted'
        `).run(row.id);
        await db.prepare(`
          INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
          VALUES (?, 'approve_annual_plan', 'plan_proposal', ?, ?)
        `).run(req.user.id, row.id, `${row.owner_type} plan "${row.plan_title}" approved by CPU.`);
      }
    })();
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
    throw error;
  }
  res.json({ ok: true, approved: ids.length });
});

router.post('/items/:id/approve', requirePerm('approve_annual_plan'), async (req, res) => {
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may approve annual plan and budget proposals.' });
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId < 1) return res.status(400).json({ error: 'Invalid plan ID.' });
  const row = await db.prepare('SELECT * FROM plan_proposals WHERE id = ?').get(itemId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending CPU review for this plan.' });
  await db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  await db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
    VALUES (?, 'approve_annual_plan', 'plan_proposal', ?, ?)
  `).run(req.user.id, row.id, `${row.owner_type} plan "${row.plan_title}" approved by CPU.`);
  res.json({ ok: true });
});

router.post('/items/:id/return', requirePerm('approve_annual_plan'), async (req, res) => {
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may return annual plan and budget proposals.' });
  const itemId = Number(req.params.id);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  if (!Number.isInteger(itemId) || itemId < 1) return res.status(400).json({ error: 'Invalid plan ID.' });
  if (!comment) return res.status(400).json({ error: 'A reason is required when returning a proposal.' });
  const row = await db.prepare('SELECT * FROM plan_proposals WHERE id = ?').get(itemId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending CPU review for this plan.' });
  await db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment, row.id);
  await db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
    VALUES (?, 'return_annual_plan', 'plan_proposal', ?, ?)
  `).run(req.user.id, row.id, `${row.owner_type} plan "${row.plan_title}" returned by CPU: "${comment}"`);
  res.json({ ok: true });
});

// ---- read: the whole compiled picture for one cycle year -----------------
router.get('/', async (req, res) => {
  const cycleYear = Number(req.query.year);
  if (!cycleYear) return res.status(400).json({ error: 'year query param is required.' });

  const unitRows = await db.prepare('SELECT id, sub_id, name FROM units WHERE deleted_at IS NULL ORDER BY id').all();
  const units = [];
  for (const u of unitRows) {
    const proposals = await getRows(cycleYear, 'unit', u.id);
    const approvedBudget = proposals.reduce((sum, proposal) =>
      sum + (proposal.status === 'approved' ? Number(proposal.budget || 0) : 0), 0);
    const provisionalBudget = proposals.reduce((sum, proposal) =>
      sum + (proposal.status !== 'draft' ? Number(proposal.budget || 0) : 0), 0);
    units.push({ ...u, proposals, proposal: proposals[0] || null, approvedBudget, provisionalBudget });
  }

  const subRows = await db.prepare('SELECT id, programme_id, name FROM subs WHERE deleted_at IS NULL ORDER BY id').all();
  const subs = [];
  for (const s of subRows) {
    const myUnits = units.filter((u) => u.sub_id === s.id);
    const proposals = await getRows(cycleYear, 'sub', s.id);
    const approvedBudget = proposals.reduce((sum, proposal) =>
      sum + (proposal.status === 'approved' ? Number(proposal.budget || 0) : 0), 0)
      + myUnits.reduce((sum, unit) => sum + unit.proposals.reduce((unitSum, proposal) =>
        unitSum + (proposal.status === 'approved' ? Number(proposal.budget || 0) : 0), 0), 0);
    const provisionalBudget = proposals.reduce((sum, proposal) =>
      sum + (proposal.status !== 'draft' ? Number(proposal.budget || 0) : 0), 0)
      + myUnits.reduce((sum, unit) => sum + unit.proposals.reduce((unitSum, proposal) =>
        unitSum + (proposal.status !== 'draft' ? Number(proposal.budget || 0) : 0), 0), 0);
    subs.push({
      ...s, unitCount: myUnits.length, approvedBudget, provisionalBudget,
      proposals,
      proposal: (await getRow(cycleYear, 'sub', s.id)) || null,
    });
  }

  const programmeRows = await db.prepare('SELECT id, name FROM programmes WHERE deleted_at IS NULL ORDER BY id').all();
  const programmes = [];
  for (const p of programmeRows) {
    const mySubs = subs.filter((s) => s.programme_id === p.id);
    const proposals = await getRows(cycleYear, 'programme', p.id);
    const approvedBudget = proposals.reduce((sum, proposal) =>
      sum + (proposal.status === 'approved' ? Number(proposal.budget || 0) : 0), 0)
      + mySubs.reduce((sum, sub) => sum + sub.approvedBudget, 0);
    const provisionalBudget = proposals.reduce((sum, proposal) =>
      sum + (proposal.status !== 'draft' ? Number(proposal.budget || 0) : 0), 0)
      + mySubs.reduce((sum, sub) => sum + sub.provisionalBudget, 0);
    programmes.push({
      ...p, subCount: mySubs.length, approvedBudget, provisionalBudget,
      proposals,
      proposal: (await getRow(cycleYear, 'programme', p.id)) || null,
    });
  }

  const seesWholePlan = isGlobalReader(req.user) || req.user.role === 'employee';
  let visibleUnits = units, visibleSubs = subs, visibleProgrammes = programmes;
  if (!seesWholePlan) {
    visibleUnits = [];
    for (const u of units) { if (await canReadUnit(req.user, u.id)) visibleUnits.push(u); }
    visibleSubs = [];
    for (const s of subs) { if (await canReadSub(req.user, s.id)) visibleSubs.push(s); }
    visibleProgrammes = [];
    for (const p of programmes) { if (await canReadProgramme(req.user, p.id)) visibleProgrammes.push(p); }
  }

  const universityApprovedBudget = seesWholePlan
    ? programmes.reduce((sum, p) => sum + p.approvedBudget, 0)
    : null;
  const universityProvisionalBudget = seesWholePlan
    ? programmes.reduce((sum, p) => sum + p.provisionalBudget, 0)
    : null;

  res.json({
    cycleYear, units: visibleUnits, subs: visibleSubs, programmes: visibleProgrammes,
    university: {
      approvedBudget: universityApprovedBudget, provisionalBudget: universityProvisionalBudget,
      proposals: seesWholePlan ? await getRows(cycleYear, 'university', null) : [],
      proposal: seesWholePlan ? (await getRow(cycleYear, 'university', null)) || null : null,
    },
  });
});

// ---- Legacy single-proposal endpoints; CPU alone approves/returns ---------
router.put('/units/:unitId', requirePerm('data_entry'), async (req, res) => {
  const unitId = Number(req.params.unitId);
  if (!isUnitOwner(req.user, unitId)) return res.status(403).json({ error: 'You can only edit your own unit\'s plan proposal.' });
  const { cycleYear, narrative, budget, targets } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  if (!validPlanText(narrative, targets)) return res.status(400).json({ error: 'Planning narrative and targets must be text.' });
  const parsedBudget = budget == null || budget === '' ? null : Number(budget);
  if (parsedBudget != null && (!Number.isFinite(parsedBudget) || parsedBudget < 0)) {
    return res.status(400).json({ error: 'Budget must be a non-negative number.' });
  }
  const existing = await getRow(cycleYear, 'unit', unitId);
  if (existing && existing.status !== 'draft') return res.status(400).json({ error: 'This proposal is locked while submitted or approved — ask CPU to return it first.' });
  const row = await upsertDraft(cycleYear, 'unit', unitId, {
    narrative: cleanPlanText(narrative),
    budget: parsedBudget,
    targets: cleanPlanText(targets),
    status: 'draft',
  });
  res.json({ proposal: row });
});

router.post('/units/:unitId/submit', requireAnyPerm('data_entry', 'submit_plan_budget'), async (req, res) => {
  const unitId = Number(req.params.unitId);
  if (!isUnitOwner(req.user, unitId)) return res.status(403).json({ error: 'You can only submit your own unit\'s plan proposal.' });
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'unit', unitId);
  if (!row || !(await canSubmitProposal(cycleYear, 'unit', unitId, row))) {
    return res.status(400).json({ error: 'Enter a planning narrative and either a budget or measurable targets before submitting.' });
  }
  await db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_plan', 'plan_proposal', row.id, `Unit plan proposal for ${cycleYear} submitted (budget ${row.budget}).`
  );
  res.json({ ok: true });
});

router.post('/units/:unitId/approve', requirePerm('approve_annual_plan'), async (req, res) => {
  const unitId = Number(req.params.unitId);
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may approve annual plan and budget proposals.' });
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'unit', unitId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_plan', 'plan_proposal', row.id, `Unit plan proposal for ${cycleYear} approved.`
  );
  res.json({ ok: true });
});

router.post('/units/:unitId/return', requirePerm('approve_annual_plan'), async (req, res) => {
  const unitId = Number(req.params.unitId);
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may return annual plan and budget proposals.' });
  const { cycleYear, comment } = req.body || {};
  if (!comment) return res.status(400).json({ error: 'A reason is required when returning a proposal.' });
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'unit', unitId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment, row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_plan', 'plan_proposal', row.id, `Unit plan proposal for ${cycleYear} returned: "${comment}"`
  );
  res.json({ ok: true });
});

// ---- Legacy Sub-programme single-proposal endpoints -----------------------
router.put('/subs/:subId', requirePerm('data_entry'), async (req, res) => {
  const subId = Number(req.params.subId);
  if (!isSubOwner(req.user, subId)) return res.status(403).json({ error: 'You can only edit your own sub-programme\'s plan proposal.' });
  const { cycleYear, narrative, targets } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  if (!validPlanText(narrative, targets)) return res.status(400).json({ error: 'Planning narrative and targets must be text.' });
  const existing = await getRow(cycleYear, 'sub', subId);
  if (existing && existing.status !== 'draft') return res.status(400).json({ error: 'This proposal is locked while submitted or approved — ask CPU to return it first.' });
  const row = await upsertDraft(cycleYear, 'sub', subId, {
    narrative: cleanPlanText(narrative),
    targets: cleanPlanText(targets),
    status: 'draft',
  });
  res.json({ proposal: row });
});

router.post('/subs/:subId/submit', requireAnyPerm('data_entry', 'submit_plan_budget'), async (req, res) => {
  const subId = Number(req.params.subId);
  if (!isSubOwner(req.user, subId)) return res.status(403).json({ error: 'You can only submit your own sub-programme\'s plan proposal.' });
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'sub', subId);
  if (!row || !(await canSubmitProposal(cycleYear, 'sub', subId, row))) {
    return res.status(400).json({ error: 'Enter a planning narrative and include a unit budget or measurable targets before submitting.' });
  }
  await db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_plan', 'plan_proposal', row.id, `Sub-programme plan proposal for ${cycleYear} submitted.`
  );
  res.json({ ok: true });
});

router.post('/subs/:subId/approve', requirePerm('approve_annual_plan'), async (req, res) => {
  const subId = Number(req.params.subId);
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may approve annual plan and budget proposals.' });
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'sub', subId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_plan', 'plan_proposal', row.id, `Sub-programme plan proposal for ${cycleYear} approved.`
  );
  res.json({ ok: true });
});

router.post('/subs/:subId/return', requirePerm('approve_annual_plan'), async (req, res) => {
  const subId = Number(req.params.subId);
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may return annual plan and budget proposals.' });
  const { cycleYear, comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'A reason is required when returning a proposal.' });
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'sub', subId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment.trim(), row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_plan', 'plan_proposal', row.id, `Sub-programme plan proposal for ${cycleYear} returned: "${comment.trim()}"`
  );
  res.json({ ok: true });
});

// ---- Legacy Programme single-proposal endpoints ---------------------------
router.put('/programmes/:programmeId', requireAnyPerm('approve_own_tier', 'data_entry'), async (req, res) => {
  const programmeId = Number(req.params.programmeId);
  if (req.user.role !== 'cpu' && !isProgrammeHeadOwner(req.user, programmeId)) {
    return res.status(403).json({ error: 'Only CPU or this Programme\'s own Programme Head compiles its plan.' });
  }
  const { cycleYear, narrative, targets } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  if (!validPlanText(narrative, targets)) return res.status(400).json({ error: 'Planning narrative and targets must be text.' });
  const existing = await getRow(cycleYear, 'programme', programmeId);
  if (existing && existing.status !== 'draft') return res.status(400).json({ error: 'This proposal is locked while submitted or approved — ask CPU to return it first.' });
  const row = await upsertDraft(cycleYear, 'programme', programmeId, {
    narrative: cleanPlanText(narrative),
    targets: cleanPlanText(targets),
    status: 'draft',
  });
  res.json({ proposal: row });
});

router.post('/programmes/:programmeId/submit', requireAnyPerm('approve_own_tier', 'data_entry', 'submit_plan_budget'), async (req, res) => {
  const programmeId = Number(req.params.programmeId);
  if (req.user.role !== 'cpu' && !isProgrammeHeadOwner(req.user, programmeId)) {
    return res.status(403).json({ error: 'Only CPU or this Programme\'s own Programme Head submits its plan.' });
  }
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'programme', programmeId);
  if (!row || !(await canSubmitProposal(cycleYear, 'programme', programmeId, row))) {
    return res.status(400).json({ error: 'Enter a planning narrative and include a unit budget or measurable targets before submitting.' });
  }
  if (row.status !== 'draft') return res.status(400).json({ error: 'This proposal has already been submitted for CPU approval.' });
  await db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_plan', 'plan_proposal', row.id, `Programme plan for ${cycleYear} submitted to CPU for approval.`
  );
  res.json({ ok: true });
});

router.post('/programmes/:programmeId/approve', requirePerm('approve_annual_plan'), async (req, res) => {
  const programmeId = Number(req.params.programmeId);
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may approve annual plan and budget proposals.' });
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'programme', programmeId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending CPU review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_plan', 'plan_proposal', row.id, `Programme plan for ${cycleYear} approved by CPU.`
  );
  res.json({ ok: true });
});

router.post('/programmes/:programmeId/return', requirePerm('approve_annual_plan'), async (req, res) => {
  const programmeId = Number(req.params.programmeId);
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may return annual plan and budget proposals.' });
  const { cycleYear, comment } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'A reason is required when returning a proposal.' });
  const row = await getRow(cycleYear, 'programme', programmeId);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending CPU review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment.trim(), row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_plan', 'plan_proposal', row.id, `Programme plan for ${cycleYear} returned by CPU: "${comment.trim()}"`
  );
  res.json({ ok: true });
});

// ---- University tier: CPU compiles, submits, and approves the whole annual
// plan. It remains locked while submitted or approved until CPU returns it.
router.put('/university', requirePerm('submit_annual_plan'), async (req, res) => {
  const { cycleYear, narrative, targets } = req.body || {};
  if (!validPlanText(narrative, targets)) return res.status(400).json({ error: 'Planning narrative and targets must be text.' });
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const existing = await getRow(cycleYear, 'university', null);
  if (existing && existing.status !== 'draft') {
    return res.status(400).json({ error: 'This plan is locked while submitted or approved — ask CPU to return it first.' });
  }
  const row = await upsertDraft(cycleYear, 'university', null, {
    narrative: cleanPlanText(narrative),
    targets: cleanPlanText(targets),
    status: 'draft',
  });
  res.json({ proposal: row });
});

router.post('/university/submit', requirePerm('submit_annual_plan'), async (req, res) => {
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'university', null);
  if (!row || !(await canSubmitProposal(cycleYear, 'university', null, row))) {
    return res.status(400).json({ error: 'Enter a compiled annual-plan narrative and include a unit budget or measurable targets before submitting.' });
  }
  if (row.status !== 'draft') return res.status(400).json({ error: 'This plan has already been submitted for CPU approval.' });
  await db.prepare('UPDATE plan_proposals SET status = \'submitted\', submitted_at = datetime(\'now\'), return_comment = NULL WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_annual_plan', 'plan_proposal', row.id, `University Annual Plan for ${cycleYear} submitted for CPU approval.`
  );
  res.json({ ok: true });
});

// CPU is the only role that can approve or return annual plan proposals at
// any tier. The role check is intentional in addition to the permission
// middleware: this authority must not be delegated to another role.
router.post('/university/approve', requirePerm('approve_annual_plan'), async (req, res) => {
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may approve annual plans and budgets.' });
  const { cycleYear } = req.body || {};
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'university', null);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending CPU review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_annual_plan', 'plan_proposal', row.id, `University Annual Plan for ${cycleYear} approved by CPU — now in effect.`
  );
  res.json({ ok: true });
});

router.post('/university/return', requirePerm('approve_annual_plan'), async (req, res) => {
  if (req.user.role !== 'cpu') return res.status(403).json({ error: 'Only CPU may return annual plans and budgets.' });
  const { cycleYear, comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'A reason is required when returning the plan.' });
  if (!cycleYear) return res.status(400).json({ error: 'cycleYear is required.' });
  const row = await getRow(cycleYear, 'university', null);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending CPU review for that cycle.' });
  await db.prepare('UPDATE plan_proposals SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment.trim(), row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_annual_plan', 'plan_proposal', row.id, `University Annual Plan for ${cycleYear} returned by CPU: "${comment.trim()}"`
  );
  res.json({ ok: true });
});

module.exports = router;
