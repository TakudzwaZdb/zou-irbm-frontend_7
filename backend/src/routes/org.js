const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requirePerm, requireAnyPerm } = require('../middleware/auth');
const { uniqueEmailFor } = require('../utils/email');
const { DEFAULT_PERMS_BY_ROLE } = require('../utils/permissions');
const { generateTempPassword } = require('../utils/password');

const router = express.Router();
router.use(requireAuth);

// ---- Permission gating on the routes below --------------------------------
// manage_org_units is the broad "does everything" permission and always
// suffices on its own. Two narrower, independently-grantable siblings exist
// for real access control (see utils/permissions.js's comment for the full
// rationale): create_org_units gates the three POST routes below (creating
// a new Programme/Sub-programme/Unit) and edit_org_units gates the three
// PATCH routes (correcting an existing one's own name/head/kind) — either
// one lets ICT admin hand someone the Organisation Setup page's create
// or update capability without also handing them manage_org_units' remove/
// restore power. DELETE and every /restore route stay behind
// manage_org_units alone, on purpose: undoing a removal should require the
// same authority that could remove it in the first place.

// ---- Cascading soft-delete / restore helpers -----------------------------
// "Removing" a Programme/Sub-programme/Unit/Individual is a STAMP
// (deleted_at = now), never a real SQL DELETE — the row, and everything
// nested beneath it, stays in the database exactly as it was; only every
// query that lists the CURRENT/active org (GET / below, KPI ownership
// lookups, dropdowns, the org tree, approvals, reports…) filters
// `deleted_at IS NULL` so a removed item stops appearing anywhere active.
// This is what makes "remove" a real, reversible action — restoreProgramme/
// Sub/Unit/Individual below clear the stamp — and what makes it traceable:
// nothing about who owned what, what KPIs they had, or what was ever
// recorded against them is destroyed. `kpis` is intentionally NOT a foreign
// key of units/subs/individuals (owner_type/owner_id is polymorphic, see
// db.js), so nothing here is automatic; these helpers do by hand what a
// soft-delete cascade needs, bottom-up, all inside one db.transaction()
// call so a Programme removal either stamps everything beneath it or stamps
// nothing at all.
//
// deactivateUserAccount mirrors the same idea for a login account: instead
// of deleting it (which used to force nulling out every other table's
// reference to it first, just to satisfy foreign keys), it's stamped
// deleted_at too — the row, and every real thing it's the author of
// (audit_log entries, messages, past KPI submissions/approvals), stays
// exactly as it was; only sign-in is blocked (see routes/auth.js's POST
// /login) and it stops appearing in the User Directory. Safe to call on ANY
// user id, including one that's already deactivated (the UPDATE is then a
// no-op) or falsy (guarded above).
function deactivateUserAccount(userId) {
  if (!userId) return;
  db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(userId);
}
function reactivateUserAccount(userId) {
  if (!userId) return;
  db.prepare("UPDATE users SET deleted_at = NULL WHERE id = ?").run(userId);
}

// KPIs owned directly by this owner (kpi_values/kpi_assignments/
// kpi_contributions/kpi_hidden/kpi_templates all stay intact automatically,
// since the kpis row itself is never actually deleted — only stamped).
function softDeleteKpisForOwner(ownerType, ownerId) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM kpis WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL").get(ownerType, ownerId).n;
  db.prepare("UPDATE kpis SET deleted_at = datetime('now') WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL").run(ownerType, ownerId);
  return n;
}
function restoreKpisForOwner(ownerType, ownerId) {
  db.prepare("UPDATE kpis SET deleted_at = NULL WHERE owner_type = ? AND owner_id = ?").run(ownerType, ownerId);
}

function cascadeSoftDeleteIndividual(individual) {
  const kpis = softDeleteKpisForOwner('individual', individual.id);
  db.prepare("UPDATE individuals SET deleted_at = datetime('now') WHERE id = ?").run(individual.id);
  let accounts = 0;
  if (individual.user_id) { deactivateUserAccount(individual.user_id); accounts = 1; }
  return { kpis, individuals: 1, units: 0, subs: 0, programmes: 0, accounts };
}
function cascadeRestoreIndividual(individual) {
  restoreKpisForOwner('individual', individual.id);
  db.prepare('UPDATE individuals SET deleted_at = NULL WHERE id = ?').run(individual.id);
  if (individual.user_id) reactivateUserAccount(individual.user_id);
}

