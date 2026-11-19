const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm, requireAnyPerm, requireRole } = require('../middleware/auth');
const { canReadKpi, isGlobalReader } = require('../utils/scope');
const { isValidReportingPeriods } = require('../utils/reportingPeriods');
const {
  calculatePerformanceAgainstTarget,
  calculatePerformancePace,
  calculateWeightedKpiScore,
  getReportingMilestone,
  classifyTargetPerformance,
  summarizePace,
  summarizeKpis,
} = require('../utils/performanceAgainstTarget');
const { checkSubmissionWindow, wasLate, windowMessage, nowSqlString } = require('../utils/submissionWindow');

// Shared guard for every "submit for review" route below (single, bulk, and
// contribution alike) — draft entry itself is never gated, only the actual
// submit action. Returns the live window check on success (so a caller can
// still act on `.late`) or null after already sending a 403.
async function enforceSubmissionWindow(req, res, year, month) {
  const win = await checkSubmissionWindow(year, month, req);
  if (!win.allowed) {
    res.status(403).json({ error: windowMessage(year, month, win) || 'Submissions are not open for that period.', submissionWindow: win });
    return null;
  }
  return win;
}

const router = express.Router();
router.use(requireAuth);
const isFiniteNumberInput = (value) =>
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value));

// ---- scope helpers -------------------------------------------------------
// These are what make permission checks real rather than cosmetic: every
// mutating endpoint below re-derives the KPI's owning chain from the
// database and checks it against req.user's own role/scope, never trusting
// anything the client claims about "whose KPI this is".

async function unitSubId(unitId) {
  const row = await db.prepare('SELECT sub_id FROM units WHERE id = ?').get(unitId);
  return row ? row.sub_id : null;
}
async function employeeUnitId(employeeId) {
  const row = await db.prepare('SELECT unit_id FROM employees WHERE id = ?').get(employeeId);
  return row ? row.unit_id : null;
}
async function kpiSubId(kpi) {
  if (kpi.owner_type === 'sub') return kpi.owner_id;
  if (kpi.owner_type === 'unit') return await unitSubId(kpi.owner_id);
  return await unitSubId(await employeeUnitId(kpi.owner_id));
}

// Has this Employee been assigned this specific Unit-owned KPI by their
// Unit Head (see the kpi_assignments table / POST :id/assign below)? This is
// what lets a staff member enter & submit data for one of their unit's KPIs
// — "one of their duties" — without becoming its owner: approval still goes
// to the Sub-programme Rep exactly as if the Unit Head had entered it.
async function isAssignedEmployee(user, kpi) {
  if (kpi.owner_type !== 'unit' || user.role !== 'employee' || user.scope_type !== 'employee') return false;
  return !!(await db.prepare('SELECT 1 FROM kpi_assignments WHERE kpi_id = ? AND employee_id = ? AND deleted_at IS NULL').get(kpi.id, user.scope_id));
}

// Does this user directly own (enter data for) this KPI's own official
// value? An assigned Employee is NOT an owner of the shared Unit value
// any more (see kpi_contributions below) — they own their own contribution
// row instead, entered/submitted through the /contribution endpoints, and
// reviewed by their Unit Head before it ever reaches this KPI's real value.
function isOwner(user, kpi) {
  const scopeType = user.scope_type || ({
    programme: 'programme',
    rep: 'sub',
    unithead: 'unit',
    employee: 'employee',
  })[user.role];
  if (kpi.owner_type === 'sub' && scopeType === 'sub' && user.role === 'rep') return user.scope_id === kpi.owner_id;
  if (kpi.owner_type === 'unit' && scopeType === 'unit' && user.role === 'unithead') return user.scope_id === kpi.owner_id;
  if (kpi.owner_type === 'employee' && scopeType === 'employee' && user.role === 'employee') return user.scope_id === kpi.owner_id;
  if (!user.permissions?.includes('submit_data_entries')) return false;
  if (user.role === 'employee') return false;
  return scopeType === kpi.owner_type && user.scope_id === kpi.owner_id;
}

// Is this user the Unit Head who owns this Unit-scoped KPI? (The only person
// allowed to assign/unassign it to someone in their unit.)
function isUnitHeadOwner(user, kpi) {
  return user.role === 'unithead' && kpi.owner_type === 'unit' && user.scope_id === kpi.owner_id;
}

// CPU is the final approver for every KPI owner tier. Other managers may
// review subordinate contributions, but only CPU approval makes the KPI
// value official.
async function isApprover(user, kpi) {
  return user.role === 'cpu';
}

// Is this KPI within a role-scoped user's jurisdiction at all (for edit_targets,
// which a Sub Rep or Unit Head might be granted for "their own patch")?
// Global roles (cpu/ictadmin/exec/vc) are never restricted by this check.
async function inJurisdiction(user, kpi) {
  if (['cpu', 'ictadmin', 'exec', 'vc'].includes(user.role)) return true;
  if (user.role === 'rep') return await kpiSubId(kpi) === user.scope_id;
  if (user.role === 'unithead') {
    if (kpi.owner_type === 'unit') return kpi.owner_id === user.scope_id;
    if (kpi.owner_type === 'employee') return await employeeUnitId(kpi.owner_id) === user.scope_id;
    return false;
  }
  if (user.role === 'employee') {
    if (user.scope_type === 'employee') return kpi.owner_type === 'employee' && kpi.owner_id === user.scope_id;
    if (user.scope_type === 'unit') return kpi.owner_type === 'unit' && kpi.owner_id === user.scope_id || kpi.owner_type === 'employee' && await employeeUnitId(kpi.owner_id) === user.scope_id;
    if (user.scope_type === 'sub') return await kpiSubId(kpi) === user.scope_id;
    if (user.scope_type === 'programme') {
      const subId = await kpiSubId(kpi);
      return subId != null && (await db.prepare('SELECT programme_id FROM subs WHERE id = ?').get(subId))?.programme_id === user.scope_id;
    }
  }
  return false;
}

async function getKpiOr404(req, res) {
  // Excludes soft-removed KPIs (deleted_at set — see DELETE /:id below) from
  // every action route that resolves a KPI by id: a removed KPI's history
  // stays in the database, but it can't be edited, valued, approved, or
  // otherwise acted on again until it's restored.
  const kpi = await db.prepare('SELECT * FROM kpis WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!kpi) { res.status(404).json({ error: 'KPI not found.' }); return null; }
  return kpi;
}

async function validateOwnerWeightAllocation(ownerType, ownerId) {
  const rows = await db.prepare(
    "SELECT weight FROM kpis WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL "
      + "AND lifecycle_status IN ('submitted','approved','active')"
  ).all(ownerType, ownerId);
  const total = rows.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  const approvedAllocation = await db.prepare(
    `SELECT COALESCE(SUM(weight), 0) AS total FROM weighting_allocations
     WHERE parent_type = ? AND parent_id = ? AND allocation_type = 'kpi' AND status = 'approved'
       AND effective_from::date <= CURRENT_DATE AND (effective_to IS NULL OR effective_to::date >= CURRENT_DATE)`
  ).get(ownerType, ownerId);
  const requiredTotal = Number(approvedAllocation.total);
  if (requiredTotal <= 0) return { total, requiredTotal: null, valid: true };
  return {
    total,
    requiredTotal,
    valid: Math.abs(total - requiredTotal) <= 0.01,
  };
}

// Contribution-based shared KPIs accumulate monthly team contributions.
// Directly entered KPIs instead store the submitted cumulative actual for
// each month and must never be added to a previous month's value.
async function previousOfficialValue(kpiId, year, month, baseline) {
  const row = await db.prepare(
    `SELECT value, override_value FROM kpi_values
     WHERE kpi_id = ? AND value IS NOT NULL
       AND (status = 'approved' OR approved_at IS NOT NULL)
       AND (year < ? OR (year = ? AND month < ?))
     ORDER BY year DESC, month DESC LIMIT 1`
  ).get(kpiId, year, year, month);
  if (!row) return baseline;
  return row.override_value != null ? row.override_value : row.value;
}

// A submitted direct entry is already the cumulative actual for its month.
// Expose it as a preview for the CPU review queue; Overview/Reports only use
// official values. An amended approved row may still carry its old official
// `value`, so the pending preview must take precedence in review until the
// new actual is approved.
async function attachPreview(row) {
  if (!row || row.status !== 'submitted') return row;
  const kpi = await db.prepare('SELECT baseline, is_automated FROM kpis WHERE id = ?').get(row.kpi_id);
  if (!kpi) return row;
  if (!kpi.is_automated) {
    return row.entered_value == null ? row : { ...row, preview_value: Number(row.entered_value) };
  }
  const base = await previousOfficialValue(row.kpi_id, row.year, row.month, kpi.baseline);
  const contributions = await db.prepare(
    "SELECT value FROM kpi_contributions WHERE kpi_id = ? AND year = ? AND month = ? AND status = 'approved'"
  ).all(row.kpi_id, row.year, row.month);
  const total = base + contributions.reduce((sum, contribution) => sum + Number(contribution.value || 0), 0);
  return { ...row, preview_value: total };
}

// Marks a kpi_values (or kpi_contributions — both carry year/month/status/
// submitted_at) row with whether it fell inside the late-but-accepted
// grace window at the moment it was actually submitted — see
// utils/submissionWindow.js. Applied independently of attachPreview (which
// bails out early for several row shapes attachLate still needs to cover),
// never overwrites anything already on the row, and is a no-op for a row
// that was never submitted.
async function attachLate(row) {
  if (!row || !row.submitted_at) return row;
  return { ...row, late: await wasLate(row.year, row.month, row.submitted_at) };
}

// The automated heart of the shared-KPI feature: whenever a contribution is
// approved, changed after approval, or returned, recompute this KPI's
// working total for the period as the sum of currently-approved
// contributions. CPU approval publishes it as the official value. A KPI with no assignees at all is
// untouched (this only ever runs for KPIs someone has actually assigned).
// Once a KPI has been through this once it's permanently marked automated
// (matching the existing is_automated/override mechanism everywhere else in
// the app), so a Sub-programme Rep can still hand-override the computed
// total if a real-world correction is ever needed. This never submits or
// approves the Unit's own value on anyone's behalf — the Unit Head still
// has to explicitly review and click Submit, same as any other Unit KPI,
// which is what sends it on to the Sub-programme Rep.
async function recomputeUnitTotal(kpiId, year, month) {
  const hasAssignees = await db.prepare('SELECT 1 FROM kpi_assignments WHERE kpi_id = ? AND deleted_at IS NULL').get(kpiId);
  if (!hasAssignees) return;
  const kpi = await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
  const rows = await db.prepare(
    "SELECT value FROM kpi_contributions WHERE kpi_id = ? AND year = ? AND month = ? AND status = 'approved'"
  ).all(kpiId, year, month);
  const anyApproved = rows.length > 0;
  // Each contributor's own figure is that person's contribution FOR THIS
  // MONTH ALONE (never a running total they'd have to track themselves) —
  // summing them gives this month's contribution total, which is added to
  // the Unit's previous official figure below.
  const periodTotal = anyApproved ? rows.reduce((s, r) => s + Number(r.value || 0), 0) : null;
  const sum = periodTotal != null ? (await previousOfficialValue(kpiId, year, month, kpi.baseline)) + periodTotal : null;

  await db.prepare('UPDATE kpis SET is_automated = 1 WHERE id = ? AND is_automated = 0').run(kpiId);

  const existing = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpiId, year, month);
  if (existing) {
    const hasOfficialValue = existing.value != null && (existing.status === 'approved' || existing.approved_at != null);
    const nextStatus = existing.status === 'approved' ? 'submitted' : existing.status;
    if (hasOfficialValue) {
      await db.prepare('UPDATE kpi_values SET status = ?, review_comment = NULL, return_comment = NULL WHERE id = ?')
        .run(nextStatus, existing.id);
    } else {
      await db.prepare('UPDATE kpi_values SET value = ?, status = ? WHERE id = ?')
        .run(sum, nextStatus, existing.id);
    }
  } else {
    await db.prepare('INSERT INTO kpi_values (kpi_id, year, month, value, status) VALUES (?, ?, ?, ?, \'draft\')').run(kpiId, year, month, sum);
  }
  // Keep the new total as a preview until CPU approves the Unit's
  // submission. Only that final approval may affect later official periods.
}

