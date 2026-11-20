// Two distinct, real compliance concerns, computed live from persisted data —
// nothing simulated or pre-baked:
//   1. Late-submission compliance: is a Sub-programme's own KPI reporting
//      coming in within the cut-off days configured in Settings?
//   2. Target-performance escalation: has a KPI's performance against its
//      target remained below threshold for several reporting periods?
// Progress-pace alerts are handled separately by performanceMonitoring.
// Target-performance threshold crossings also generate durable notifications
// in performanceMonitoring, following the configured Programme and
// institutional escalation thresholds.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isGlobalReader, canReadSub, canReadKpi } = require('../utils/scope');
const { consecutivePerformanceStreak } = require('../utils/compliance');
const { matchesComplianceSub } = require('../utils/complianceFilters');
const { calculatePerformanceAgainstTarget } = require('../utils/performanceAgainstTarget');

const router = express.Router();
router.use(requireAuth);

async function getSettings() {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach((r) => { s[r.key] = isNaN(Number(r.value)) ? r.value : Number(r.value); });
  return {
    ragGreen: s.ragGreen ?? 80,
    ragAmber: s.ragAmber ?? 50,
    lateCutoffSub: s.lateCutoffSub ?? 7,
    escalateProgramme: s.escalateProgramme ?? 6,
    escalateVC: s.escalateVC ?? 11,
    redEscalateProgramme: s.redEscalateProgramme ?? 2,
    redEscalateVC: s.redEscalateVC ?? 4,
  };
}

// SQLite datetime('now') strings are UTC with no offset marker — treat them
// as such explicitly so day-math below isn't silently off by the server's
// local timezone.
function parseUtc(s) { return s ? new Date(s.replace(' ', 'T') + 'Z') : null; }
function daysBetween(a, b) { return Math.ceil((b.getTime() - a.getTime()) / 86400000); }

async function ownerName(kpi) {
  if (kpi.owner_type === 'university') return 'University';
  if (kpi.owner_type === 'programme') return (await db.prepare('SELECT name FROM programmes WHERE id = ?').get(kpi.owner_id))?.name || '—';
  if (kpi.owner_type === 'sub') return (await db.prepare('SELECT name FROM subs WHERE id = ?').get(kpi.owner_id))?.name || '—';
  if (kpi.owner_type === 'unit') return (await db.prepare('SELECT name FROM units WHERE id = ?').get(kpi.owner_id))?.name || '—';
  return '—';
}

function chainFor(measure, programmeTrigger, vcTrigger) {
  const chain = [];
  if (measure >= programmeTrigger) chain.push('Programme Head');
  if (measure >= vcTrigger) chain.push('VC / Council');
  return chain;
}