function sumTotals(a, b) {
  return {
    kpis: a.kpis + b.kpis, individuals: a.individuals + b.individuals,
    units: a.units + b.units, subs: a.subs + b.subs,
    programmes: a.programmes + b.programmes, accounts: a.accounts + b.accounts,
  };
}

function cascadeSoftDeleteUnit(unit) {
  let totals = { kpis: 0, individuals: 0, units: 1, subs: 0, programmes: 0, accounts: 0 };
  const individuals = db.prepare('SELECT * FROM individuals WHERE unit_id = ? AND deleted_at IS NULL').all(unit.id);
  individuals.forEach((ind) => { totals = sumTotals(totals, cascadeSoftDeleteIndividual(ind)); });
  totals.kpis += softDeleteKpisForOwner('unit', unit.id);
  db.prepare("UPDATE units SET deleted_at = datetime('now') WHERE id = ?").run(unit.id);
  if (unit.head_user_id) { deactivateUserAccount(unit.head_user_id); totals.accounts += 1; }
  return totals;
}
function cascadeRestoreUnit(unit) {
  const individuals = db.prepare('SELECT * FROM individuals WHERE unit_id = ?').all(unit.id);
  individuals.forEach((ind) => cascadeRestoreIndividual(ind));
  restoreKpisForOwner('unit', unit.id);
  db.prepare('UPDATE units SET deleted_at = NULL WHERE id = ?').run(unit.id);
  if (unit.head_user_id) reactivateUserAccount(unit.head_user_id);
}

function cascadeSoftDeleteSub(sub) {
  let totals = { kpis: 0, individuals: 0, units: 0, subs: 1, programmes: 0, accounts: 0 };
  const units = db.prepare('SELECT * FROM units WHERE sub_id = ? AND deleted_at IS NULL').all(sub.id);
  units.forEach((u) => { totals = sumTotals(totals, cascadeSoftDeleteUnit(u)); });
  totals.kpis += softDeleteKpisForOwner('sub', sub.id);
  db.prepare("UPDATE subs SET deleted_at = datetime('now') WHERE id = ?").run(sub.id);
  if (sub.rep_user_id) { deactivateUserAccount(sub.rep_user_id); totals.accounts += 1; }
  return totals;
}
function cascadeRestoreSub(sub) {
  const units = db.prepare('SELECT * FROM units WHERE sub_id = ?').all(sub.id);
  units.forEach((u) => cascadeRestoreUnit(u));
  restoreKpisForOwner('sub', sub.id);
  db.prepare('UPDATE subs SET deleted_at = NULL WHERE id = ?').run(sub.id);
  if (sub.rep_user_id) reactivateUserAccount(sub.rep_user_id);
}

function cascadeSoftDeleteProgramme(programme) {
  let totals = { kpis: 0, individuals: 0, units: 0, subs: 0, programmes: 1, accounts: 0 };
  const subs = db.prepare('SELECT * FROM subs WHERE programme_id = ? AND deleted_at IS NULL').all(programme.id);
  subs.forEach((s) => { totals = sumTotals(totals, cascadeSoftDeleteSub(s)); });
  db.prepare("UPDATE programmes SET deleted_at = datetime('now') WHERE id = ?").run(programme.id);
  if (programme.head_user_id) { deactivateUserAccount(programme.head_user_id); totals.accounts += 1; }
  return totals;
}
function cascadeRestoreProgramme(programme) {
  const subs = db.prepare('SELECT * FROM subs WHERE programme_id = ?').all(programme.id);
  subs.forEach((s) => cascadeRestoreSub(s));
  db.prepare('UPDATE programmes SET deleted_at = NULL WHERE id = ?').run(programme.id);
  if (programme.head_user_id) reactivateUserAccount(programme.head_user_id);
}