// Recompute later automated shared-KPI totals when an earlier contribution
// total or override changes. Direct KPI values are monthly cumulative
// snapshots, so changing one month must not rewrite another month's actual.
async function cascadeRecomputeForward(kpiId, year, month, userId) {
  const kpi = await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
  if (!kpi || !kpi.is_automated) return;
  const laterRows = await db.prepare(
    `SELECT * FROM kpi_values WHERE kpi_id = ? AND value IS NOT NULL
     AND status = 'approved'
     AND (year > ? OR (year = ? AND month > ?))
     ORDER BY year ASC, month ASC`
  ).all(kpiId, year, year, month);

  for (const period of laterRows) {
    const base = await previousOfficialValue(kpiId, period.year, period.month, kpi.baseline);
    const contributions = await db.prepare(
      "SELECT value FROM kpi_contributions WHERE kpi_id = ? AND year = ? AND month = ? AND status = 'approved'"
    ).all(kpiId, period.year, period.month);
    if (contributions.length === 0) continue;
    const newValue = base + contributions.reduce((s, r) => s + Number(r.value || 0), 0);
    if (newValue === period.value) continue;

    const oldValue = period.value;
    await db.prepare('UPDATE kpi_values SET value = ? WHERE id = ?').run(newValue, period.id);
    await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      userId || null, 'cascade_recompute', 'kpi', kpiId,
      `${period.year}-${String(period.month).padStart(2, '0')} automatically recalculated from ${oldValue} to ${newValue} — an earlier period it was built on top of just changed.`
    );
    // period.value written above feeds the next iteration's previous total.
  }
}

// ---- routes ---------------------------------------------------------------

router.get('/', async (req, res) => {
  // Soft-removed KPIs (deleted_at set — see DELETE /:id below) drop out of
  // every active list — data entry, KPI Management's catalogue, ownership
  // lookups — without their recorded values ever being destroyed.
  //
  // Scope-filtered by canReadKpi (see utils/scope.js): a signed-in account
  // only ever sees KPIs within its own branch of the org tree (or all of
  // them, for the global oversight roles) — closing the gap where this used
  // to hand back every KPI in the university to anyone with a valid login,
  // regardless of what the UI would actually show them.
  const allKpis = await db.prepare('SELECT * FROM kpis WHERE deleted_at IS NULL ORDER BY id').all();
  const kpis = [];
  for (const kpi of allKpis) { if (await canReadKpi(req.user, kpi)) kpis.push(kpi); }
  res.json({ kpis });
});