router.get('/', async (req, res) => {
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const ownerType = req.query.ownerType == null ? '' : String(req.query.ownerType);
  const ownerId = req.query.ownerId == null ? null : Number(req.query.ownerId);
  if ((ownerType || ownerId != null) && (
    !['programme', 'sub', 'unit', 'employee'].includes(ownerType)
    || !Number.isSafeInteger(ownerId)
    || ownerId < 1
  )) {
    return res.status(400).json({ error: 'A valid ownerType and ownerId are required for organisation filtering.' });
  }
  const settings = await getSettings();

  // ---- 1. Late-submission compliance, per Sub-programme, for this period ----
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const dueDate = new Date(monthEnd.getTime() + settings.lateCutoffSub * 86400000);

  // Every role that navigates here is a global reader (see lib/nav.js's
  // ROLE_NAV_KEYS), so each sees the org-wide compliance picture. Other
  // authenticated roles calling the endpoint directly remain scoped to
  // their own branch (see utils/scope.js).
  const seesWholeOrg = isGlobalReader(req.user);
  const allSubs = await db.prepare(
    `SELECT s.id, s.name, s.programme_id, p.name AS programme_name FROM subs s JOIN programmes p ON p.id = s.programme_id
     WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY p.id, s.id`
  ).all();
  let selectedSubId = null;
  if (ownerType === 'sub') selectedSubId = ownerId;
  if (ownerType === 'unit') {
    selectedSubId = (await db.prepare('SELECT sub_id FROM units WHERE id = ? AND deleted_at IS NULL').get(ownerId))?.sub_id ?? null;
  }
  if (ownerType === 'employee') {
    selectedSubId = (await db.prepare(
      `SELECT u.sub_id FROM employees e JOIN units u ON u.id = e.unit_id
       WHERE e.id = ? AND e.deleted_at IS NULL AND u.deleted_at IS NULL`
    ).get(ownerId))?.sub_id ?? null;
  }
  const subs = [];
  for (const sub of allSubs) {
    if (!matchesComplianceSub(sub, ownerType, ownerId, selectedSubId)) continue;
    if (seesWholeOrg || await canReadSub(req.user, sub.id)) subs.push(sub);
  }

  const subRows = [];
  for (const sub of subs) {
    const kpis = await db.prepare("SELECT id FROM kpis WHERE owner_type = 'sub' AND owner_id = ? AND deleted_at IS NULL").all(sub.id);
    let lateBy = 0;
    let hasKpis = kpis.length > 0;
    for (const k of kpis) {
      const v = await db.prepare('SELECT status, submitted_at FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(k.id, year, month);
      let kpiLateBy = 0;
      if (!v || v.status === 'draft') {
        if (now > dueDate) kpiLateBy = daysBetween(dueDate, now);
      } else if (v.submitted_at) {
        const submittedAt = parseUtc(v.submitted_at);
        if (submittedAt > dueDate) kpiLateBy = daysBetween(dueDate, submittedAt);
      }
      lateBy = Math.max(lateBy, kpiLateBy);
    }
    const status = !hasKpis ? 'none' : lateBy > 0 ? 'late' : now > dueDate ? 'on_time' : 'due_soon';
    subRows.push({ subId: sub.id, subName: sub.name, programmeName: sub.programme_name, kpiCount: kpis.length, lateBy, status });
  }

  const lateEscalations = subRows
    .filter((r) => r.lateBy > 0)
    .map((r) => ({ ...r, chain: chainFor(r.lateBy, settings.escalateProgramme, settings.escalateVC) }))
    .filter((r) => r.chain.length > 0);

  // ---- 2. Target-performance escalation — consecutive low-performance periods.
  // Employee-tier KPIs are personal targets, not institutionally escalated
  // (matches how they're excluded from every roll-up elsewhere in the app).
  let kpiQuery = `
    SELECT k.*
    FROM kpis k
    LEFT JOIN units u ON k.owner_type = 'unit' AND k.owner_id = u.id
    LEFT JOIN subs s ON (k.owner_type = 'sub' AND k.owner_id = s.id) OR u.sub_id = s.id
    LEFT JOIN programmes p ON (k.owner_type = 'programme' AND k.owner_id = p.id) OR s.programme_id = p.id
    WHERE k.owner_type != 'employee' AND k.deleted_at IS NULL`;
  const kpiParams = [];
  if (ownerType === 'programme') {
    kpiQuery += " AND ((k.owner_type = 'programme' AND k.owner_id = ?) OR p.id = ?)";
    kpiParams.push(ownerId, ownerId);
  } else if (ownerType === 'sub') {
    kpiQuery += " AND ((k.owner_type = 'sub' AND k.owner_id = ?) OR u.sub_id = ?)";
    kpiParams.push(ownerId, ownerId);
  } else if (ownerType === 'unit') {
    kpiQuery += " AND k.owner_type = 'unit' AND k.owner_id = ?";
    kpiParams.push(ownerId);
  } else if (ownerType === 'employee') {
    kpiQuery += ' AND 1 = 0';
  }
  kpiQuery += ' ORDER BY k.id';
  const allKpis = await db.prepare(kpiQuery).all(...kpiParams);
  const kpis = [];
  for (const kpi of allKpis) { if (seesWholeOrg || await canReadKpi(req.user, kpi)) kpis.push(kpi); }
  const redKpis = [];
  for (const kpi of kpis) {
    const history = await db.prepare(
      'SELECT * FROM kpi_values WHERE kpi_id = ? AND (year < ? OR (year = ? AND month <= ?)) ORDER BY year DESC, month DESC'
    ).all(kpi.id, year, year, month);
    const streak = consecutivePerformanceStreak(history, kpi, settings.ragAmber);
    if (streak > 0) {
      const latestOfficial = history.find((row) =>
        (row.status === 'approved' || row.approved_at != null)
        && (row.override_value != null || row.value != null)
      );
      const actual = latestOfficial.override_value != null ? latestOfficial.override_value : latestOfficial.value;
      const performancePct = calculatePerformanceAgainstTarget(kpi, actual).performancePct;
      redKpis.push({
        kpiId: kpi.id,
        kpiName: kpi.name,
        ownerType: kpi.owner_type,
        ownerId: kpi.owner_id,
        ownerName: await ownerName(kpi),
        actualValue: Number(actual),
        target: Number(kpi.target),
        performancePct,
        performanceThreshold: settings.ragAmber,
        streak,
      });
    }
  }

  const redEscalations = redKpis
    .map((r) => ({ ...r, chain: chainFor(r.streak, settings.redEscalateProgramme, settings.redEscalateVC) }))
    .filter((r) => r.chain.length > 0);

  res.json({
    period: { year, month },
    settings,
    subs: subRows,
    lateEscalations,
    redKpis,
    redEscalations,
  });
});

module.exports = router;