function describeRemoved(totals) {
  const parts = [];
  if (totals.subs) parts.push(`${totals.subs} sub-programme(s)`);
  if (totals.units) parts.push(`${totals.units} unit(s)`);
  if (totals.individuals) parts.push(`${totals.individuals} individual(s)`);
  if (totals.kpis) parts.push(`${totals.kpis} KPI(s)`);
  if (totals.accounts) parts.push(`${totals.accounts} login account(s)`);
  return parts.length ? `, along with ${parts.join(', ')} — all recoverable together from Recently Removed.` : '. Recoverable from Recently Removed.';
}

// Returns the whole ACTIVE structure — deleted_at IS NULL on all four
// tables, so anything soft-removed (see the cascade helpers above) stops
// appearing here, in the org tree, in every dropdown, and in KPI
// ownership/approval resolution, without its row (or its history) actually
// being gone. The frontend narrows what it SHOWS based on req.user's
// role/scope (see /api/auth/me), but the data itself is small and
// non-sensitive enough that serving the full tree keeps this reference
// implementation simple — a larger deployment would filter server-side too.
router.get('/', (req, res) => {
  const programmes = db.prepare('SELECT * FROM programmes WHERE deleted_at IS NULL ORDER BY id').all();
  const subs = db.prepare('SELECT * FROM subs WHERE deleted_at IS NULL ORDER BY id').all();
  const units = db.prepare('SELECT * FROM units WHERE deleted_at IS NULL ORDER BY id').all();
  const individuals = db.prepare('SELECT * FROM individuals WHERE deleted_at IS NULL ORDER BY id').all();
  // Whoever ICT admin has designated as Executive Owner (see users.
  // is_executive_owner / routes/users.js's PATCH /:id/executive-owner) —
  // ordinarily the Vice Chancellor — accountable for overall institutional
  // performance against the Plan. Plain name/title only, like every other
  // org-chart "head" field already exposed here to every signed-in
  // account; this is a public designation, not a permission grant.
  const executiveOwner = db.prepare("SELECT id, name, title FROM users WHERE is_executive_owner = 1 AND deleted_at IS NULL LIMIT 1").get() || null;
  res.json({ programmes, subs, units, individuals, executiveOwner });
});

