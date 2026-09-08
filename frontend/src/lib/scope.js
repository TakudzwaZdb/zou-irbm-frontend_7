// Mirrors backend/src/routes/kpis.js exactly. The UI uses this only to
// decide what to SHOW — the server re-derives and re-checks all of this
// itself on every request, so nothing here is a trust boundary.
export function byId(arr, id) { return arr.find((x) => x.id === id) || null; }

export function unitSubId(org, unitId) {
  const u = byId(org.units, unitId);
  return u ? u.sub_id : null;
}
export function individualUnitId(org, individualId) {
  const i = byId(org.individuals, individualId);
  return i ? i.unit_id : null;
}
export function kpiSubId(org, kpi) {
  if (kpi.owner_type === 'sub') return kpi.owner_id;
  if (kpi.owner_type === 'unit') return unitSubId(org, kpi.owner_id);
  return unitSubId(org, individualUnitId(org, kpi.owner_id));
}
export function isOwner(user, kpi) {
  if (kpi.owner_type === 'sub') return user.role === 'rep' && user.scope_id === kpi.owner_id;
  if (kpi.owner_type === 'unit') return user.role === 'unithead' && user.scope_id === kpi.owner_id;
  return user.role === 'individual' && user.scope_id === kpi.owner_id;
}
// Mirrors backend/src/routes/kpis.js's isApprover exactly: single-stage,
// one real approver per tier — Individual-owned by its Unit Head,
// Unit-owned by its Sub-programme Rep, and Sub-owned by that
// Sub-programme's own Programme Head, final, with no further CPU stage.
// (A sub-owned KPI used to pass through a second CPU sign-off stage after
// the Programme Head, gated on a now-retired `status === 'programme_approved'`
// check here; that's been removed by deliberate request.)
export function isApprover(org, user, kpi) {
  if (kpi.owner_type === 'individual') return user.role === 'unithead' && user.scope_id === individualUnitId(org, kpi.owner_id);
  if (kpi.owner_type === 'unit') return user.role === 'rep' && user.scope_id === unitSubId(org, kpi.owner_id);
  const programmeId = byId(org.subs, kpi.owner_id)?.programme_id;
  return user.role === 'programme' && programmeId != null && user.scope_id === programmeId;
}
export function inJurisdiction(org, user, kpi) {
  if (['cpu', 'ictadmin', 'exec'].includes(user.role)) return true;
  if (user.role === 'rep') return kpiSubId(org, kpi) === user.scope_id;
  if (user.role === 'unithead') {
    if (kpi.owner_type === 'unit') return kpi.owner_id === user.scope_id;
    if (kpi.owner_type === 'individual') return individualUnitId(org, kpi.owner_id) === user.scope_id;
    return false;
  }
  if (user.role === 'individual') return kpi.owner_type === 'individual' && kpi.owner_id === user.scope_id;
  // A Programme Head's jurisdiction is read-only oversight of every KPI
  // owned anywhere within their own Programme's Sub-programmes (a Programme
  // never owns KPIs directly) — the same "everything beneath my own branch,
  // never another Programme's" shape as Rep/Unit Head above.
  if (user.role === 'programme') {
    const subId = kpiSubId(org, kpi);
    return subId != null && byId(org.subs, subId)?.programme_id === user.scope_id;
  }
  return false;
}
export function ownerName(org, kpi) {
  if (kpi.owner_type === 'sub') return byId(org.subs, kpi.owner_id)?.name || '—';
  if (kpi.owner_type === 'unit') return byId(org.units, kpi.owner_id)?.name || '—';
  return byId(org.individuals, kpi.owner_id)?.name || '—';
}

// The owner's tier, in plain words — shown alongside ownerName() wherever a
// chart or list needs to disambiguate two same-named KPIs owned by two
// different people/units/sub-programmes (e.g. two Individuals both holding
// a "Vacuum Cleaning" duty KPI in different Units — the name alone doesn't
// tell them apart, but "T. Moyo — Individual" vs "R. Banda — Individual"
// does, and the chart still shows both bars distinctly by owner name too).
export function ownerKindLabel(kpi) {
  if (kpi.owner_type === 'sub') return 'Sub-programme';
  if (kpi.owner_type === 'unit') return 'Unit';
  return 'Individual';
}