router.get('/performance-target', async (req, res) => {
  const cycleYear = Number(req.query.cycleYear);
  const periodType = String(req.query.periodType || 'monthly');
  const periodIndex = Number(req.query.periodIndex || 1);
  const unitFilter = req.query.orgNode ? String(req.query.orgNode) : null;
  const tierFilter = req.query.tier ? String(req.query.tier) : null;
  const periodLimits = {
    monthly: [12, 1],
    quarterly: [4, 3],
    biannual: [2, 6],
    annual: [1, 12],
  };
  if (!Number.isInteger(cycleYear) || cycleYear < 1900 || cycleYear > 9999) {
    return res.status(400).json({ error: 'cycleYear must be a valid four-digit year.' });
  }
  if (!periodLimits[periodType] || !Number.isInteger(periodIndex)
      || periodIndex < 1 || periodIndex > periodLimits[periodType][0]) {
    return res.status(400).json({ error: 'Invalid reporting period.' });
  }

  const [periodCount, monthsPerPeriod] = periodLimits[periodType];
  const fromMonth = periodType === 'annual' ? 1 : (periodIndex - 1) * monthsPerPeriod + 1;
  const toMonth = fromMonth + monthsPerPeriod - 1;

  if (isGlobalReader(req.user) && !req.user.permissions.includes('view_institutional_performance')) {
    return res.status(403).json({ error: 'Missing permission: view_institutional_performance' });
  }

  const [programmes, subs, units, employees, allKpis] = await Promise.all([
    db.prepare('SELECT id, name FROM programmes WHERE deleted_at IS NULL ORDER BY id').all(),
    db.prepare('SELECT id, programme_id, name FROM subs WHERE deleted_at IS NULL ORDER BY id').all(),
    db.prepare('SELECT id, sub_id, name, kind FROM units WHERE deleted_at IS NULL ORDER BY id').all(),
    db.prepare('SELECT id, unit_id, name, role_title FROM employees WHERE deleted_at IS NULL ORDER BY id').all(),
    db.prepare("SELECT * FROM kpis WHERE deleted_at IS NULL AND lifecycle_status IN ('approved','active') ORDER BY id").all(),
  ]);
  const visibleKpis = [];
  for (const kpi of allKpis) {
    if (await canReadKpi(req.user, kpi)) visibleKpis.push(kpi);
  }

  const [valueRows, distinctYears, planYears] = await Promise.all([
    db.prepare('SELECT * FROM kpi_values WHERE year = ? AND month BETWEEN ? AND ? ORDER BY month')
      .all(cycleYear, fromMonth, toMonth),
    db.prepare('SELECT DISTINCT year FROM kpi_values ORDER BY year').all(),
    db.prepare('SELECT DISTINCT cycle_year FROM plan_proposals ORDER BY cycle_year').all(),
  ]);
  const visibleKpiIds = new Set(visibleKpis.map((kpi) => kpi.id));
  const actualByKpi = new Map();
  const approvedRowsByKpi = new Map();
  const latestValueRowByKpi = new Map();
  for (const row of valueRows) {
    if (!visibleKpiIds.has(row.kpi_id)) continue;
    const latestRow = latestValueRowByKpi.get(row.kpi_id);
    if (!latestRow || Number(row.month) > Number(latestRow.month)) latestValueRowByKpi.set(row.kpi_id, row);
    if (row.status !== 'approved' && row.approved_at == null) continue;
    if (row.override_value == null && row.value == null) continue;
    const actual = row.override_value != null ? Number(row.override_value) : Number(row.value);
    if (!Number.isFinite(actual)) continue;
    const approvedRows = approvedRowsByKpi.get(row.kpi_id) || [];
    approvedRows.push(row);
    approvedRowsByKpi.set(row.kpi_id, approvedRows);
    const previous = actualByKpi.get(row.kpi_id);
    if (!previous || row.month > previous.month) actualByKpi.set(row.kpi_id, { month: row.month, actual });
  }
  for (const kpi of visibleKpis) {
    if (kpi.reporting_mode !== 'period' || kpi.period_aggregation !== 'sum') continue;
    const periodRows = approvedRowsByKpi.get(kpi.id) || [];
    if (!periodRows.length) continue;
    actualByKpi.set(kpi.id, {
      month: Math.max(...periodRows.map((row) => Number(row.month))),
      actual: periodRows.reduce((sum, row) => sum + Number(row.override_value != null ? row.override_value : row.value), 0),
      rows: periodRows,
    });
  }

  const programmeById = new Map(programmes.map((row) => [row.id, row]));
  const subById = new Map(subs.map((row) => [row.id, row]));
  const unitById = new Map(units.map((row) => [row.id, row]));
  const employeeById = new Map(employees.map((row) => [row.id, row]));
  const nodeByKey = new Map();
  const addNode = (kind, id, name, parentKey, tier) => {
    const key = `${kind}:${id}`;
    nodeByKey.set(key, {
      key, kind, id, name, tier, parentKey,
      kpis: new Map(),
    });
  };

  addNode('university', 0, 'University-wide', null, 'University');
  programmes.forEach((programme) => addNode('programme', programme.id, programme.name, 'university:0', 'Programme'));
  subs.forEach((sub) => {
    if (programmeById.has(sub.programme_id)) addNode('sub', sub.id, sub.name, `programme:${sub.programme_id}`, 'Sub-programme');
  });
  units.forEach((unit) => {
    if (subById.has(unit.sub_id)) addNode('unit', unit.id, unit.name, `sub:${unit.sub_id}`, unit.kind || 'Unit');
  });
  employees.forEach((employee) => {
    const parentKey = unitById.has(employee.unit_id) ? `unit:${employee.unit_id}` : null;
    addNode('employee', employee.id, employee.name, parentKey, 'Employee');
  });

  for (const kpi of visibleKpis) {
    let ownerKey;
    let subId;
    let unitId;
    if (kpi.owner_type === 'sub' && subById.has(kpi.owner_id)) {
      ownerKey = `sub:${kpi.owner_id}`;
      subId = kpi.owner_id;
    } else if (kpi.owner_type === 'unit' && unitById.has(kpi.owner_id)) {
      ownerKey = `unit:${kpi.owner_id}`;
      unitId = kpi.owner_id;
      subId = unitById.get(unitId).sub_id;
    } else if (kpi.owner_type === 'employee' && employeeById.has(kpi.owner_id)) {
      ownerKey = `employee:${kpi.owner_id}`;
      unitId = employeeById.get(kpi.owner_id).unit_id;
      subId = unitById.get(unitId)?.sub_id;
    }
    if (!ownerKey || !nodeByKey.has(ownerKey)) continue;

    const path = ['university:0'];
    const sub = subById.get(subId);
    const programme = sub && programmeById.get(sub.programme_id);
    if (programme) path.push(`programme:${programme.id}`);
    if (sub) path.push(`sub:${sub.id}`);
    if (unitId && unitById.has(unitId)) path.push(`unit:${unitId}`);
    path.push(ownerKey);
    const value = actualByKpi.get(kpi.id);
    const latestValueRow = latestValueRowByKpi.get(kpi.id);
    const item = {
      kpi,
      actual: value ? value.actual : null,
      submissionStatus: latestValueRow?.status || null,
      returnComment: latestValueRow?.return_comment || null,
    };
    for (const key of new Set(path)) nodeByKey.get(key).kpis.set(kpi.id, item);
  }

  const global = isGlobalReader(req.user);
  let rootKey = 'university:0';
  if (!global) {
    if (req.user.role === 'programme') rootKey = `programme:${req.user.scope_id}`;
    else if (req.user.role === 'rep') rootKey = `sub:${req.user.scope_id}`;
    else if (req.user.role === 'unithead') rootKey = `unit:${req.user.scope_id}`;
    else if (req.user.role === 'employee') {
      const scopeType = req.user.scope_type || 'employee';
      rootKey = `${scopeType === 'sub' ? 'sub' : scopeType === 'unit' ? 'unit' : scopeType === 'programme' ? 'programme' : 'employee'}:${req.user.scope_id}`;
    } else {
      return res.status(403).json({ error: 'No organisational performance scope is assigned to this account.' });
    }
  }
  if (!nodeByKey.has(rootKey)) {
    return res.json({ summary: summarizeKpis([]), kpis: [], nodes: [], tiers: [], strategicYears: [], rootKey: null });
  }

  const scopedKeys = new Set([rootKey]);
  let added = true;
  while (added) {
    added = false;
    for (const node of nodeByKey.values()) {
      if (node.parentKey && scopedKeys.has(node.parentKey) && !scopedKeys.has(node.key)) {
        scopedKeys.add(node.key);
        added = true;
      }
    }
  }
  const allScopedNodes = [...scopedKeys].map((key) => nodeByKey.get(key)).filter(Boolean);
  const selectedNode = unitFilter ? nodeByKey.get(unitFilter) : null;
  if (unitFilter && (!selectedNode || !scopedKeys.has(unitFilter))) {
    return res.status(403).json({ error: 'That organisational unit is outside your reporting scope.' });
  }
  const displayRootKey = selectedNode ? selectedNode.key : rootKey;
  const displayKeys = new Set([displayRootKey]);
  added = true;
  while (added) {
    added = false;
    for (const node of allScopedNodes) {
      if (node.parentKey && displayKeys.has(node.parentKey) && !displayKeys.has(node.key)) {
        displayKeys.add(node.key);
        added = true;
      }
    }
  }

  const performancePaceByKpi = new Map(visibleKpis.map((kpi) => {
    const milestone = getReportingMilestone(kpi, periodType, periodIndex);
    const calculationKpi = kpi.reporting_mode === 'period' && milestone
      ? { ...kpi, target: milestone.expectedValue }
      : kpi;
    const actual = actualByKpi.get(kpi.id)?.actual ?? null;
    const weight = Number(kpi.weight);
    return [kpi.id, {
      ...calculatePerformancePace(calculationKpi, actual, milestone?.expectedValue),
      weight: Number.isFinite(weight) && weight > 0 ? weight : 0,
    }];
  }));
  const nodePaceSummary = (node) => summarizePace(
    [...node.kpis.keys()].map((id) => performancePaceByKpi.get(id)),
  );
  const toResponseNode = (node) => ({
    key: node.key,
    kind: node.kind,
    id: node.id,
    name: node.name,
    tier: node.tier,
    parentKey: displayKeys.has(node.parentKey) ? node.parentKey : null,
    ...summarizeKpis([...node.kpis.values()]),
    ...nodePaceSummary(node),
  });
  const summaryNode = selectedNode || nodeByKey.get(rootKey);
  const kpiDetails = [...summaryNode.kpis.values()].map(({ kpi, actual, submissionStatus, returnComment }) => {
    const milestone = getReportingMilestone(kpi, periodType, periodIndex);
    const calculationKpi = kpi.reporting_mode === 'period' && milestone
      ? { ...kpi, target: milestone.expectedValue }
      : kpi;
    const result = calculatePerformanceAgainstTarget(calculationKpi, actual);
    const performancePct = result.performancePct;
    const performancePace = performancePaceByKpi.get(kpi.id);
    const weighted = calculateWeightedKpiScore(calculationKpi, actual);
    const owner = kpi.owner_type === 'sub' ? subById.get(kpi.owner_id)
      : kpi.owner_type === 'unit' ? unitById.get(kpi.owner_id)
        : employeeById.get(kpi.owner_id);
    const employeeUnit = kpi.owner_type === 'employee' ? unitById.get(owner?.unit_id) : null;
    const status = actual == null
      ? submissionStatus === 'submitted' ? 'pending'
        : submissionStatus === 'draft' && returnComment ? 'returned' : 'missing'
      : result.status !== 'calculated' ? 'not-calculable'
        : classifyTargetPerformance(performancePct);
    return {
      id: kpi.id,
      name: kpi.name,
      type: kpi.type,
      measure: kpi.measure,
      target: calculationKpi.target,
      annualTarget: kpi.target,
      actual,
      weight: kpi.weight,
      weightedKpiContribution: weighted.weightedScore,
      weightedScoreStatus: weighted.status,
      achievementRule: kpi.achievement_rule || 'ratio',
      measurementDirection: kpi.measurement_direction,
      performanceCalculationStatus: result.status,
      submissionStatus,
      returnComment,
      ownerTier: kpi.owner_type === 'sub' ? 'Sub-programme'
        : kpi.owner_type === 'unit' ? owner?.kind || 'Unit' : 'Employee',
      ownerName: kpi.owner_type === 'employee' ? owner?.role_title || 'Employee' : owner?.name || '—',
      ownerUnitName: employeeUnit?.name || null,
      performancePct: performancePct == null ? null : Math.round(performancePct * 10) / 10,
      status,
      performanceExpectedPacePct: performancePace.expectedPacePct == null
        ? null : Math.round(performancePace.expectedPacePct * 10) / 10,
      paceVariancePct: performancePace.variance == null
        ? null : Math.round(performancePace.variance * 10) / 10,
      paceVarianceRawPct: performancePace.variance,
      paceFlag: performancePace.flag,
    };
  });
  const summary = summarizeKpis([...summaryNode.kpis.values()]);
  Object.assign(summary, nodePaceSummary(summaryNode));
  const displayedNodes = allScopedNodes.filter((node) => displayKeys.has(node.key));
  const filteredNodes = tierFilter
    ? displayedNodes.filter((node) => `${node.kind}:${node.tier}` === tierFilter || node.kind === tierFilter)
    : displayedNodes;

  const tierGroups = new Map();
  for (const node of displayedNodes) {
    if (node.kind === 'university') continue;
    const key = `${node.kind}:${node.tier}`;
    const group = tierGroups.get(key) || { key, kind: node.kind, tier: node.tier, kpis: new Map() };
    for (const [id, item] of node.kpis) group.kpis.set(id, item);
    tierGroups.set(key, group);
  }
  const tiers = [...tierGroups.values()].map((group) => ({
    key: group.key,
    kind: group.kind,
    tier: group.tier,
    ...summarizeKpis([...group.kpis.values()]),
    ...summarizePace([...group.kpis.keys()].map((id) => performancePaceByKpi.get(id))),
  }));
  const availableYears = new Set([
    new Date().getFullYear(),
    ...distinctYears.map((row) => Number(row.year)),
    ...planYears.map((row) => Number(row.cycle_year)),
  ]);

  res.json({
    cycleYear,
    periodType,
    periodIndex,
    fromMonth,
    toMonth,
    summary,
    kpis: kpiDetails,
    summaryName: summaryNode.name,
    rootKey: displayRootKey,
    nodes: filteredNodes.map(toResponseNode),
    tiers: tierFilter ? tiers.filter((tier) => tier.key === tierFilter || tier.kind === tierFilter) : tiers,
    unitOptions: allScopedNodes.map(({ key, kind, id, name, tier, parentKey }) => ({ key, kind, id, name, tier, parentKey })),
    strategicYears: [...availableYears].filter(Number.isInteger).sort((a, b) => a - b),
  });
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
router.put('/bulk-value', requirePerm('data_entry'), async (req, res) => {
  const { year, month, entries } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries must be a non-empty array of { id, value }.' });
  }

  const prepared = [];
  for (const entry of entries) {
    const kpiId = Number(entry?.id);
    if (!kpiId) return res.status(400).json({ error: 'Each entry needs a numeric KPI id.' });
    const kpi = await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
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

  const applyAll = db.transaction(async () => {
    const results = [];
    for (const { kpi, value } of prepared) {
      const existing = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
      const wasApproved = existing && existing.status === 'approved';
      if (existing) {
        await db.prepare(
          `UPDATE kpi_values SET entered_value = ?, status = ?, submitted_at = CASE WHEN ? THEN datetime('now') ELSE submitted_at END,
            review_comment = CASE WHEN ? THEN NULL ELSE review_comment END,
            achievement_date = ?, evidence = ?, challenges = ?, corrective_actions = ?
           WHERE id = ?`
        ).run(
          value, wasApproved ? 'submitted' : existing.status, wasApproved ? 1 : 0, wasApproved ? 1 : 0,
          req.body.achievementDate || null, req.body.evidence || null,
          req.body.challenges || null, req.body.correctiveActions || null,
          existing.id
        );
      } else {
        await db.prepare(
          'INSERT INTO kpi_values (kpi_id, year, month, entered_value, status, achievement_date, evidence, challenges, corrective_actions) VALUES (?, ?, ?, ?, \'draft\', ?, ?, ?, ?)'
        ).run(kpi.id, year, month, value, req.body.achievementDate || null, req.body.evidence || null, req.body.challenges || null, req.body.correctiveActions || null);
      }
      await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id, wasApproved ? 'amend_value' : 'enter_value', 'kpi', kpi.id,
        `${year}-${String(month).padStart(2, '0')} entry set to ${value} (bulk save, ${prepared.length} KPI${prepared.length > 1 ? 's' : ''} in this batch)${wasApproved ? ' — amendment on a previously approved period, returned to submitted.' : '.'}`
      );
      results.push(await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month));
    }
    return results;
  });

  res.json({ values: await applyAll() });
});