// The soft-removed side of the four tables above — what an ICT System
// Administrator or CPU sees under "Recently removed" so removal is
// genuinely traceable, not just a database column nobody can act on.
// Ordered most-recently-removed first.
router.get('/removed', requirePerm('manage_org_units'), (req, res) => {
  const programmes = db.prepare('SELECT * FROM programmes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
  const subs = db.prepare('SELECT * FROM subs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
  const units = db.prepare('SELECT * FROM units WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
  const individuals = db.prepare('SELECT * FROM individuals WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
  res.json({ programmes, subs, units, individuals });
});

// Live creation of a Programme — the top tier of the structure. Same
// pattern as Unit/Sub-programme creation below: provisions a real Programme
// Head account (role='programme', scope_type='programme') so the new head
// can sign in immediately. Used by the "Organisation Structure" admin page.
router.post('/programmes', requireAnyPerm('manage_org_units', 'create_org_units'), (req, res) => {
  const { name, head } = req.body || {};
  if (!name || !head) return res.status(400).json({ error: 'name and head are required.' });

  const email = uniqueEmailFor(head);
  const tempPassword = generateTempPassword();
  const passwordHash = bcrypt.hashSync(tempPassword, 10);
  const headUserId = db
    .prepare('INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(head, `Programme Head — ${name}`, email, passwordHash, 'programme', 'programme', null).lastInsertRowid;

  const programmeId = db
    .prepare('INSERT INTO programmes (name, head, head_user_id) VALUES (?, ?, ?)')
    .run(name, head, headUserId).lastInsertRowid;

  db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(programmeId, headUserId);
  const setPerm = db.prepare('INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)');
  DEFAULT_PERMS_BY_ROLE.programme.forEach((k) => setPerm.run(headUserId, k));

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_programme', 'programme', programmeId, `Programme "${name}" created. Head account: ${email}.`
  );

  res.status(201).json({
    programme: db.prepare('SELECT * FROM programmes WHERE id = ?').get(programmeId),
    headAccount: { email, note: `Temporary password: ${tempPassword} — they must set their own at first sign-in.` },
  });
});

// Update a Programme's own name/head — previously there was no way to
// correct either after creation short of deleting and recreating the whole
// Programme (which would also cascade-delete everything beneath it). Same
// sync-with-the-linked-account pattern PATCH /individuals/:id already
// established: the Programme Head's own user row (name/title) is kept in
// step with the org-chart record, so "who's signed in" and "who the org
// chart says leads this Programme" never drift apart the way they could
// before that fix existed for Individuals.
router.patch('/programmes/:id', requireAnyPerm('manage_org_units', 'edit_org_units'), (req, res) => {
  const programme = db.prepare('SELECT * FROM programmes WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!programme) return res.status(404).json({ error: 'Programme not found.' });
  const { name, head } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!head || !head.trim()) return res.status(400).json({ error: 'Head is required.' });
  const cleanName = name.trim();
  const cleanHead = head.trim();

  db.prepare('UPDATE programmes SET name = ?, head = ? WHERE id = ?').run(cleanName, cleanHead, programme.id);
  if (programme.head_user_id) {
    db.prepare('UPDATE users SET name = ?, title = ? WHERE id = ?').run(cleanHead, `Programme Head — ${cleanName}`, programme.head_user_id);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'update_programme', 'programme', programme.id, `"${programme.name}" updated to "${cleanName}" (Head: ${cleanHead}).`
  );
  res.json({ programme: db.prepare('SELECT * FROM programmes WHERE id = ?').get(programme.id) });
});

// Remove a Programme — cascades to every Sub-programme, Unit, and
// Individual beneath it, every KPI any of those own, and every login
// account that only exists because of them (see cascadeSoftDeleteProgramme
// above). Nothing is actually destroyed: every row is stamped deleted_at
// and simply stops appearing in active views. Fully reversible from
// "Recently Removed" (POST /programmes/:id/restore below).
router.delete('/programmes/:id', requirePerm('manage_org_units'), (req, res) => {
  const programme = db.prepare('SELECT * FROM programmes WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!programme) return res.status(404).json({ error: 'Programme not found.' });

  const totals = db.transaction(() => cascadeSoftDeleteProgramme(programme))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_programme', 'programme', programme.id, `Programme "${programme.name}" removed${describeRemoved(totals)}`
  );
  res.json({ ok: true, removed: totals });
});

// Restore a previously-removed Programme — clears deleted_at on it and on
// every Sub-programme/Unit/Individual/account structurally beneath it (the
// same bottom-up walk cascadeSoftDeleteProgramme did on the way down, run in
// reverse). This intentionally also un-removes anything under it that was
// removed independently earlier — restoring a Programme brings the whole
// structure back, which is simpler to reason about and to explain in the
// audit log than a "partial restore" that leaves orphaned removed pieces
// dangling under a now-active Programme.
router.post('/programmes/:id/restore', requirePerm('manage_org_units'), (req, res) => {
  const programme = db.prepare('SELECT * FROM programmes WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!programme) return res.status(404).json({ error: 'Removed programme not found.' });

  db.transaction(() => cascadeRestoreProgramme(programme))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_programme', 'programme', programme.id, `Programme "${programme.name}" restored.`
  );
  res.json({ programme: db.prepare('SELECT * FROM programmes WHERE id = ?').get(programme.id) });
});

// Live creation of a Sub-programme under a Programme — requires
// 'manage_org_units'. Provisions a real Sub-programme Rep account, same
// pattern as Unit creation below.
router.post('/subs', requireAnyPerm('manage_org_units', 'create_org_units'), (req, res) => {
  const { programmeId, name, head, unitLabel } = req.body || {};
  if (!programmeId || !name || !head) {
    return res.status(400).json({ error: 'programmeId, name, and head are required.' });
  }
  const programme = db.prepare('SELECT * FROM programmes WHERE id = ? AND deleted_at IS NULL').get(programmeId);
  if (!programme) return res.status(404).json({ error: 'Programme not found.' });

  const email = uniqueEmailFor(head);
  const tempPassword = generateTempPassword();
  const passwordHash = bcrypt.hashSync(tempPassword, 10);
  const repUserId = db
    .prepare('INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(head, `Sub-programme Rep — ${name}`, email, passwordHash, 'rep', 'sub', null).lastInsertRowid;

  const subId = db
    .prepare('INSERT INTO subs (programme_id, name, head, unit_label, rep_user_id) VALUES (?, ?, ?, ?, ?)')
    .run(programmeId, name, head, unitLabel || 'Unit', repUserId).lastInsertRowid;

  db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(subId, repUserId);
  const setPerm = db.prepare('INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)');
  DEFAULT_PERMS_BY_ROLE.rep.forEach((k) => setPerm.run(repUserId, k));

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_sub', 'sub', subId, `Sub-programme "${name}" created under ${programme.name}. Rep account: ${email}.`
  );

  res.status(201).json({
    sub: db.prepare('SELECT * FROM subs WHERE id = ?').get(subId),
    repAccount: { email, note: `Temporary password: ${tempPassword} — they must set their own at first sign-in.` },
  });
});

// Update a Sub-programme's own name/head (and unit_label) — same rationale
// and same account-sync pattern as PATCH /programmes/:id above.
router.patch('/subs/:id', requireAnyPerm('manage_org_units', 'edit_org_units'), (req, res) => {
  const sub = db.prepare('SELECT * FROM subs WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Sub-programme not found.' });
  const { name, head, unitLabel } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!head || !head.trim()) return res.status(400).json({ error: 'Head is required.' });
  const cleanName = name.trim();
  const cleanHead = head.trim();
  const cleanUnitLabel = unitLabel && unitLabel.trim() ? unitLabel.trim() : sub.unit_label;

  db.prepare('UPDATE subs SET name = ?, head = ?, unit_label = ? WHERE id = ?').run(cleanName, cleanHead, cleanUnitLabel, sub.id);
  if (sub.rep_user_id) {
    db.prepare('UPDATE users SET name = ?, title = ? WHERE id = ?').run(cleanHead, `Sub-programme Rep — ${cleanName}`, sub.rep_user_id);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'update_sub', 'sub', sub.id, `"${sub.name}" updated to "${cleanName}" (Head: ${cleanHead}).`
  );
  res.json({ sub: db.prepare('SELECT * FROM subs WHERE id = ?').get(sub.id) });
});

// Remove a Sub-programme — cascades to every Unit and Individual beneath
// it, every KPI any of those (or the Sub-programme itself) own, and every
// login account that only exists because of them. Stamped, not deleted —
// see cascadeSoftDeleteSub above and POST /subs/:id/restore below.
router.delete('/subs/:id', requirePerm('manage_org_units'), (req, res) => {
  const sub = db.prepare('SELECT * FROM subs WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Sub-programme not found.' });

  const totals = db.transaction(() => cascadeSoftDeleteSub(sub))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_sub', 'sub', sub.id, `Sub-programme "${sub.name}" removed${describeRemoved(totals)}`
  );
  res.json({ ok: true, removed: totals });
});