// ---- org-tree navigation helpers (Overview drill-down + sidebar tree) ----
// Mirrors the original prototype's Programme → Sub-programme → Unit →
// Individual browsing: click a node, see its own breadcrumb and its own
// cascaded performance (see nodeOwnKpis below), with its children one click
// further in.
export const ROLE_LABEL = {
  exec: 'Executive', cpu: 'Corporate Planning Unit', ictadmin: 'ICT Systems Administrator',
  rep: 'Sub-programme Rep', unithead: 'Unit Head', individual: 'Individual', programme: 'Programme Head',
  council: 'University Council',
};

// How deep Overview's Programme -> Sub-programme -> Unit -> Individual
// drill-down may go for one account — see db.js's users.overview_limit /
// routes/users.js's PATCH /:id/overview-limit. A visibility ceiling ICT
// admin can place on top of whatever a role would otherwise see; unset
// (null/undefined) means no cap at all — "the overall structure", every
// tier down to Individual. This only ever gates the exploratory Overview
// browse (AppContext's selectNode / Overview.jsx's ChildCards) — never an
// accountability surface (My Data Entry, Approvals Queue, alerts), which
// always show a person's own real duties regardless of this setting.
const OVERVIEW_KIND_DEPTH = { programme: 0, sub: 1, unit: 2, individual: 3 };
export function overviewCapDepth(user) {
  const limit = user?.overview_limit;
  return limit && OVERVIEW_KIND_DEPTH[limit] != null ? OVERVIEW_KIND_DEPTH[limit] : Infinity;
}
export function canDrillToKind(user, kind) {
  return OVERVIEW_KIND_DEPTH[kind] <= overviewCapDepth(user);
}
export function subsOfProgramme(org, programmeId) { return org.subs.filter((s) => s.programme_id === programmeId); }
export function unitsOfSub(org, subId) { return org.units.filter((u) => u.sub_id === subId); }
export function individualsOfUnit(org, unitId) { return org.individuals.filter((i) => i.unit_id === unitId); }
export function kpisOf(kpis, ownerType, ownerId) { return kpis.filter((k) => k.owner_type === ownerType && k.owner_id === ownerId); }

// The KPIs that count toward a given node's performance score — a full
// cascade, not just what that tier owns directly: a Unit's score is its own
// Unit KPIs PLUS every KPI owned by an Individual in that Unit; a
// Sub-programme's score is its own Sub KPIs PLUS every Unit beneath it
// (transitively, so Individuals count too); a Programme's score is its
// Sub-programmes' own KPIs PLUS everything beneath THEM. An Individual's
// score is just their own KPIs — nothing sits below an Individual to fold
// in. This is deliberate: a real person's real monthly number should move
// the needle at every tier above them, not stay siloed at the level it was
// entered — the same principle the shared-KPI contribution system (see
// kpi_contributions on the backend) already applies within one Unit, now
// carried all the way up to Sub-programme and Programme.
export function nodeOwnKpis(org, kpis, kind, id) {
  if (kind === 'individual') return kpisOf(kpis, 'individual', id);
  if (kind === 'unit') {
    return kpisOf(kpis, 'unit', id).concat(
      individualsOfUnit(org, id).reduce((acc, i) => acc.concat(kpisOf(kpis, 'individual', i.id)), [])
    );
  }
  if (kind === 'sub') {
    return kpisOf(kpis, 'sub', id).concat(
      unitsOfSub(org, id).reduce((acc, u) => acc.concat(nodeOwnKpis(org, kpis, 'unit', u.id)), [])
    );
  }
  // programme
  return subsOfProgramme(org, id).reduce((acc, s) => acc.concat(nodeOwnKpis(org, kpis, 'sub', s.id)), []);
}

// RAG classification for a rolled-up node (same green/amber/red thresholds
// as computeRag, applied to the averaged progress of a whole KPI list).
export function nodeRagCls(rollup, settings) {
  if (rollup.avgPct == null) return 'chip-rag-none';
  const green = Number(settings.ragGreen ?? 80);
  const amber = Number(settings.ragAmber ?? 50);
  return rollup.avgPct >= green ? 'chip-rag-green' : rollup.avgPct >= amber ? 'chip-rag-amber' : 'chip-rag-red';
}