router.post('/bulk-submit', requireAnyPerm('data_entry', 'submit_data_entries'), async (req, res) => {
  const { year, month, ids } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array of KPI ids.' });
  }
  const win = await enforceSubmissionWindow(req, res, year, month); if (!win) return;

  const prepared = [];
  for (const rawId of ids) {
    const kpiId = Number(rawId);
    if (!kpiId) return res.status(400).json({ error: 'Each id must be numeric.' });
    const kpi = await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpiId);
    if (!kpi) return res.status(404).json({ error: `KPI #${kpiId} not found.` });
    if (!isOwner(req.user, kpi)) return res.status(403).json({ error: `You can only submit KPIs you own (KPI #${kpiId}).` });
    const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
    if (!row) return res.status(404).json({ error: `No value recorded for "${kpi.name}" for that period yet.` });
    // Same distinction POST /:id/submit already makes: an automated KPI is
    // gated on `value` (recomputeUnitTotal fills it from approved team
    // contributions), every directly-entered KPI on `entered_value`.
    const missing = kpi.is_automated ? row.value == null : row.entered_value == null;
    if (missing) return res.status(400).json({ error: `Enter a value before submitting "${kpi.name}".` });
    prepared.push({ kpi, row });
  }

  const submittedAt = nowSqlString(req);
  const applyAll = db.transaction(async () => {
    for (const { kpi, row } of prepared) {
      await db.prepare('UPDATE kpi_values SET status = \'submitted\', submitted_at = ?, return_comment = NULL, review_comment = NULL WHERE id = ?').run(submittedAt, row.id);
      await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id, 'submit', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} submitted for review (bulk submit, ${prepared.length} KPI${prepared.length > 1 ? 's' : ''} in this batch)${win.late ? ' — late, within the grace window.' : '.'}`
      );
    }
    return prepared.length;
  });

  res.json({ ok: true, submitted: await applyAll(), late: win.late });
});

router.get('/:id/values', async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!(await canReadKpi(req.user, kpi))) return res.status(403).json({ error: 'That KPI is outside your scope.' });
  const rows = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? ORDER BY year, month').all(kpi.id);
  const values = [];
  for (const r of rows) values.push(await attachLate(await attachPreview(r)));
  res.json({ values });
});

// Small in-request cache: values-by-period reads join back to `kpis` purely
// to scope-check each row, and the same handful of KPI rows gets looked up
// over and over across a batch — cheap at this app's size, but no reason to
// re-query the same id twice in one response.
async function readableKpiIds(user) {
  const kpis = await db.prepare('SELECT * FROM kpis').all(); // deliberately unfiltered by deleted_at — a value row for an already-removed KPI still needs its scope checked the same way
  const allowed = new Set();
  for (const kpi of kpis) { if (await canReadKpi(user, kpi)) allowed.add(kpi.id); }
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
router.get('/values', async (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year and month query params are required.' });
  const allowed = await readableKpiIds(req.user);
  const rows = (await db.prepare('SELECT * FROM kpi_values WHERE year = ? AND month = ?').all(year, month))
    .filter((row) => allowed.has(row.kpi_id));
  const values = [];
  for (const r of rows) values.push(await attachLate(await attachPreview(r)));
  res.json({ values });
});

// A range read across several months in one year — used by the quarterly /
// bi-annual / annual performance views, which report on the LATEST value
// available within the range rather than requiring a value for every month
// (data entry itself stays monthly; this is only a read-side rollup lens).
router.get('/values-range', async (req, res) => {
  const year = Number(req.query.year), fromMonth = Number(req.query.fromMonth), toMonth = Number(req.query.toMonth);
  if (!year || !fromMonth || !toMonth) return res.status(400).json({ error: 'year, fromMonth, and toMonth query params are required.' });
  const allowed = await readableKpiIds(req.user);
  const rows = (await db.prepare('SELECT * FROM kpi_values WHERE year = ? AND month BETWEEN ? AND ? ORDER BY month').all(year, fromMonth, toMonth))
    .filter((row) => allowed.has(row.kpi_id));
  const values = [];
  for (const row of rows) values.push(await attachPreview(row));
  res.json({ values });
});

// Live submission-window status for one reporting period — lets the
// frontend show a banner and disable Submit before ever attempting it,
// rather than only reacting to a rejected request. Every signed-in user
// may check this (it carries no KPI data of its own); no data_entry
// permission required, same as PeriodPicker being available to anyone.
router.get('/submission-window', async (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year and month query params are required.' });
  const win = await checkSubmissionWindow(year, month, req);
  res.json({ ...win, message: windowMessage(year, month, win) });
});

// Every current assignment, system-wide — small enough to serve whole and
// let the frontend narrow it per-unit/per-employee, the same pattern
// GET /org already uses for the org tree.
router.get('/assignments', async (req, res) => {
  // Soft-removed assignments (deleted_at set — see DELETE /:id/assign/:employeeId
  // below) drop out of the active list without who-assigned-whom-and-when
  // ever being destroyed.
  const allowed = await readableKpiIds(req.user);
  const assignments = (await db.prepare('SELECT * FROM kpi_assignments WHERE deleted_at IS NULL ORDER BY id').all())
    .filter((a) => allowed.has(a.kpi_id));
  res.json({ assignments });
});

// Delegate this Unit-owned KPI to an Employee within that same unit.
// Unit Head only, and only for their own unit's KPI and their own unit's
// people — see isUnitHeadOwner above. If this exact pairing was assigned
// before and later unassigned, that row still exists (deleted_at stamped,
// not deleted — see the DELETE route below) and the UNIQUE(kpi_id,
// employee_id) constraint means a plain INSERT would collide with it, so
// this restores that row instead of inserting a duplicate — same
// restore-over-insert care every other re-creation-after-removal in this
// app takes.
router.post('/:id/assign', requirePerm('data_entry'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'Only the Unit Head who owns this KPI can assign it.' });
  const { employeeId } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'employeeId is required.' });
  const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee || employee.unit_id !== kpi.owner_id) {
    return res.status(400).json({ error: 'That person is not in this unit.' });
  }

  const existing = await db.prepare('SELECT * FROM kpi_assignments WHERE kpi_id = ? AND employee_id = ?').get(kpi.id, employeeId);
  if (existing) {
    await db.prepare(
      "UPDATE kpi_assignments SET deleted_at = NULL, assigned_by = ?, assigned_at = datetime('now') WHERE id = ?"
    ).run(req.user.id, existing.id);
  } else {
    await db.prepare('INSERT INTO kpi_assignments (kpi_id, employee_id, assigned_by) VALUES (?, ?, ?)').run(kpi.id, employeeId, req.user.id);
  }
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'assign_kpi', 'kpi', kpi.id, `Assigned "${kpi.name}" to ${employee.name} (${employee.role_title}).`
  );
  res.status(201).json({ ok: true });
});

// Nothing is deleted — deleted_at stamped, same as every other removal in
// this app, so who was assigned, by whom, and when is never lost, and
// re-assigning the same person (POST above) restores this exact row.
router.delete('/:id/assign/:employeeId', requirePerm('data_entry'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!isUnitHeadOwner(req.user, kpi)) return res.status(403).json({ error: 'Only the Unit Head who owns this KPI can unassign it.' });
  const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.employeeId);

  await db.prepare(
    "UPDATE kpi_assignments SET deleted_at = datetime('now') WHERE kpi_id = ? AND employee_id = ? AND deleted_at IS NULL"
  ).run(kpi.id, req.params.employeeId);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'unassign_kpi', 'kpi', kpi.id, `Unassigned "${kpi.name}" from ${employee ? employee.name : `employee #${req.params.employeeId}`}. Re-assigning them restores this.`
  );
  res.json({ ok: true });
});

// NOTE: an Employee browsing-and-self-claiming a Unit-owned KPI (the
// previous POST/DELETE :id/claim here) has been removed in favor of
// routes/kpiTemplates.js's Unit-scoped KPI template pool: an Employee
// should only ever be offered KPIs genuinely created for employees (see
// that file), never their whole Unit's own aggregate KPI. A Unit Head can
// still explicitly delegate one of their Unit's KPIs to a specific person
// via POST/DELETE :id/assign above — that's a duty assigned TO someone by
// their Unit Head, not something the person found by browsing and helped
// themselves to.

// Batch read for a single period across every KPI's contributions — same
// shape/purpose as GET /values above, so My Data Entry (an Employee's own
// contributions), Approvals (a Unit Head's pending contributor reviews),
// and KpiCard (the per-contributor breakdown on a shared KPI) can each load
// what they need in one request instead of one per KPI.
router.get('/contributions', async (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year and month query params are required.' });
  const allowed = await readableKpiIds(req.user);
  const contributions = (await db.prepare('SELECT * FROM kpi_contributions WHERE year = ? AND month = ?').all(year, month))
    .filter((c) => allowed.has(c.kpi_id));
  const late = [];
  for (const c of contributions) late.push(await attachLate(c));
  res.json({ contributions: late });
});

// An assigned Employee sets/updates their OWN figure toward a shared
// Unit-owned KPI — never the KPI's own kpi_values row (see isOwner above).
router.put('/:id/contribution', requirePerm('data_entry'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await isAssignedEmployee(req.user, kpi)) return res.status(403).json({ error: 'You are not assigned to contribute to this KPI.' });
  const { year, month, value } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  if (value != null && !Number.isFinite(Number(value))) {
    return res.status(400).json({ error: 'value must be a number.' });
  }

  const existing = await db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND employee_id = ? AND year = ? AND month = ?')
    .get(kpi.id, req.user.scope_id, year, month);
  const wasApproved = existing && existing.status === 'approved';
  if (existing) {
    await db.prepare(
      `UPDATE kpi_contributions SET value = ?, status = ?, submitted_at = CASE WHEN ? THEN datetime('now') ELSE submitted_at END
       WHERE id = ?`
    ).run(value, wasApproved ? 'submitted' : existing.status, wasApproved ? 1 : 0, existing.id);
  } else {
    await db.prepare('INSERT INTO kpi_contributions (kpi_id, employee_id, year, month, value) VALUES (?, ?, ?, ?, ?)')
      .run(kpi.id, req.user.scope_id, year, month, value);
  }
  await recomputeUnitTotal(kpi.id, year, month);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, wasApproved ? 'amend_contribution' : 'enter_contribution', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} contribution set to ${value}${wasApproved ? ' (amendment on a previously approved contribution — returned to submitted).' : '.'}`
  );
  res.json({ contribution: await db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND employee_id = ? AND year = ? AND month = ?').get(kpi.id, req.user.scope_id, year, month) });
});

router.put('/:id/contribution/explanation', requirePerm('data_entry'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await isAssignedEmployee(req.user, kpi)) return res.status(403).json({ error: 'You are not assigned to contribute to this KPI.' });
  const { year, month, text } = req.body || {};
  const row = await db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND employee_id = ? AND year = ? AND month = ?').get(kpi.id, req.user.scope_id, year, month);
  if (!row) return res.status(404).json({ error: 'No contribution recorded for that period yet.' });
  await db.prepare('UPDATE kpi_contributions SET explanation = ? WHERE id = ?').run(text || null, row.id);
  res.json({ ok: true });
});