// Restore a previously-removed Sub-programme — same whole-subtree restore
// as Programme above, one level down (Units, Individuals, KPIs, accounts).
router.post('/subs/:id/restore', requirePerm('manage_org_units'), (req, res) => {
  const sub = db.prepare('SELECT * FROM subs WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Removed sub-programme not found.' });

  db.transaction(() => cascadeRestoreSub(sub))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_sub', 'sub', sub.id, `Sub-programme "${sub.name}" restored.`
  );
  res.json({ sub: db.prepare('SELECT * FROM subs WHERE id = ?').get(sub.id) });
});

// Live creation of a Unit / Department / Faculty / Region under a
// Sub-programme — requires 'manage_org_units'. Also provisions a Unit Head
// account with a real derived email + a demo password, so the new head can
// sign in immediately (an ICT Systems Administrator can extend/adjust their
// permissions afterwards from the Permissions page).
router.post('/units', requireAnyPerm('manage_org_units', 'create_org_units'), (req, res) => {
  const { subId, name, head, kind } = req.body || {};
  if (!subId || !name || !head) {
    return res.status(400).json({ error: 'subId, name, and head are required.' });
  }
  const sub = db.prepare('SELECT * FROM subs WHERE id = ? AND deleted_at IS NULL').get(subId);
  if (!sub) return res.status(404).json({ error: 'Sub-programme not found.' });

  const email = uniqueEmailFor(head);
  // A real random one-time password, never a shared/guessable default (see
  // SECURITY_REVIEW.md's finding #1) — shown once in this response for
  // whoever is provisioning the account to hand off, and must_change_password
  // below means it's only ever good for one sign-in before the new Unit Head
  // sets their own real password.
  const tempPassword = generateTempPassword();
  const passwordHash = bcrypt.hashSync(tempPassword, 10);
  const headUserId = db
    .prepare('INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(head, `Unit Head — ${name}`, email, passwordHash, 'unithead', 'unit', null).lastInsertRowid;

  const unitId = db
    .prepare('INSERT INTO units (sub_id, name, head, kind, head_user_id) VALUES (?, ?, ?, ?, ?)')
    .run(subId, name, head, kind || 'Unit', headUserId).lastInsertRowid;

  db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(unitId, headUserId);
  const setPerm = db.prepare('INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)');
  DEFAULT_PERMS_BY_ROLE.unithead.forEach((k) => setPerm.run(headUserId, k));

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_unit', 'unit', unitId, `${kind || 'Unit'} "${name}" created under ${sub.name}. Head account: ${email}.`
  );

  res.status(201).json({
    unit: db.prepare('SELECT * FROM units WHERE id = ?').get(unitId),
    headAccount: { email, note: `Temporary password: ${tempPassword} — they must set their own at first sign-in.` },
  });
});