// The node kind+id an org node's own entity sits at, and its full ancestor
// chain from Programme down to itself (inclusive) — used for the "Home /
// Programme / Sub-programme / Unit / Individual" breadcrumb.
export function nodeAncestryChain(org, kind, id) {
  if (kind === 'programme') {
    const p = byId(org.programmes, id);
    return p ? [{ kind: 'programme', id: p.id, name: p.name }] : [];
  }
  if (kind === 'sub') {
    const s = byId(org.subs, id);
    if (!s) return [];
    const p = byId(org.programmes, s.programme_id);
    return [p && { kind: 'programme', id: p.id, name: p.name }, { kind: 'sub', id: s.id, name: s.name }].filter(Boolean);
  }
  if (kind === 'unit') {
    const u = byId(org.units, id);
    if (!u) return [];
    const s = byId(org.subs, u.sub_id);
    const p = s && byId(org.programmes, s.programme_id);
    return [p && { kind: 'programme', id: p.id, name: p.name }, s && { kind: 'sub', id: s.id, name: s.name }, { kind: 'unit', id: u.id, name: u.name }].filter(Boolean);
  }
  const ind = byId(org.individuals, id);
  if (!ind) return [];
  const u = byId(org.units, ind.unit_id);
  const s = u && byId(org.subs, u.sub_id);
  const p = s && byId(org.programmes, s.programme_id);
  return [
    p && { kind: 'programme', id: p.id, name: p.name },
    s && { kind: 'sub', id: s.id, name: s.name },
    u && { kind: 'unit', id: u.id, name: u.name },
    { kind: 'individual', id: ind.id, name: ind.name },
  ].filter(Boolean);
}

// The org node a scoped (non-global) role always lands on by default — a
// Sub-programme Rep's own Sub-programme, a Unit Head's own Unit, an
// Individual's own record. Global roles (cpu/exec/ictadmin) have none —
// their default is "All Programmes", driven entirely by selNode.
export function defaultNodeForRole(user) {
  if (user.role === 'individual') return { kind: 'individual', id: user.scope_id };
  if (user.role === 'unithead') return { kind: 'unit', id: user.scope_id };
  if (user.role === 'rep') return { kind: 'sub', id: user.scope_id };
  if (user.role === 'programme') return { kind: 'programme', id: user.scope_id };
  return null;
}
// An Individual's own personally-owned KPIs were previously the only thing
// relevantKpis ever showed them — nothing about the department/unit/
// faculty/regional campus they actually belong to. They now also see every
// KPI their own Unit owns (read-only unless it's also been assigned to
// them — see isAssignedIndividual/canEnterData below), so "what is my unit
// being measured on" is visible even for the KPIs someone else enters.
export function relevantKpis(org, kpis, user) {
  if (['cpu', 'exec', 'ictadmin', 'council'].includes(user.role)) return kpis;
  if (user.role === 'individual') {
    const unitId = individualUnitId(org, user.scope_id);
    return kpis.filter((k) =>
      isOwner(user, k) || isApprover(org, user, k) || inJurisdiction(org, user, k) ||
      (k.owner_type === 'unit' && k.owner_id === unitId)
    );
  }
  return kpis.filter((k) => isOwner(user, k) || isApprover(org, user, k) || inJurisdiction(org, user, k));
}

// Has this Individual been delegated one of their Unit's KPIs by their Unit
// Head (a real, persisted grant — see kpi_assignments / POST /kpis/:id/assign
// on the backend), not just able to see it read-only?
export function isAssignedIndividual(user, kpi, assignments = []) {
  if (kpi.owner_type !== 'unit' || user.role !== 'individual') return false;
  return assignments.some((a) => a.kpi_id === kpi.id && a.individual_id === user.scope_id);
}

