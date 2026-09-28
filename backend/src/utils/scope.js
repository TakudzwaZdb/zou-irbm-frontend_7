// Real, shared READ-visibility scope boundaries — separate from
// isOwner/isApprover/isAssignedIndividual/isUnitHeadOwner (who can ACT on
// something) and from routes/kpis.js's own inJurisdiction (who can
// CREATE/EDIT/DELETE org structure). This answers a different question:
// "can this signed-in account even SEE this KPI/Sub-programme/Unit/
// Programme's data at all?"
//
// Added because a security review of this app found every read (`GET`)
// endpoint was authenticated but not scope-checked: any signed-in account
// — down to an Individual — could read another branch's performance
// figures, budgets, or compliance/escalation status by calling the API
// directly (dev tools, curl), even though the UI never rendered it for
// them. These predicates mirror EXACTLY the org-hierarchy boundaries the
// UI already assumed when it decided what to render from what used to be
// unfiltered data, so no view anyone could already reach through the app
// itself changes — only direct-API access to a DIFFERENT branch is now
// blocked. See routes/kpis.js, routes/plans.js, routes/compliance.js for
// where these get applied, and README.md's "Still genuinely open" section
// (now closed out) for the finding this fixes.
//
// Every function here that (directly or transitively) looks a row up is
// `async` — db.js's Postgres-backed `db.prepare(...).get()` returns a
// Promise now, so every caller in routes/kpis.js, routes/plans.js, and
// routes/compliance.js must `await` these too (see each of those files'
// own call sites). isGlobalReader stays synchronous — it only reads
// `user.role`, never the database.
const db = require('../db');

// Global oversight roles — see everything, same as the UI already assumes
// for Overview/Reports/the Annual Plan's compiled view (exec/cpu/ictadmin
// already get org-wide figures everywhere; council needs the same full
// picture to validate the University Annual Plan — see plans.js's own
// comment on GET /plans exposing "the same data, same numbers" to a
// Council reviewer).
const GLOBAL_READ_ROLES = ['cpu', 'ictadmin', 'exec', 'council'];
function isGlobalReader(user) { return GLOBAL_READ_ROLES.includes(user.role); }

async function unitSubId(unitId) {
  return (await db.prepare('SELECT sub_id FROM units WHERE id = ?').get(unitId))?.sub_id ?? null;
}
async function individualUnitId(individualId) {
  return (await db.prepare('SELECT unit_id FROM individuals WHERE id = ?').get(individualId))?.unit_id ?? null;
}
async function subProgrammeId(subId) {
  return (await db.prepare('SELECT programme_id FROM subs WHERE id = ?').get(subId))?.programme_id ?? null;
}
function individualScopeType(user) { return user.scope_type || 'individual'; }

// Which Sub-programme does this KPI ultimately roll up under, whichever
// tier actually owns it?
async function kpiSubId(kpi) {
  if (kpi.owner_type === 'sub') return kpi.owner_id;
  if (kpi.owner_type === 'unit') return unitSubId(kpi.owner_id);
  return unitSubId(await individualUnitId(kpi.owner_id));
}
async function kpiProgrammeId(kpi) {
  const subId = await kpiSubId(kpi);
  return subId != null ? subProgrammeId(subId) : null;
}

// Has this Individual been assigned this Unit-owned KPI as a contributor
// (see kpis.js's kpi_assignments table)? Mirrored here (rather than
// imported from routes/kpis.js) to keep this module dependency-free of the
// route files that consume it.
async function isAssignedIndividual(user, kpi) {
  if (kpi.owner_type !== 'unit' || user.role !== 'individual' || individualScopeType(user) !== 'individual') return false;
  return !!(await db.prepare(
    'SELECT 1 FROM kpi_assignments WHERE kpi_id = ? AND individual_id = ? AND deleted_at IS NULL'
  ).get(kpi.id, user.scope_id));
}

