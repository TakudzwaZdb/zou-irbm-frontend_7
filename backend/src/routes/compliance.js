// Two distinct, real compliance concerns, computed live from persisted data —
// nothing simulated or pre-baked:
//   1. Late-submission compliance: is a Sub-programme's own KPI reporting
//      coming in within the cut-off days configured in Settings?
//   2. Red-KPI performance escalation: has a KPI been behind target for
//      several reporting periods in a row (separate from lateness — a KPI
//      can be submitted perfectly on time and still be Red)?
// Both escalate up the org hierarchy (Programme Head, then VC/Council) once
// they cross the trigger thresholds in Settings. There is no email/notification
// engine behind this — like the rest of the app's "alerts", it is a live view
// computed from real rows, surfaced for a person to act on.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isGlobalReader, canReadSub, canReadKpi } = require('../utils/scope');

const router = express.Router();
router.use(requireAuth);

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
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

function ownerName(kpi) {
  if (kpi.owner_type === 'sub') return db.prepare('SELECT name FROM subs WHERE id = ?').get(kpi.owner_id)?.name || '—';
  if (kpi.owner_type === 'unit') return db.prepare('SELECT name FROM units WHERE id = ?').get(kpi.owner_id)?.name || '—';
  return db.prepare('SELECT name FROM individuals WHERE id = ?').get(kpi.owner_id)?.name || '—';
}

function chainFor(measure, programmeTrigger, vcTrigger) {
  const chain = [];
  if (measure >= programmeTrigger) chain.push('Programme Head');
  if (measure >= vcTrigger) chain.push('VC / Council');
  return chain;
}

router.get('/', (req, res) => {
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const settings = getSettings();

  // ---- 1. Late-submission compliance, per Sub-programme, for this period ----
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const dueDate = new Date(monthEnd.getTime() + settings.lateCutoffSub * 86400000);

  // Only exec/cpu ever navigate here (see lib/nav.js's ROLE_NAV_KEYS — the
  // two roles who actually act on an escalation), and both are global
  // readers already, so this changes nothing either of them could already
  // see. It closes the same direct-API gap as kpis.js/plans.js for anyone
  // else calling this endpoint straight: a Sub Rep/Unit Head/Programme
  // Head/Individual gets their own branch's compliance picture, never
  // another's (see utils/scope.js).
  const seesWholeOrg = isGlobalReader(req.user);
  const subs = db.prepare(
    `SELECT s.id, s.name, p.name AS programme_name FROM subs s JOIN programmes p ON p.id = s.programme_id
     WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY p.id, s.id`
  ).all().filter((sub) => seesWholeOrg || canReadSub(req.user, sub.id));

  const subRows = subs.map((sub) => {
    const kpis = db.prepare("SELECT id FROM kpis WHERE owner_type = 'sub' AND owner_id = ? AND deleted_at IS NULL").all(sub.id);
    let lateBy = 0;
    let hasKpis = kpis.length > 0;
    kpis.forEach((k) => {
      const v = db.prepare('SELECT status, submitted_at FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?').get(k.id, year, month);
      let kpiLateBy = 0;
      if (!v || v.status === 'draft') {
        if (now > dueDate) kpiLateBy = daysBetween(dueDate, now);
      } else if (v.submitted_at) {
        const submittedAt = parseUtc(v.submitted_at);
        if (submittedAt > dueDate) kpiLateBy = daysBetween(dueDate, submittedAt);
      }
      lateBy = Math.max(lateBy, kpiLateBy);
    });
    const status = !hasKpis ? 'none' : lateBy > 0 ? 'late' : now > dueDate ? 'on_time' : 'due_soon';
    return { subId: sub.id, subName: sub.name, programmeName: sub.programme_name, kpiCount: kpis.length, lateBy, status };
  });

  const lateEscalations = subRows
    .filter((r) => r.lateBy > 0)
    .map((r) => ({ ...r, chain: chainFor(r.lateBy, settings.escalateProgramme, settings.escalateVC) }))
    .filter((r) => r.chain.length > 0);

  // ---- 2. Red-KPI performance escalation — consecutive Red reporting periods.
  // Individual-tier KPIs are personal targets, not institutionally escalated
  // (matches how they're excluded from every roll-up elsewhere in the app).
  const kpis = db.prepare("SELECT * FROM kpis WHERE owner_type != 'individual' AND deleted_at IS NULL ORDER BY id").all()
    .filter((kpi) => seesWholeOrg || canReadKpi(req.user, kpi));
  const redKpis = [];
  kpis.forEach((kpi) => {
    const history = db.prepare('SELECT * FROM kpi_values WHERE kpi_id = ? ORDER BY year DESC, month DESC').all(kpi.id);
    let streak = 0;
    for (const v of history) {
      const val = v.override_value != null ? v.override_value : v.value;
      if (val == null) break;
      const base = Number(kpi.baseline), tgt = Number(kpi.target);
      const pct = tgt === base ? (val >= tgt ? 100 : 0) : Math.round(((val - base) / (tgt - base)) * 100);
      if (pct >= settings.ragAmber) break; // amber or green — the streak of Red ends here
      streak++;
    }
    if (streak > 0) redKpis.push({ kpiId: kpi.id, kpiName: kpi.name, ownerType: kpi.owner_type, ownerName: ownerName(kpi), streak });
  });

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