// Can this person fill in and submit this KPI's own official value
// directly? Strict ownership only — mirrors backend/src/routes/kpis.js's
// own isOwner exactly, which is the actual enforcement. An assigned
// Individual is deliberately NOT included here any more: they contribute
// their own figure toward the KPI instead (see canContribute below), which
// their Unit Head reviews before it ever becomes this KPI's real value.
export function canEnterData(user, kpi) {
  return isOwner(user, kpi);
}
// Can this person contribute their OWN figure toward this shared KPI (a
// Unit-owned KPI their Unit Head assigned to them as one of their duties)?
// This is a genuinely different action from canEnterData above — it goes
// into kpi_contributions, reviewed by the Unit Head, and only then summed
// into the KPI's real value — never a direct write to it.
export function canContribute(user, kpi, assignments = []) {
  return isAssignedIndividual(user, kpi, assignments);
}
export function computeRag(kpi, valueRow, settings) {
  const v = valueRow ? (valueRow.override_value != null ? valueRow.override_value : valueRow.value) : null;
  if (v == null) return { cls: 'chip-rag-none', label: 'No data', pct: null };
  const base = Number(kpi.baseline), tgt = Number(kpi.target);
  const pct = tgt === base ? (v >= tgt ? 100 : 0) : Math.round(((v - base) / (tgt - base)) * 100);
  const green = Number(settings.ragGreen ?? 80);
  const amber = Number(settings.ragAmber ?? 50);
  const cls = pct >= green ? 'chip-rag-green' : pct >= amber ? 'chip-rag-amber' : 'chip-rag-red';
  return { cls, label: `${pct}%`, pct };
}
// A KPI value row is stored with status draft/submitted/approved only — a
// "returned" submission is really just a draft that carries a return_comment
// — but that distinction matters a lot to the person looking at it, so every
// place that shows a status badge should go through this instead of reading
// `.status` directly.
//
// IMPORTANT: this used to treat `valueRow.value == null` as "nothing's
// happened yet" — that was true back when `value` was the only figure a
// submitter ever typed. Since the automated cumulative-performance feature
// (see routes/kpis.js), `value` is the OFFICIAL cumulative total, which is
// only ever computed and stored at approval time — a perfectly normal
// draft or submitted row has `value == null` right up until someone
// approves it. Keying "has anything happened" off `value` therefore made
// every submitted-but-not-yet-approved row read as "none" everywhere
// (My Data Entry's counts, the Approvals Queue's pending list, Overview),
// which silently made submissions invisible to approvers and approval
// itself unreachable — status now comes from the real `status` column
// first, and only reports 'none' when a draft genuinely has nothing typed
// or computed into it yet (checking both `entered_value`, what a direct
// submitter types, and `value`, what an automated/contribution-summed row
// carries even while still a draft).
export function valueStatus(valueRow) {
  if (!valueRow) return 'none';
  if (valueRow.status === 'draft') {
    if (valueRow.return_comment) return 'returned';
    if (valueRow.entered_value == null && valueRow.value == null) return 'none';
    return 'draft';
  }
  return valueRow.status; // 'submitted' or 'approved' — trust it outright
}

// Walks a scoped (non-global) user's own place in the org tree — programme →
// sub-programme → unit → them — so Overview can show exactly where their
// data sits instead of a generic "your reporting scope" message. Returns an
// array of names (outermost first) or null if their scope can't be resolved
// (e.g. their unit/sub was since removed).
export function scopeBreadcrumb(org, user) {
  if (user.role === 'programme') {
    const p = byId(org.programmes, user.scope_id);
    return p ? [p.name] : null;
  }
  if (user.role === 'rep') {
    const sub = byId(org.subs, user.scope_id);
    if (!sub) return null;
    const programme = byId(org.programmes, sub.programme_id);
    return [programme?.name, sub.name].filter(Boolean);
  }
  if (user.role === 'unithead') {
    const unit = byId(org.units, user.scope_id);
    if (!unit) return null;
    const sub = byId(org.subs, unit.sub_id);
    const programme = sub ? byId(org.programmes, sub.programme_id) : null;
    return [programme?.name, sub?.name, unit.name].filter(Boolean);
  }
  if (user.role === 'individual') {
    const ind = byId(org.individuals, user.scope_id);
    if (!ind) return null;
    const unit = byId(org.units, ind.unit_id);
    const sub = unit ? byId(org.subs, unit.sub_id) : null;
    const programme = sub ? byId(org.programmes, sub.programme_id) : null;
    return [programme?.name, sub?.name, unit?.name, ind.name].filter(Boolean);
  }
  return null;
}

