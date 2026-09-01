const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requirePerm, requireAnyPerm } = require('../middleware/auth');
const { uniqueEmailFor } = require('../utils/email');
const { DEFAULT_PERMS_BY_ROLE } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// Returns the whole structure. The frontend narrows what it SHOWS based on
// req.user's role/scope (see /api/auth/me), but the data itself is small and
// non-sensitive enough that serving the full tree keeps this reference
// implementation simple — a larger deployment would filter server-side too.
router.get('/', (req, res) => {
  const programmes = db.prepare('SELECT * FROM programmes ORDER BY id').all();
  const subs = db.prepare('SELECT * FROM subs ORDER BY id').all();
  const units = db.prepare('SELECT * FROM units ORDER BY id').all();
  const individuals = db.prepare('SELECT * FROM individuals ORDER BY id').all();
  // Whoever ICT admin has designated as Executive Owner (see users.
  // is_executive_owner / routes/users.js's PATCH /:id/executive-owner) —
  // ordinarily the Vice Chancellor — accountable for overall institutional
  // performance against the Plan. Plain name/title only, like every other
  // org-chart "head" field already exposed here to every signed-in
  // account; this is a public designation, not a permission grant.
  const executiveOwner = db.prepare('SELECT id, name, title FROM users WHERE is_executive_owner = 1 LIMIT 1').get() || null;
  res.json({ programmes, subs, units, individuals, executiveOwner });
});

// Live creation of a Unit / Department / Faculty / Region under a
// Sub-programme — requires 'manage_org_units'. Also provisions a Unit Head
// account with a real derived email + a demo password, so the new head can
// sign in immediately (an ICT Systems Administrator can extend/adjust their
// permissions afterwards from the Permissions page).
router.post('/units', requirePerm('manage_org_units'), (req, res) => {
  const { subId, name, head, kind } = req.body || {};
  if (!subId || !name || !head) {
    return res.status(400).json({ error: 'subId, name, and head are required.' });
  }
  const sub = db.prepare('SELECT * FROM subs WHERE id = ?').get(subId);
  if (!sub) return res.status(404).json({ error: 'Sub-programme not found.' });

  const email = uniqueEmailFor(head);
  const passwordHash = bcrypt.hashSync(process.env.SEED_PASSWORD || 'Zou@2026', 10);
  const headUserId = db
    .prepare('INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
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
    headAccount: { email, note: `Demo password: ${process.env.SEED_PASSWORD || 'Zou@2026'}` },
  });
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
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId);
  if (!unit) return res.status(404).json({ error: 'Unit not found.' });

  if (!req.user.permissions.includes('manage_org_units')) {
    const inOwnUnit = req.user.role === 'unithead' && req.user.scope_id === unit.id;
    const inOwnSub = req.user.role === 'rep' && req.user.scope_id === unit.sub_id;
    if (!inOwnUnit && !inOwnSub) {
      return res.status(403).json({ error: 'You can only add an individual within your own unit or sub-programme.' });
    }
  }

  const email = uniqueEmailFor(name);
  const passwordHash = bcrypt.hashSync(process.env.SEED_PASSWORD || 'Zou@2026', 10);
  const userId = db
    .prepare('INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
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
    account: { email, note: `Demo password: ${process.env.SEED_PASSWORD || 'Zou@2026'}` },
  });
});

// Remove an Individual — also removes their login account and any KPIs
// owned directly by them (owner_type='individual'), so nothing is left
// pointing at a person who no longer exists in the structure.
router.delete('/individuals/:id', requirePerm('manage_org_units'), (req, res) => {
  const individual = db.prepare('SELECT * FROM individuals WHERE id = ?').get(req.params.id);
  if (!individual) return res.status(404).json({ error: 'Individual not found.' });

  const removeTxn = db.transaction(() => {
    const kpiCount = db.prepare("SELECT COUNT(*) AS n FROM kpis WHERE owner_type = 'individual' AND owner_id = ?").get(individual.id).n;
    db.prepare("DELETE FROM kpis WHERE owner_type = 'individual' AND owner_id = ?").run(individual.id);
    // The individuals row itself (individuals.user_id) must go BEFORE the
    // user row, or deleting the user violates that foreign key.
    db.prepare('DELETE FROM individuals WHERE id = ?').run(individual.id);
    if (individual.user_id) {
      db.prepare('UPDATE units SET head_user_id = NULL WHERE head_user_id = ?').run(individual.user_id);
      db.prepare('UPDATE subs SET rep_user_id = NULL WHERE rep_user_id = ?').run(individual.user_id);
      // Past audit entries where this person was the actor are kept, just
      // no longer attributed to a user row that's about to be gone.
      db.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').run(individual.user_id);
      db.prepare('DELETE FROM users WHERE id = ?').run(individual.user_id);
    }
    return kpiCount;
  });
  const kpiCount = removeTxn();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_individual', 'individual', individual.id,
    `"${individual.name}" removed (account deleted${kpiCount ? `, ${kpiCount} owned KPI(s) removed` : ''}).`
  );
  res.json({ ok: true });
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