// Update a Unit/Department/Faculty/Region's own name/head/kind — same
// rationale and same account-sync pattern as the two PATCH routes above.
router.patch('/units/:id', requireAnyPerm('manage_org_units', 'edit_org_units'), (req, res) => {
  const unit = db.prepare('SELECT * FROM units WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!unit) return res.status(404).json({ error: 'Unit not found.' });
  const { name, head, kind } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!head || !head.trim()) return res.status(400).json({ error: 'Head is required.' });
  const cleanName = name.trim();
  const cleanHead = head.trim();
  const cleanKind = kind && kind.trim() ? kind.trim() : unit.kind;

  db.prepare('UPDATE units SET name = ?, head = ?, kind = ? WHERE id = ?').run(cleanName, cleanHead, cleanKind, unit.id);
  if (unit.head_user_id) {
    db.prepare('UPDATE users SET name = ?, title = ? WHERE id = ?').run(cleanHead, `Unit Head — ${cleanName}`, unit.head_user_id);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'update_unit', 'unit', unit.id, `"${unit.name}" updated to "${cleanName}" (${cleanKind}, Head: ${cleanHead}).`
  );
  res.json({ unit: db.prepare('SELECT * FROM units WHERE id = ?').get(unit.id) });
});

// Remove a Unit / Department / Faculty / Region — cascades to every
// Individual in it, every KPI any of them (or the Unit itself) own, and
// every login account that only exists because of them. Stamped, not
// deleted — see cascadeSoftDeleteUnit above and POST /units/:id/restore
// below.
router.delete('/units/:id', requirePerm('manage_org_units'), (req, res) => {
  const unit = db.prepare('SELECT * FROM units WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!unit) return res.status(404).json({ error: 'Unit not found.' });

  const totals = db.transaction(() => cascadeSoftDeleteUnit(unit))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_unit', 'unit', unit.id, `Unit "${unit.name}" removed${describeRemoved(totals)}`
  );
  res.json({ ok: true, removed: totals });
});