// An automated appraisal result for any list of KPIs (an individual's own,
// a Unit's own, a Sub-programme's own, a Programme's own — whichever the
// caller passes in) against a performance-lens values map keyed by kpi id
// (see lib/period.js's latestInRange / AppContext's perfValues) — no manual
// scoring, just the same RAG math used everywhere else in the app, averaged.
export function performanceRollup(kpiList, valuesByKpiId, settings) {
  const counts = { green: 0, amber: 0, red: 0, none: 0 };
  let pctSum = 0, pctCount = 0;
  kpiList.forEach((k) => {
    const rag = computeRag(k, valuesByKpiId[k.id], settings);
    counts[rag.cls.replace('chip-rag-', '')]++;
    if (rag.pct != null) { pctSum += rag.pct; pctCount++; }
  });
  return { count: kpiList.length, avgPct: pctCount ? Math.round(pctSum / pctCount) : null, counts };
}

// ---- variance analysis (Monthly / Quarterly / Bi-annual / Annual) --------
// "Variance" here means the honest M&E sense: not just how close a KPI is
// to its target, but whether it's running ahead of, on, or behind the pace
// it would need to be at *by this point in the year* to reach that target
// on schedule — the same real baseline/target/actual numbers computeRag
// already uses, just compared against a time-based expectation instead of
// a flat 100%. A KPI can be a long way from its target in January and
// still be perfectly on pace; this is what tells the two apart.
//
// The expectation is always pinned to the month the ACTUAL value itself was
// recorded for (valueRow.month) — never the nominal end month of whichever
// period type happens to be selected. That distinction matters a lot for
// Quarterly/Bi-annual/Annual, which report "the latest value filed within
// the range" (see lib/period.js's latestInRange): if it's only August and
// someone switches to the Annual lens, the newest data anyone has is still
// August's, so the fair question is "was this on pace for August", not "is
// it at 100% yet" — comparing against a full year that hasn't finished
// would flag nearly everything as behind, correctly or not.

// Where a KPI *should* be, in the same 0-100 progress-% terms as computeRag,
// if it moved in a straight line from baseline to target across a year, as
// of a given month.
export function expectedPacePct(asOfMonth) {
  const m = Math.max(0, Math.min(12, Number(asOfMonth) || 0));
  return Math.round((m / 12) * 100);
}

// The threshold this app treats as needing attention: variance of -10 or
// worse (10+ points behind the pace expected as of the value's own month).
// Symmetric ±10 is the "normal" band — running 10+ points AHEAD of pace is
// flagged too, just not as an alert (see computeVariance's `flag`).
export const VARIANCE_ATTENTION_THRESHOLD = -10;
export const VARIANCE_AHEAD_THRESHOLD = 10;

// One KPI's variance: actual progress % (the same computeRag math —
// including override handling — applied to whatever value row the caller
// passes, e.g. a perfValues[kpi.id] "latest in range" row) minus the
// expected pace % as of THAT row's own month. Never computed for a KPI with
// no value yet — there's nothing to compare.
export function computeVariance(kpi, valueRow, settings) {
  const rag = computeRag(kpi, valueRow, settings);
  if (rag.pct == null) return { actualPct: null, expectedPct: null, asOfMonth: null, variance: null, flag: 'none' };
  const expectedPct = expectedPacePct(valueRow.month);
  const variance = rag.pct - expectedPct;
  const flag = variance <= VARIANCE_ATTENTION_THRESHOLD ? 'attention' : variance >= VARIANCE_AHEAD_THRESHOLD ? 'ahead' : 'on-pace';
  return { actualPct: rag.pct, expectedPct, asOfMonth: valueRow.month, variance, flag };
}

// The same rollup shape performanceRollup produces, but for variance: one
// row per KPI (with its own computeVariance result attached) plus an
// average variance and a count of how many need attention (variance <=
// -10) — the real, single source both a chart and an alert list read from,
// so they can never disagree about which KPIs are flagged.
// The same straight-line pace as expectedPacePct/computeVariance above, but
// expressed in the KPI's own real units (between its actual baseline and
// target) instead of a 0-100%, so it can sit right next to the KPI's own
// Baseline/Target/Current figures rather than only as a separate % badge.
// This is the automated "monthly expected target toward the annual
// target" — nobody types it in; it's just where a straight line from
// baseline to target would put you by this month.
export function expectedValueForMonth(kpi, month) {
  const m = Math.max(0, Math.min(12, Number(month) || 0));
  const base = Number(kpi.baseline), tgt = Number(kpi.target);
  return base + (tgt - base) * (m / 12);
}