// Can this user see this KPI (and by extension its values/contributions)?
async function canReadKpi(user, kpi) {
  if (isGlobalReader(user)) return true;
  if (user.role === 'programme') return (await kpiProgrammeId(kpi)) === user.scope_id;
  if (user.role === 'rep') return (await kpiSubId(kpi)) === user.scope_id;
  if (user.role === 'unithead') {
    if (kpi.owner_type === 'unit') return kpi.owner_id === user.scope_id;
    if (kpi.owner_type === 'individual') return (await individualUnitId(kpi.owner_id)) === user.scope_id;
    return false;
  }
  if (user.role === 'individual') {
    if (individualScopeType(user) === 'individual') {
      if (kpi.owner_type === 'individual' && kpi.owner_id === user.scope_id) return true;
      return isAssignedIndividual(user, kpi);
    }
    if (individualScopeType(user) === 'unit') return kpi.owner_type === 'unit' && kpi.owner_id === user.scope_id || kpi.owner_type === 'individual' && (await individualUnitId(kpi.owner_id)) === user.scope_id;
    if (individualScopeType(user) === 'sub') return (await kpiSubId(kpi)) === user.scope_id;
    if (individualScopeType(user) === 'programme') return (await kpiProgrammeId(kpi)) === user.scope_id;
  }
  return false;
}

// Can this user see this Sub-programme's own data (its plan proposal, its
// lateness/compliance row)? Everyone within it — their own Sub Rep, the
// Programme Head above it, every Unit Head/Individual nested inside it —
// can see the Sub-programme's own aggregate; only a DIFFERENT branch is
// blocked.
async function canReadSub(user, subId) {
  if (isGlobalReader(user)) return true;
  if (user.role === 'programme') return (await subProgrammeId(subId)) === user.scope_id;
  if (user.role === 'rep') return user.scope_id === subId;
  if (user.role === 'unithead') return (await unitSubId(user.scope_id)) === subId;
  if (user.role === 'individual') {
    if (individualScopeType(user) === 'individual') return (await unitSubId(await individualUnitId(user.scope_id))) === subId;
    if (individualScopeType(user) === 'unit') return (await unitSubId(user.scope_id)) === subId;
    if (individualScopeType(user) === 'sub') return user.scope_id === subId;
    if (individualScopeType(user) === 'programme') return (await subProgrammeId(subId)) === user.scope_id;
  }
  return false;
}

// Can this user see this Unit's own data (its plan proposal)? The Unit
// Head themselves, anyone in their own chain above (Rep/Programme Head),
// or an Individual who belongs to that unit.
async function canReadUnit(user, unitId) {
  if (isGlobalReader(user)) return true;
  if (user.role === 'unithead') return user.scope_id === unitId;
  if (user.role === 'individual') {
    if (individualScopeType(user) === 'individual') return (await individualUnitId(user.scope_id)) === unitId;
    if (individualScopeType(user) === 'unit') return user.scope_id === unitId;
    if (individualScopeType(user) === 'sub') return (await unitSubId(unitId)) === user.scope_id;
    if (individualScopeType(user) === 'programme') return (await subProgrammeId(await unitSubId(unitId))) === user.scope_id;
  }
  const subId = await unitSubId(unitId);
  if (subId == null) return false;
  return canReadSub(user, subId);
}

// Can this user see this Programme's own data (its compiled plan)? The
// Programme Head themselves, or anyone nested within their programme.
async function canReadProgramme(user, programmeId) {
  if (isGlobalReader(user)) return true;
  if (user.role === 'programme') return user.scope_id === programmeId;
  if (user.role === 'rep') return (await subProgrammeId(user.scope_id)) === programmeId;
  if (user.role === 'unithead') return (await subProgrammeId(await unitSubId(user.scope_id))) === programmeId;
  if (user.role === 'individual') {
    if (individualScopeType(user) === 'individual') return (await subProgrammeId(await unitSubId(await individualUnitId(user.scope_id)))) === programmeId;
    if (individualScopeType(user) === 'unit') return (await subProgrammeId(await unitSubId(user.scope_id))) === programmeId;
    if (individualScopeType(user) === 'sub') return (await subProgrammeId(user.scope_id)) === programmeId;
    if (individualScopeType(user) === 'programme') return user.scope_id === programmeId;
  }
  return false;
}

module.exports = {
  isGlobalReader, canReadKpi, canReadSub, canReadUnit, canReadProgramme,
  kpiSubId, kpiProgrammeId, unitSubId, individualUnitId, subProgrammeId, isAssignedIndividual,
};