router.post('/:id/contribution/submit', requireAnyPerm('data_entry', 'submit_data_entries'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await isAssignedEmployee(req.user, kpi)) return res.status(403).json({ error: 'You are not assigned to contribute to this KPI.' });
  const { year, month } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  const win = await enforceSubmissionWindow(req, res, year, month); if (!win) return;
  const row = await db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND employee_id = ? AND year = ? AND month = ?').get(kpi.id, req.user.scope_id, year, month);
  if (!row) return res.status(404).json({ error: 'No contribution recorded for that period yet.' });
  if (row.value == null) return res.status(400).json({ error: 'Enter a value before submitting.' });

  await db.prepare('UPDATE kpi_contributions SET status = \'submitted\', submitted_at = ?, return_comment = NULL WHERE id = ?').run(nowSqlString(req), row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_contribution', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} contribution submitted to Unit Head for review${win.late ? ' (late — within the grace window).' : '.'}`
  );
  res.json({ ok: true, late: win.late });
});

// The Unit Head who owns this shared KPI approves ONE contributor's
// submitted figure — this is the "employees submit to their Unit Head for
// approval" step. Approving recomputes the KPI's own automated total (see
// recomputeUnitTotal) so it always reflects the real sum of what's actually
// been approved so far, never a stale or partial number.
router.post('/:id/contribution/:employeeId/approve', requireRole('cpu'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  const { year, month } = req.body || {};
  const row = await db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND employee_id = ? AND year = ? AND month = ?').get(kpi.id, req.params.employeeId, year, month);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that period.' });

  await db.prepare('UPDATE kpi_contributions SET status = \'approved\', approved_at = datetime(\'now\') WHERE id = ?').run(row.id);
  await recomputeUnitTotal(kpi.id, year, month);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_contribution', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} contribution from employee #${req.params.employeeId} approved.`
  );
  res.json({ ok: true });
});