// The automated "assumed baseline" for judging THIS month's own
// performance: where the pace-based trajectory stood at the end of the
// PREVIOUS month (the real baseline itself, for January). Comparing this
// month's actual value against this assumed baseline — rather than always
// against the year's opening baseline — is what turns "progress to date"
// into a genuine monthly performance figure: the gap between them is what
// this one month itself was expected to move the needle by.
export function assumedMonthlyBaseline(kpi, month) {
  return expectedValueForMonth(kpi, Math.max(0, (Number(month) || 0) - 1));
}

// Automated Quarterly and Bi-annual TARGETS — nobody sets a separate
// quarterly or half-year target number for a KPI; it's simply the same
// straight-line baseline -> annual-target pace (expectedValueForMonth
// above) read off at the end month of whichever quarter/half the given
// month falls in. Q1 ends month 3, Q2 month 6, Q3 month 9, Q4 month 12; H1
// ends month 6, H2 month 12. This is what makes "automate quarterly and
// bi-annual targets" true across the whole KPI catalogue at once: every
// KPI's own baseline/target already implies its quarterly and half-year
// targets, computed here, never typed in separately and never able to
// drift from the annual figure they're derived from.
export function periodEndMonths(month) {
  const m = Math.max(1, Math.min(12, Number(month) || 1));
  const quarter = Math.ceil(m / 3);
  const half = m <= 6 ? 1 : 2;
  return { quarter, quarterEndMonth: quarter * 3, half, halfEndMonth: half === 1 ? 6 : 12 };
}
export function automatedPeriodTargets(kpi, month) {
  const { quarter, quarterEndMonth, half, halfEndMonth } = periodEndMonths(month);
  return {
    quarter, half,
    quarterTarget: roundMeasure(expectedValueForMonth(kpi, quarterEndMonth)),
    halfTarget: roundMeasure(expectedValueForMonth(kpi, halfEndMonth)),
  };
}

// Rounds to 1 decimal only when the figure isn't already a whole number —
// keeps integer measures (counts of students, completed reviews, etc.)
// looking like integers instead of picking up a spurious ".0".
export function roundMeasure(n) {
  return Math.round(n * 10) / 10;
}

// The full automated monthly-pace picture for one KPI value row: the
// expected-by-this-month target and the assumed baseline it's measured
// from (both computed, never stored), the actual value entered, and how
// this month's actual compares to what this one month alone was expected
// to contribute (actual - assumedBaseline vs. the expected monthly delta,
// expectedValueForMonth - assumedMonthlyBaseline). Returns null when
// there's no value yet — there's nothing to gauge a month's performance
// against.
export function monthlyPace(kpi, valueRow) {
  if (!valueRow || valueRow.month == null) return null;
  const actual = valueRow.override_value != null ? valueRow.override_value : valueRow.value;
  if (actual == null) return null;
  const month = valueRow.month;
  const expected = expectedValueForMonth(kpi, month);
  const assumedBaseline = assumedMonthlyBaseline(kpi, month);
  const expectedMonthlyDelta = expected - assumedBaseline;
  const actualMonthlyDelta = actual - assumedBaseline;
  return {
    month, actual,
    expected: roundMeasure(expected),
    assumedBaseline: roundMeasure(assumedBaseline),
    expectedMonthlyDelta: roundMeasure(expectedMonthlyDelta),
    actualMonthlyDelta: roundMeasure(actualMonthlyDelta),
    onPaceForMonth: actualMonthlyDelta >= expectedMonthlyDelta,
  };
}

// A dropdown-friendly [fromYear..toYear] list — the one thing every year
// selector in the app (data-entry period, the performance lens, the
// planning cycle) builds its <option> list from, so extending how far into
// the future any of them reaches is always this one number.
export const YEAR_GRID_MAX = 2065;
export function yearRange(fromYear, toYear = YEAR_GRID_MAX) {
  const out = [];
  for (let y = fromYear; y <= toYear; y++) out.push(y);
  return out;
}