// Restore a previously-removed Unit — same whole-subtree restore as
// Programme/Sub above, reaching every Individual, their KPIs, and accounts.
router.post('/units/:id/restore', requirePerm('manage_org_units'), (req, res) => {
  const unit = db.prepare('SELECT * FROM units WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!unit) return res.status(404).json({ error: 'Removed unit not found.' });

  db.transaction(() => cascadeRestoreUnit(unit))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_unit', 'unit', unit.id, `Unit "${unit.name}" restored.`
  );
  res.json({ unit: db.prepare('SELECT * FROM units WHERE id = ?').get(unit.id) });
});

// Add an Individual under a Unit/Department/Faculty/Region — same pattern
// as unit creation: provisions a real login account for them immediately.
// Reachable via the broad 'manage_org_units' (unrestricted — CPU/ICT admin)
// OR the narrower 'add_individual' permission, which is real but
// scope-restricted below: a Unit Head can only add into their own unit, and
// a Sub-programme Rep only into a unit within their own sub-programme —
// granting add_individual to anyone else (no org scope of their own) is a
// no-op, since there's no sensible scope left to restrict them to.
router.post('/individuals', requireAnyPerm('manage_org_units', 'add_individual'), (req, res) => {
  const { unitId, name, roleTitle } = req.body || {};
  if (!unitId || !name || !roleTitle) {
    return res.status(400).json({ error: 'unitId, name, and roleTitle are all required.' });
  }
  const unit = db.prepare('SELECT * FROM units WHERE id = ? AND deleted_at IS NULL').get(unitId);
  if (!unit) return res.status(404).json({ error: 'Unit not found.' });

  if (!req.user.permissions.includes('manage_org_units')) {
    const inOwnUnit = req.user.role === 'unithead' && req.user.scope_id === unit.id;
    const inOwnSub = req.user.role === 'rep' && req.user.scope_id === unit.sub_id;
    if (!inOwnUnit && !inOwnSub) {
      return res.status(403).json({ error: 'You can only add an individual within your own unit or sub-programme.' });
    }
  }

  const email = uniqueEmailFor(name);
  const tempPassword = generateTempPassword();
  const passwordHash = bcrypt.hashSync(tempPassword, 10);
  const userId = db
    .prepare('INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(name, roleTitle, email, passwordHash, 'individual', 'individual', null).lastInsertRowid;

  const individualId = db
    .prepare('INSERT INTO individuals (unit_id, name, role_title, user_id) VALUES (?, ?, ?, ?)')
    .run(unitId, name, roleTitle, userId).lastInsertRowid;

  db.prepare('UPDATE users SET scope_id = ? WHERE id = ?').run(individualId, userId);
  const setPerm = db.prepare('INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)');
  DEFAULT_PERMS_BY_ROLE.individual.forEach((k) => setPerm.run(userId, k));

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_individual', 'individual', individualId, `"${name}" (${roleTitle}) added under ${unit.name}. Account: ${email}.`
  );

  res.status(201).json({
    individual: db.prepare('SELECT * FROM individuals WHERE id = ?').get(individualId),
    account: { email, note: `Temporary password: ${tempPassword} — they must set their own at first sign-in.` },
  });
});