router.post('/:id/contribution/:employeeId/return', requireRole('cpu'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  const { year, month, comment } = req.body || {};
  if (!comment) return res.status(400).json({ error: 'A reason is required when returning a submission.' });
  const row = await db.prepare('SELECT * FROM kpi_contributions WHERE kpi_id = ? AND employee_id = ? AND year = ? AND month = ?').get(kpi.id, req.params.employeeId, year, month);
  if (!row || row.status !== 'submitted') return res.status(400).json({ error: 'Nothing pending review for that period.' });

  await db.prepare('UPDATE kpi_contributions SET status = \'draft\', return_comment = ? WHERE id = ?').run(comment, row.id);
  await recomputeUnitTotal(kpi.id, year, month);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return_contribution', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} contribution from employee #${req.params.employeeId} returned: "${comment}"`
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
router.post('/', requirePerm('create_kpi'), async (req, res) => {
  const { ownerType, ownerId, name, type, measure, baseline, target, assigneeIds } = req.body || {};
  const measurementDirection = req.body?.measurementDirection || 'higher';
  const weight = req.body?.weight == null ? 1 : Number(req.body.weight);
  const achievementRule = req.body?.achievementRule || 'ratio';
  const reportingMode = req.body?.reportingMode || 'cumulative';
  const periodAggregation = req.body?.periodAggregation || 'latest';
  const reportingPeriods = req.body?.reportingPeriods || [];
  if (!ownerType || !ownerId || !name || !type || !measure || baseline == null || target == null) {
    return res.status(400).json({ error: 'ownerType, ownerId, name, type, measure, baseline, and target are all required.' });
  }
  if (!isFiniteNumberInput(baseline) || !isFiniteNumberInput(target)) {
    return res.status(400).json({ error: 'baseline and target must be finite numeric values.' });
  }
  if (!['sub', 'unit', 'employee'].includes(ownerType)) return res.status(400).json({ error: 'Invalid ownerType.' });
  if (!['higher', 'lower'].includes(measurementDirection)) return res.status(400).json({ error: 'measurementDirection must be higher or lower.' });
  if (!Number.isFinite(weight) || weight <= 0) return res.status(400).json({ error: 'weight must be a positive number.' });
  if (!['ratio', 'exact_target', 'baseline_progress'].includes(achievementRule)) {
    return res.status(400).json({ error: 'achievementRule must be ratio, exact_target, or baseline_progress.' });
  }
  if (!['cumulative', 'period'].includes(reportingMode)) {
    return res.status(400).json({ error: 'reportingMode must be cumulative or period.' });
  }
  if (!['sum', 'latest'].includes(periodAggregation)) {
    return res.status(400).json({ error: 'periodAggregation must be sum or latest.' });
  }
  if (!isValidReportingPeriods(reportingPeriods)) {
    return res.status(400).json({
      error: 'reportingPeriods must contain unique monthly, quarterly, biannual, or annual milestones with valid indexes and numeric expectedValue values.',
    });
  }
  if (req.body.allowableVariance != null
      && (!isFiniteNumberInput(req.body.allowableVariance) || Number(req.body.allowableVariance) < 0)) {
    return res.status(400).json({ error: 'allowableVariance must be a non-negative number.' });
  }

  const assignees = [...new Set((assigneeIds || []).map(Number))].filter(Boolean);
  if (assignees.length > 0) {
    if (ownerType !== 'unit') {
      return res.status(400).json({ error: 'Custodians can only be assigned to a Unit-owned KPI.' });
    }
    for (const iid of assignees) {
      const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(iid);
      if (!employee || employee.unit_id !== Number(ownerId)) {
        return res.status(400).json({ error: `Employee #${iid} is not in this unit.` });
      }
    }
  }

  const createTxn = db.transaction(async () => {
    const { lastInsertRowid: id } = await db
      .prepare(`INSERT INTO kpis (
        owner_type, owner_id, name, type, measure, baseline, target,
        measurement_direction, weight, description, strategic_objective,
        programme_id, sub_id, department_id, unit_id, data_source,
        evidence_requirements, allowable_variance, reporting_frequency,
        reporting_periods, start_date, end_date, strategic_plan_version,
        performance_cycle, lifecycle_status, reporting_mode, period_aggregation, achievement_rule
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
      .run(
        ownerType, ownerId, name, type, measure, Number(baseline), Number(target),
        measurementDirection, weight,
        req.body.description || null, req.body.strategicObjective || null,
        req.body.programmeId || null, req.body.subId || null,
        req.body.departmentId || null, req.body.unitId || null,
        req.body.dataSource || null, req.body.evidenceRequirements || null,
        req.body.allowableVariance == null ? null : Number(req.body.allowableVariance),
        req.body.reportingFrequency || null, JSON.stringify(req.body.reportingPeriods || []),
        req.body.startDate || null, req.body.endDate || null,
        req.body.strategicPlanVersion || null,
        req.body.performanceCycle == null ? null : Number(req.body.performanceCycle),
        reportingMode, periodAggregation, achievementRule
      );

    const now = new Date();
    await db.prepare('INSERT INTO kpi_values (kpi_id, year, month, status) VALUES (?, ?, ?, \'draft\')').run(id, now.getFullYear(), now.getMonth() + 1);

    for (const iid of assignees) {
      await db.prepare('INSERT OR IGNORE INTO kpi_assignments (kpi_id, employee_id, assigned_by) VALUES (?, ?, ?)').run(id, iid, req.user.id);
    }
    return id;
  });
  const id = await createTxn();

  const assignNote = assignees.length ? ` Assigned to ${assignees.length} custodian(s) at creation.` : '';
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_kpi', 'kpi', id, `KPI "${name}" created (owner: ${ownerType} #${ownerId}, baseline ${baseline}, target ${target}, ${measurementDirection}-is-better, weight ${weight}).${assignNote}`
  );
  res.status(201).json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(id) });
});

router.post('/:id/submit-configuration', requireAnyPerm('create_kpi', 'edit_kpi'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });
  if (!['draft', 'rejected'].includes(kpi.lifecycle_status)) {
    return res.status(400).json({ error: 'Only draft or rejected KPI configurations can be submitted.' });
  }
  await db.prepare(
    "UPDATE kpis SET lifecycle_status = 'submitted', submitted_at = datetime('now'), rejection_reason = NULL WHERE id = ?"
  ).run(kpi.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit_kpi_configuration', 'kpi', kpi.id,
    `KPI "${kpi.name}" submitted for approval. Baseline ${kpi.baseline}, target ${kpi.target}, weight ${kpi.weight}.`
  );
  res.json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

router.post('/:id/approve-configuration', requireRole('cpu'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (kpi.lifecycle_status !== 'submitted') {
    return res.status(400).json({ error: 'Only submitted KPI configurations can be approved.' });
  }
  const allocation = await validateOwnerWeightAllocation(kpi.owner_type, kpi.owner_id);
  if (!allocation.valid) {
    return res.status(400).json({
      error: `This approved allocation requires ${allocation.requiredTotal.toFixed(2)}% weight, but submitted, approved, and active KPIs total ${allocation.total.toFixed(2)}%.`,
      currentTotal: allocation.total,
      requiredTotal: allocation.requiredTotal,
      remainingWeight: allocation.requiredTotal - allocation.total,
    });
  }
  await db.transaction(async () => {
    await db.prepare(
      "UPDATE kpis SET lifecycle_status = 'active', approved_by = ?, approved_at = datetime('now') WHERE id = ?"
    ).run(req.user.id, kpi.id);
    const revisionNoRow = await db.prepare('SELECT COALESCE(MAX(revision_no), 0) + 1 AS next FROM kpi_revisions WHERE kpi_id = ?').get(kpi.id);
    await db.prepare(`
      INSERT INTO kpi_revisions
        (kpi_id, revision_no, name, description, baseline, target, weight, measurement_direction, configuration, changed_by, approved_by, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      kpi.id, revisionNoRow.next, kpi.name, kpi.description || null, kpi.baseline, kpi.target,
      kpi.weight, kpi.measurement_direction, JSON.stringify(kpi), req.user.id,
      req.user.id
    );
  })();
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_kpi_configuration', 'kpi', kpi.id,
    `KPI "${kpi.name}" approved and activated.`
  );
  res.json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

router.post('/:id/reject-configuration', requireRole('cpu'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required.' });
  if (kpi.lifecycle_status !== 'submitted') return res.status(400).json({ error: 'Only submitted KPI configurations can be rejected.' });
  await db.prepare(
    "UPDATE kpis SET lifecycle_status = 'rejected', rejection_reason = ? WHERE id = ?"
  ).run(reason, kpi.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'reject_kpi_configuration', 'kpi', kpi.id,
    `KPI "${kpi.name}" rejected: ${reason}`
  );
  res.json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

router.get('/configuration/weighting-allocations', async (req, res) => {
  const rows = await db.prepare(
    'SELECT * FROM weighting_allocations ORDER BY parent_type, parent_id NULLS FIRST, effective_from DESC, id'
  ).all();
  res.json({ allocations: rows });
});

router.post('/configuration/weighting-allocations', requireRole('cpu'), async (req, res) => {
  const {
    parentType, parentId, name, weight, allocationType,
    effectiveFrom, effectiveTo,
  } = req.body || {};
  if (!parentType || !name || weight == null || !allocationType || !effectiveFrom) {
    return res.status(400).json({ error: 'parentType, name, weight, allocationType, and effectiveFrom are required.' });
  }
  if (!['institution','programme','sub','unit','department','employee','senior_manager'].includes(parentType)) {
    return res.status(400).json({ error: 'Invalid parentType.' });
  }
  if (!['kpi','organisational','results_delivery','budget_performance'].includes(allocationType)) {
    return res.status(400).json({ error: 'Invalid allocationType.' });
  }
  const numericWeight = Number(weight);
  if (!Number.isFinite(numericWeight) || numericWeight < 0) {
    return res.status(400).json({ error: 'weight must be numeric and non-negative.' });
  }
  const { lastInsertRowid: id } = await db.prepare(`
    INSERT INTO weighting_allocations
      (parent_type, parent_id, name, weight, allocation_type, effective_from, effective_to, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(parentType, parentId == null ? null : Number(parentId), name, numericWeight, allocationType, effectiveFrom, effectiveTo || null, req.user.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_weighting_allocation', 'weighting_allocation', id,
    `Weight allocation "${name}" created for ${parentType} #${parentId || 0}: ${numericWeight}% (${allocationType}).`
  );
  res.status(201).json({ allocation: await db.prepare('SELECT * FROM weighting_allocations WHERE id = ?').get(id) });
});

router.post('/configuration/weighting-allocations/:id/approve', requireRole('cpu'), async (req, res) => {
  const allocation = await db.prepare('SELECT * FROM weighting_allocations WHERE id = ?').get(req.params.id);
  if (!allocation) return res.status(404).json({ error: 'Weight allocation not found.' });
  if (allocation.status !== 'draft') return res.status(400).json({ error: 'Only draft weight allocations can be approved.' });
  await db.prepare(
    "UPDATE weighting_allocations SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?"
  ).run(req.user.id, allocation.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve_weighting_allocation', 'weighting_allocation', allocation.id,
    `Weight allocation "${allocation.name}" approved.`
  );
  res.json({ allocation: await db.prepare('SELECT * FROM weighting_allocations WHERE id = ?').get(allocation.id) });
});

router.patch('/:id/reporting-periods', requireAnyPerm('manage_settings', 'edit_kpi', 'create_kpi'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await inJurisdiction(req.user, kpi)
      && !(isGlobalReader(req.user) && req.user.permissions?.includes('manage_settings'))) {
    return res.status(403).json({ error: 'This KPI is outside your scope.' });
  }
  const reportingPeriods = req.body?.reportingPeriods;
  if (!isValidReportingPeriods(reportingPeriods)) {
    return res.status(400).json({
      error: 'reportingPeriods must contain unique monthly, quarterly, biannual, or annual milestones with valid indexes and numeric expectedValue values.',
    });
  }
  await db.prepare('UPDATE kpis SET reporting_periods = ? WHERE id = ?')
    .run(JSON.stringify(reportingPeriods), kpi.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, 'update_kpi_reporting_periods', 'kpi', kpi.id, JSON.stringify(reportingPeriods));
  res.json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

router.patch('/:id/targets', requirePerm('edit_targets'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });
  const { baseline, target } = req.body || {};
  if (baseline == null || target == null) return res.status(400).json({ error: 'baseline and target are required.' });

  await db.prepare('UPDATE kpis SET baseline = ?, target = ? WHERE id = ?').run(Number(baseline), Number(target), kpi.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'edit_targets', 'kpi', kpi.id, `Baseline ${kpi.baseline} → ${baseline}; Target ${kpi.target} → ${target}.`
  );
  res.json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
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
router.put('/:id', requireAnyPerm('create_kpi', 'edit_kpi'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });
  const { name, type, measure, baseline, target } = req.body || {};
  const measurementDirection = req.body?.measurementDirection ?? kpi.measurement_direction ?? 'higher';
  const weight = req.body?.weight == null ? Number(kpi.weight ?? 1) : Number(req.body.weight);
  const achievementRule = req.body?.achievementRule ?? kpi.achievement_rule ?? 'ratio';
  const reportingMode = req.body?.reportingMode ?? kpi.reporting_mode ?? 'cumulative';
  const periodAggregation = req.body?.periodAggregation ?? kpi.period_aggregation ?? 'latest';
  const hasReportingPeriods = Object.prototype.hasOwnProperty.call(req.body || {}, 'reportingPeriods');
  const reportingPeriods = req.body?.reportingPeriods;
  if (!name || !type || !measure || baseline == null || target == null) {
    return res.status(400).json({ error: 'name, type, measure, baseline, and target are all required.' });
  }
  if (!['higher', 'lower'].includes(measurementDirection)) return res.status(400).json({ error: 'measurementDirection must be higher or lower.' });
  if (!Number.isFinite(weight) || weight <= 0) return res.status(400).json({ error: 'weight must be a positive number.' });
  if (!['ratio', 'exact_target', 'baseline_progress'].includes(achievementRule)) {
    return res.status(400).json({ error: 'achievementRule must be ratio, exact_target, or baseline_progress.' });
  }
  if (!['cumulative', 'period'].includes(reportingMode)) {
    return res.status(400).json({ error: 'reportingMode must be cumulative or period.' });
  }
  if (!['sum', 'latest'].includes(periodAggregation)) {
    return res.status(400).json({ error: 'periodAggregation must be sum or latest.' });
  }
  if (hasReportingPeriods && !isValidReportingPeriods(reportingPeriods)) {
    return res.status(400).json({
      error: 'reportingPeriods must contain unique monthly, quarterly, biannual, or annual milestones with valid indexes and numeric expectedValue values.',
    });
  }

  const reportingPeriodsUpdate = hasReportingPeriods ? ', reporting_periods = ?' : '';
  const updateParams = [
    name, type, measure, Number(baseline), Number(target), measurementDirection, weight,
    achievementRule, reportingMode, periodAggregation,
  ];
  if (hasReportingPeriods) updateParams.push(JSON.stringify(reportingPeriods));
  updateParams.push(kpi.id);
  await db.prepare(
    `UPDATE kpis SET name = ?, type = ?, measure = ?, baseline = ?, target = ?,
      measurement_direction = ?, weight = ?, achievement_rule = ?, reporting_mode = ?,
      period_aggregation = ?${reportingPeriodsUpdate}
     WHERE id = ?`
  ).run(...updateParams);
  const changes = [];
  if (name !== kpi.name) changes.push(`name "${kpi.name}" → "${name}"`);
  if (type !== kpi.type) changes.push(`type "${kpi.type}" → "${type}"`);
  if (measure !== kpi.measure) changes.push(`measure "${kpi.measure}" → "${measure}"`);
  if (Number(baseline) !== kpi.baseline) changes.push(`baseline ${kpi.baseline} → ${baseline}`);
  if (Number(target) !== kpi.target) changes.push(`target ${kpi.target} → ${target}`);
  if (measurementDirection !== kpi.measurement_direction) changes.push(`measurement direction ${kpi.measurement_direction} → ${measurementDirection}`);
  if (weight !== Number(kpi.weight)) changes.push(`weight ${kpi.weight} → ${weight}`);
  if (achievementRule !== (kpi.achievement_rule || 'ratio')) changes.push(`achievement rule ${kpi.achievement_rule || 'ratio'} → ${achievementRule}`);
  if (reportingMode !== (kpi.reporting_mode || 'cumulative')) changes.push(`reporting mode ${kpi.reporting_mode || 'cumulative'} → ${reportingMode}`);
  if (periodAggregation !== (kpi.period_aggregation || 'latest')) changes.push(`period aggregation ${kpi.period_aggregation || 'latest'} → ${periodAggregation}`);
  if (hasReportingPeriods && JSON.stringify(reportingPeriods) !== String(kpi.reporting_periods || '[]')) {
    changes.push('reporting pace milestones updated');
  }
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'edit_kpi', 'kpi', kpi.id, changes.length ? `KPI updated: ${changes.join('; ')}.` : 'KPI saved with no changes.'
  );
  res.json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

// Removes a KPI — stamped deleted_at, never a real SQL DELETE. Its recorded
// values, assignments, contributions, and template link all stay exactly as
// they were (nothing here references kpis(id) ON DELETE CASCADE anymore in
// practice, since the kpis row itself is never actually gone) — a removed
// KPI's whole performance history remains genuinely intact and traceable,
// not just summarized in an audit_log line. Fully reversible: POST
// /:id/restore below clears the stamp and the KPI reappears everywhere
// exactly as it was, values and all.
router.delete('/:id', requireAnyPerm('create_kpi', 'delete_kpi'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!await inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });

  await db.prepare("UPDATE kpis SET deleted_at = datetime('now') WHERE id = ?").run(kpi.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_kpi', 'kpi', kpi.id,
    `KPI "${kpi.name}" (owner: ${kpi.owner_type} #${kpi.owner_id}) removed. Its recorded values are kept and it's recoverable from Recently Removed.`
  );
  res.json({ ok: true });
});

// Recently-removed KPIs — the same "Recently Removed" idea routes/org.js's
// GET /api/org/removed already provides for the org structure, scoped to
// this create_kpi holder's own jurisdiction so a Unit Head only sees KPIs
// they could actually restore.
router.get('/removed', requireAnyPerm('create_kpi', 'delete_kpi'), async (req, res) => {
  const rows = await db.prepare("SELECT * FROM kpis WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all();
  const kpis = [];
  for (const k of rows) { if (await inJurisdiction(req.user, k)) kpis.push(k); }
  res.json({ kpis });
});

// Restore a previously-removed KPI — clears deleted_at and it reappears in
// every active list/lookup exactly as it was, values and all.
router.post('/:id/restore', requireAnyPerm('create_kpi', 'delete_kpi'), async (req, res) => {
  const kpi = await db.prepare('SELECT * FROM kpis WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!kpi) return res.status(404).json({ error: 'Removed KPI not found.' });
  if (!await inJurisdiction(req.user, kpi)) return res.status(403).json({ error: 'This KPI is outside your scope.' });

  await db.prepare('UPDATE kpis SET deleted_at = NULL WHERE id = ?').run(kpi.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_kpi', 'kpi', kpi.id, `KPI "${kpi.name}" restored.`
  );
  res.json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi.id) });
});

// What gets typed here is the KPI's cumulative actual as of this month. It
// is stored in entered_value and only becomes the official `value` when
// approved, so an amendment to an approved period remains a preview until
// its new actual is approved.
// here, even on an amendment to an already-approved period: nothing about
// "the official current performance" changes until an approver actually
// re-approves it (see POST :id/approve below) — same principle a
// contributor's own kpi_contributions figure already worked on before this.
router.put('/:id/value', requirePerm('data_entry'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
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

  const existing = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  const wasApproved = existing && existing.status === 'approved';
  if (existing) {
    await db.prepare(
      `UPDATE kpi_values SET entered_value = ?, status = ?, submitted_at = CASE WHEN ? THEN datetime('now') ELSE submitted_at END,
        review_comment = CASE WHEN ? THEN NULL ELSE review_comment END
       WHERE id = ?`
    ).run(value, wasApproved ? 'submitted' : existing.status, wasApproved ? 1 : 0, wasApproved ? 1 : 0, existing.id);
  } else {
    await db.prepare('INSERT INTO kpi_values (kpi_id, year, month, entered_value, status) VALUES (?, ?, ?, ?, \'draft\')').run(kpi.id, year, month, value);
  }
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, wasApproved ? 'amend_value' : 'enter_value', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} cumulative actual set to ${value}${wasApproved ? ' (amendment on a previously approved period, returned to submitted until re-approved).' : '.'}`
  );
  res.json({ value: await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month) });
});

router.post('/:id/submit', requireAnyPerm('data_entry', 'submit_data_entries'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!isOwner(req.user, kpi)) return res.status(403).json({ error: 'You can only submit KPIs you own.' });
  const { year, month } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: 'year and month are required.' });
  const win = await enforceSubmissionWindow(req, res, year, month); if (!win) return;
  const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period yet.' });
  // An automated (shared/contribution-summed) KPI's own row is never typed
  // into directly — its `value` is what recomputeUnitTotal already fills in
  // from approved contributions — so it's the one still gated on `value`
  // here; every directly-entered KPI (any owner tier) is gated on the
  // entered_value this route above actually writes to.
  const missing = kpi.is_automated ? row.value == null : row.entered_value == null;
  if (missing) return res.status(400).json({ error: 'Enter a value before submitting.' });

  await db.prepare('UPDATE kpi_values SET status = \'submitted\', submitted_at = ?, return_comment = NULL, review_comment = NULL WHERE id = ?').run(nowSqlString(req), row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'submit', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} submitted for review${win.late ? ' (late — within the grace window).' : '.'}`
  );
  res.json({ ok: true, late: win.late });
});

// Directly-entered values are cumulative actual snapshots. Automated shared
// values are computed from approved monthly contributions. Neither becomes
// official until CPU approves the Unit's submission.
router.post('/:id/approve', requireRole('cpu'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  const { year, month, feedback } = req.body || {};
  if (feedback != null && typeof feedback !== 'string') {
    return res.status(400).json({ error: 'feedback must be text.' });
  }
  const reviewComment = typeof feedback === 'string' ? feedback.trim() : '';
  if (reviewComment.length > 2000) {
    return res.status(400).json({ error: 'feedback must be 2000 characters or fewer.' });
  }
  const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  // Single stage, every tier alike: 'submitted' is the only pending status
  // now (see isApprover's own comment above for why the old sub-owned
  // 'programme_approved' intermediate stage was retired).
  const pendingStatuses = ['submitted'];
  if (!row || !pendingStatuses.includes(row.status)) return res.status(400).json({ error: 'Nothing pending review for that period.' });
  if (!await isApprover(req.user, kpi)) return res.status(403).json({ error: 'You are not the approver for this KPI.' });

  // This is where current performance becomes official: direct values are
  // stored as monthly cumulative actuals, and shared totals are recomputed
  // from approved contributions only now.
  let detail = `${year}-${String(month).padStart(2, '0')} approved.`;
  if (!kpi.is_automated) {
    const actual = Number(row.entered_value);
    await db.prepare('UPDATE kpi_values SET value = ?, status = \'approved\', approved_at = datetime(\'now\'), review_comment = ? WHERE id = ?').run(actual, reviewComment || null, row.id);
    detail = `${year}-${String(month).padStart(2, '0')} approved with cumulative actual ${actual}.`;
  } else {
    const base = await previousOfficialValue(kpi.id, year, month, kpi.baseline);
    const contributions = await db.prepare(
      "SELECT value FROM kpi_contributions WHERE kpi_id = ? AND year = ? AND month = ? AND status = 'approved'"
    ).all(kpi.id, year, month);
    const actual = base + contributions.reduce((sum, contribution) => sum + Number(contribution.value || 0), 0);
    await db.prepare('UPDATE kpi_values SET value = ?, status = \'approved\', approved_at = datetime(\'now\'), review_comment = ? WHERE id = ?').run(actual, reviewComment || null, row.id);
    await cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
    detail = `${year}-${String(month).padStart(2, '0')} approved with automated cumulative actual ${actual}.`;
  }
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'approve', 'kpi', kpi.id, detail
  );
  res.json({ ok: true });
});

router.post('/:id/return', requireRole('cpu'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  const { year, month, comment } = req.body || {};
  if (typeof comment !== 'string' || !comment.trim()) return res.status(400).json({ error: 'A reason is required when returning a submission.' });
  if (comment.trim().length > 2000) return res.status(400).json({ error: 'The return reason must be 2000 characters or fewer.' });
  const returnComment = comment.trim();
  const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  const pendingStatuses = ['submitted'];
  if (!row || !pendingStatuses.includes(row.status)) return res.status(400).json({ error: 'Nothing pending review for that period.' });
  if (!await isApprover(req.user, kpi)) return res.status(403).json({ error: 'You are not the approver for this KPI.' });

  // A return always goes all the way back to whoever actually owns the
  // data as a plain draft with the reviewer's comment attached — the same
  // rule every other return in this app already follows (never bounced to
  // an intermediate reviewer to pass along; there is no intermediate stage
  // in this cascade any more).
  await db.prepare('UPDATE kpi_values SET status = \'draft\', return_comment = ?, review_comment = ? WHERE id = ?').run(returnComment, returnComment, row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'return', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} returned: "${returnComment}"`
  );
  res.json({ ok: true });
});

router.post('/:id/override', requirePerm('apply_override'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!kpi.is_automated) return res.status(400).json({ error: 'Overrides only apply to automated KPIs.' });
  const { year, month, value, note } = req.body || {};
  if (value == null || !note) return res.status(400).json({ error: 'An override value and a note are both required.' });
  const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period yet.' });

  // A fresh override supersedes any earlier one that was cleared and left
  // sitting in the _cleared shadow columns below — that shadow is a "restore
  // what I just cleared" target, not a permanent log, so it's retired the
  // moment a genuinely new override is applied over it.
  await db.prepare(
    'UPDATE kpi_values SET override_value = ?, override_note = ?, override_cleared_value = NULL, override_cleared_note = NULL, override_cleared_at = NULL WHERE id = ?'
  ).run(value, note, row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override', 'kpi', kpi.id, `${year}-${String(month).padStart(2, '0')} overridden to ${value}. Note: "${note}"`
  );
  // previousOfficialValue prefers override_value over value whenever both
  // exist, so this new override just changed what every LATER period's base
  // resolves to — walk them forward the same as any other change to this
  // period's effective figure.
  await cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
  res.json({ ok: true });
});

// Clearing an override never destroys it: the live value/note move into
// override_cleared_value/override_cleared_note (stamped override_cleared_at)
// before being nulled, so POST /:id/override/restore below can put them
// straight back — the same shadow-and-restore shape every deletion in this
// app uses, just scoped to one field pair on an existing row instead of a
// whole entity, since there's no separate row here to stamp deleted_at on.
router.delete('/:id/override', requirePerm('apply_override'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  const { year, month } = req.body || {};
  const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period.' });
  if (row.override_value == null) return res.status(400).json({ error: 'There is no active override for that period.' });
  await db.prepare(
    "UPDATE kpi_values SET override_cleared_value = override_value, override_cleared_note = override_note, override_cleared_at = datetime('now'), override_value = NULL, override_note = NULL WHERE id = ?"
  ).run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override_clear', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} override removed (was ${row.override_value}, "${row.override_note}"). Nothing is deleted — it's recoverable.`
  );
  // This period's effective figure just fell back from override_value to
  // its plain computed value — every later period's base needs the same
  // forward walk as any other change here.
  await cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
  res.json({ ok: true });
});