export function varianceRollup(kpiList, valuesByKpiId, settings) {
  const items = kpiList.map((k) => ({ kpi: k, ...computeVariance(k, valuesByKpiId[k.id], settings) }));
  const withData = items.filter((i) => i.variance != null);
  const avgVariance = withData.length ? Math.round(withData.reduce((sum, i) => sum + i.variance, 0) / withData.length) : null;
  const avgExpectedPct = withData.length ? Math.round(withData.reduce((sum, i) => sum + i.expectedPct, 0) / withData.length) : null;
  const attentionCount = items.filter((i) => i.flag === 'attention').length;
  return { items, avgVariance, avgExpectedPct, attentionCount };
}

// "Overall Institutional Performance" is the average of the Programmes'
// OWN averages — never a flat average across every individual KPI in the
// system, which would silently let whichever Programme happens to have the
// most KPIs dominate the institutional figure. Each Programme's own
// avgPct/avgVariance (the exact same performanceRollup/varianceRollup every
// Programme's own Overview card already computes, via nodeOwnKpis's full
// Programme -> Sub-programme -> Unit -> Individual cascade) is given equal
// weight, one Programme, one vote, then averaged across however many
// Programmes actually have at least one scored KPI — a Programme with
// genuinely nothing scored yet is excluded rather than dragging the
// institutional figure toward zero, the same "no data never scores as 0"
// principle performanceRollup already applies to a single KPI with no
// value. The RAG counts and variance-chart items stay real, flat totals
// across every KPI org-wide (see below) — only the two headline AVERAGES
// change; "14 KPIs off track" should still mean 14 actual KPIs, never
// something scaled by how many Programmes there are.
export function institutionalRollup(org, kpis, valuesByKpiId, settings) {
  const perProgramme = org.programmes.map((p) => {
    const list = nodeOwnKpis(org, kpis, 'programme', p.id);
    return {
      programme: p,
      performance: performanceRollup(list, valuesByKpiId, settings),
      variance: varianceRollup(list, valuesByKpiId, settings),
    };
  });
  const withPerf = perProgramme.filter((r) => r.performance.avgPct != null);
  const avgPct = withPerf.length ? Math.round(withPerf.reduce((sum, r) => sum + r.performance.avgPct, 0) / withPerf.length) : null;
  const withVar = perProgramme.filter((r) => r.variance.avgVariance != null);
  const avgVariance = withVar.length ? Math.round(withVar.reduce((sum, r) => sum + r.variance.avgVariance, 0) / withVar.length) : null;
  const withExpected = perProgramme.filter((r) => r.variance.avgExpectedPct != null);
  const avgExpectedPct = withExpected.length ? Math.round(withExpected.reduce((sum, r) => sum + r.variance.avgExpectedPct, 0) / withExpected.length) : null;
  const counts = { green: 0, amber: 0, red: 0, none: 0 };
  perProgramme.forEach((r) => {
    const c = r.performance.counts;
    counts.green += c.green; counts.amber += c.amber; counts.red += c.red; counts.none += c.none;
  });
  const count = perProgramme.reduce((sum, r) => sum + r.performance.count, 0);
  const items = perProgramme.flatMap((r) => r.variance.items);
  const attentionCount = perProgramme.reduce((sum, r) => sum + r.variance.attentionCount, 0);
  return {
    performance: { count, avgPct, counts },
    variance: { items, avgVariance, avgExpectedPct, attentionCount },
    perProgramme,
  };
}

export function initialsOf(name) {
  const parts = String(name || '').replace(/^(Mr|Mrs|Ms|Dr|Prof|Eng)\.?\s+/i, '').trim().split(/\s+/);
  const letters = parts.map((p) => p[0]).filter(Boolean);
  return (letters[0] || '?').toUpperCase() + (letters.length > 1 ? letters[letters.length - 1].toUpperCase() : '');
}
function hashStr(s) {
  let h = 0; s = String(s);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
const AVATAR_CLASSES = [
  'bg-accent-50 text-accent-600',
  'bg-good-soft text-good',
  'bg-warning-soft text-warning',
  'bg-critical-soft text-critical',
  'bg-purple-50 text-purple-700',
  'bg-teal-50 text-teal-700',
];
export function avatarClass(id) { return AVATAR_CLASSES[Math.abs(hashStr(id)) % AVATAR_CLASSES.length]; }
export const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function currentPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