// Edit an Individual's name / role (job title) — kept in sync with the
// linked login account's own name/title (users.name/title), which is a
// SEPARATE pair of columns from individuals.name/role_title: editing a
// profile from the Permissions & User Directory page (PATCH /users/:id/
// profile) only ever touched the user row, never this one, so an
// Individual's name could previously drift out of sync between "who's
// signed in" and "who the org chart / KPI ownership says this is". Same
// permission scoping as adding one (broad manage_org_units, or the
// narrower add_individual within your own unit/sub-programme).
router.patch('/individuals/:id', requireAnyPerm('manage_org_units', 'add_individual'), (req, res) => {
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!individual) return res.status(404).json({ error: 'Individual not found.' });
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(individual.unit_id);

  if (!req.user.permissions.includes('manage_org_units')) {
    const inOwnUnit = req.user.role === 'unithead' && req.user.scope_id === unit.id;
    const inOwnSub = req.user.role === 'rep' && req.user.scope_id === unit.sub_id;
    if (!inOwnUnit && !inOwnSub) {
      return res.status(403).json({ error: 'You can only edit an individual within your own unit or sub-programme.' });
    }
  }

  const { name, roleTitle } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!roleTitle || !roleTitle.trim()) return res.status(400).json({ error: 'Role/job title is required.' });
  const cleanName = name.trim();
  const cleanRole = roleTitle.trim();

  db.prepare('UPDATE individuals SET name = ?, role_title = ? WHERE id = ?').run(cleanName, cleanRole, individual.id);
  if (individual.user_id) {
    db.prepare('UPDATE users SET name = ?, title = ? WHERE id = ?').run(cleanName, cleanRole, individual.user_id);
  }

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'update_individual', 'individual', individual.id,
    `"${individual.name}" updated to "${cleanName}" (${cleanRole}).`
  );
  res.json({ individual: db.prepare('SELECT * FROM individuals WHERE id = ?').get(individual.id) });
});

// Remove an Individual — deactivates their login account and stamps any
// KPIs owned directly by them (owner_type='individual') removed too, using
// the same cascadeSoftDeleteIndividual helper the Unit/Sub/Programme
// cascades call on their way down. Nothing is actually destroyed: the
// person, their account, their audit history, and everything they ever
// submitted stays in the database and is fully recoverable — see
// POST /individuals/:id/restore below.
router.delete('/individuals/:id', requirePerm('manage_org_units'), (req, res) => {
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!individual) return res.status(404).json({ error: 'Individual not found.' });

  const totals = db.transaction(() => cascadeSoftDeleteIndividual(individual))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_individual', 'individual', individual.id,
    `"${individual.name}" removed${describeRemoved(totals)}`
  );
  res.json({ ok: true, removed: totals });
});

// Restore a previously-removed Individual — clears deleted_at on them, their
// KPIs, and reactivates their login account.
router.post('/individuals/:id/restore', requirePerm('manage_org_units'), (req, res) => {
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!individual) return res.status(404).json({ error: 'Removed individual not found.' });

  db.transaction(() => cascadeRestoreIndividual(individual))();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_individual', 'individual', individual.id, `"${individual.name}" restored.`
  );
  res.json({ individual: db.prepare('SELECT * FROM individuals WHERE id = ?').get(individual.id) });
});

// A durable, real record of structural-change proposals (e.g. "split this
// Sub-programme into two") — distinct from the immediate creation above.
// Anyone authenticated can read the queue; only 'manage_framework' holders
// can add to it. There is no approval workflow acting on these yet (same as
// the reference prototype this mirrors) — it's a log for CPU/exec to review
// manually, not a gate in front of the direct-creation routes above.
router.get('/proposals', (req, res) => {
  const rows = db.prepare(
    `SELECT p.id, p.scope, p.text, p.created_at, u.name AS created_by_name
     FROM structural_proposals p LEFT JOIN users u ON u.id = p.created_by
     ORDER BY p.id DESC`
  ).all();
  res.json({ proposals: rows });
});

router.post('/proposals', requirePerm('manage_framework'), (req, res) => {
  const { scope, text } = req.body || {};
  if (!['programme', 'sub'].includes(scope)) return res.status(400).json({ error: 'scope must be "programme" or "sub".' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'A description of the proposed change is required.' });

  const id = db.prepare('INSERT INTO structural_proposals (scope, text, created_by) VALUES (?, ?, ?)')
    .run(scope, text.trim(), req.user.id).lastInsertRowid;
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'propose_structural_change', 'structural_proposal', id,
    `[${scope === 'programme' ? 'Programme-level — routed to Ministry/PM&E' : 'Sub-programme/Unit-level — ZOU checkpoint'}] ${text.trim()}`
  );
  res.status(201).json({ proposal: db.prepare('SELECT * FROM structural_proposals WHERE id = ?').get(id) });
});

module.exports = router;