// Restore a just-cleared override — copies override_cleared_value/note back
// onto the live fields and clears the shadow, undoing exactly what the
// DELETE above just did. Requires a clean slate (no live override already
// in place) so it never silently clobbers a genuinely new one someone
// applied since — same invariant a Programme/Employee restore keeps by
// only ever restoring into a normal, non-conflicting active state.
router.post('/:id/override/restore', requirePerm('apply_override'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  const { year, month } = req.body || {};
  const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period.' });
  if (row.override_cleared_at == null) return res.status(404).json({ error: 'No recently-cleared override to restore for that period.' });
  if (row.override_value != null) return res.status(400).json({ error: 'There is already an active override for that period — clear it first.' });
  await db.prepare(
    'UPDATE kpi_values SET override_value = override_cleared_value, override_note = override_cleared_note, override_cleared_value = NULL, override_cleared_note = NULL, override_cleared_at = NULL WHERE id = ?'
  ).run(row.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'override_restore', 'kpi', kpi.id,
    `${year}-${String(month).padStart(2, '0')} override restored to ${row.override_cleared_value}.`
  );
  // Same reasoning as applying a fresh override — this period's effective
  // figure just changed again, so later periods need re-walking forward.
  await cascadeRecomputeForward(kpi.id, Number(year), Number(month), req.user.id);
  res.json({ ok: true });
});

router.put('/:id/explanation', requirePerm('data_entry'), async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  if (!isOwner(req.user, kpi)) return res.status(403).json({ error: 'You can only annotate KPIs you own.' });
  const { year, month, text } = req.body || {};
  const row = await db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(kpi.id, year, month);
  if (!row) return res.status(404).json({ error: 'No value recorded for that period yet.' });
  await db.prepare(
    'UPDATE kpi_values SET explanation = ?, achievement_date = ?, evidence = ?, challenges = ?, corrective_actions = ? WHERE id = ?'
  ).run(
    text || null, req.body.achievementDate || null, req.body.evidence || null,
    req.body.challenges || null, req.body.correctiveActions || null, row.id
  );
  res.json({ ok: true });
});

// ---- personal "hide from my view" preference -----------------------------
// Deliberately open to any signed-in role — this never touches the KPI
// itself or anyone else's view, so there's no ownership/jurisdiction check
// to make: an employee, a Unit Head, a Sub-programme Rep, a Programme
// Head, CPU, exec — every tier can curate what they personally browse.
// requirePerm('data_entry') isn't right here (a role without it, e.g. exec,
// still browses Overview and should still be able to hide) — just
// requireAuth, already applied to the whole router above.

router.get('/hidden', async (req, res) => {
  const rows = await db.prepare('SELECT kpi_id FROM kpi_hidden WHERE user_id = ?').all(req.user.id);
  res.json({ hidden: rows.map((r) => r.kpi_id) });
});

router.post('/:id/hide', async (req, res) => {
  const kpi = await getKpiOr404(req, res); if (!kpi) return;
  await db.prepare('INSERT OR IGNORE INTO kpi_hidden (user_id, kpi_id) VALUES (?, ?)').run(req.user.id, kpi.id);
  res.status(201).json({ ok: true });
});

router.delete('/:id/hide', async (req, res) => {
  await db.prepare('DELETE FROM kpi_hidden WHERE user_id = ? AND kpi_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
