const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/permissions');
const { generateTempPassword } = require('../utils/password');

const router = express.Router();

// Every route below is double-gated: requireAuth (must be signed in) AND
// requireRole('ictadmin') (must structurally BE the ICT Systems Administrator
// role — not just hold a permission that could itself be granted away). This
// is what makes "only ICT admin can give and remove permissions" a real,
// server-enforced rule rather than a client-side convention.
router.use(requireAuth, requireRole('ictadmin'));

router.get('/', (req, res) => {
  // Deactivated accounts (deleted_at set — see routes/org.js's
  // deactivateUserAccount, fired when the person tied to them is removed
  // from the org structure) are excluded from the Directory the same way a
  // removed Programme/Sub/Unit/Individual is excluded from the org tree:
  // the row and its history are intact, it just isn't part of "current"
  // anymore. It stays fully visible and actionable from Recently Removed →
  // restoring the person there reactivates the account too.
  const users = db.prepare('SELECT id, name, title, email, role, scope_type, scope_id, avatar, overview_limit, is_executive_owner, mfa_enabled FROM users WHERE deleted_at IS NULL ORDER BY role, name').all();
  users.forEach((u) => { u.mfa_enabled = !!u.mfa_enabled; });
  const permRows = db.prepare('SELECT user_id, permission_key FROM user_permissions').all();
  const permsByUser = {};
  permRows.forEach((r) => {
    (permsByUser[r.user_id] = permsByUser[r.user_id] || []).push(r.permission_key);
  });
  users.forEach((u) => { u.permissions = permsByUser[u.id] || []; });
  res.json({ users, catalog: PERMISSIONS });
});

router.post('/:id/permissions/:key/grant', (req, res) => {
  const { id, key } = req.params;
  if (!PERMISSIONS.some((p) => p.key === key)) return res.status(404).json({ error: 'Unknown permission key.' });
  const target = db.prepare('SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission_key) VALUES (?, ?)').run(id, key);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'permission_grant', 'user', id, `Granted "${key}" to ${target.name}.`
  );
  res.json({ ok: true });
});

router.post('/:id/permissions/:key/revoke', (req, res) => {
  const { id, key } = req.params;
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission_key = ?').run(id, key);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'permission_revoke', 'user', id, `Revoked "${key}" from ${target.name}.`
  );
  res.json({ ok: true });
});

// Update a user's profile fields — name, title, email. Separate from role
// change and permission grants (different decision, different form), and
// deliberately allowed on your own account too (unlike role change/removal
// below) since fixing your own name or email typo shouldn't require another
// ICT admin.
router.patch('/:id/profile', (req, res) => {
  const { id } = req.params;
  const { name, title, email } = req.body || {};
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
  const normalizedEmail = email.trim().toLowerCase();
  const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, id);
  if (clash) return res.status(400).json({ error: 'Another account already uses that email.' });

  db.prepare('UPDATE users SET name = ?, title = ?, email = ? WHERE id = ?')
    .run(name.trim(), (title || '').trim(), normalizedEmail, id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'update_profile', 'user', id, `Profile updated for ${target.name} (was "${target.name}" <${target.email}>).`
  );
  res.json({ user: db.prepare('SELECT id, name, title, email, role, scope_type, scope_id FROM users WHERE id = ?').get(id) });
});

// Admin-assisted password reset — the real, working answer to "reset it when
// they forget" for an internal tool with no email/SMS delivery service
// standing behind it. Rather than fake a "check your email" flow with
// nowhere for the email to actually go, ICT admin sets (or generates) a new
// password immediately, exactly like the temporary-password note already
// shown when a new Unit Head/Individual account is provisioned elsewhere in
// this app. The new password is only ever returned once, here, to the admin
// who just set it — never stored or logged in plain text.
//
// Always marks the account must_change_password (see SECURITY_REVIEW.md's
// finding #1): whatever password ICT admin just set — a real word they
// spoke over the phone, or a generated one — is by definition known to a
// second person, so the account is required to set its own real password at
// next sign-in before it can do anything else. Also bumps token_version, so
// a reset done because an account may be compromised actually signs that
// account out of every session it currently holds, not just changes what a
// future login would need.
router.post('/:id/reset-password', (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const chosen = (newPassword && String(newPassword).trim()) || generateTempPassword();
  if (chosen.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const hash = bcrypt.hashSync(chosen, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?').run(hash, id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'reset_password', 'user', id, `Password reset for ${target.name} by ICT admin (must change it at next sign-in).`
  );
  res.json({ newPassword: chosen });
});

// The real answer to "I lost my phone and my recovery codes" — the same
// admin-assisted-recovery shape as reset-password just above, for the one
// other credential this app now has. Turns MFA off for the account (never
// silently re-enables it) and clears every recovery code; the person signs
// in with just their password afterward and can set MFA back up with a new
// device from their own Profile page whenever they're ready.
router.post('/:id/mfa/disable', (req, res) => {
  const { id } = req.params;
  const target = db.prepare('SELECT id, name, mfa_enabled FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (!target.mfa_enabled) return res.status(400).json({ error: 'That account does not have two-factor authentication enabled.' });

  db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(id);
  db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'mfa_disabled', 'user', id, `Two-factor authentication reset for ${target.name} by ICT admin (lost device/recovery codes).`
  );
  res.json({ ok: true });
});

const ROLES = ['exec', 'cpu', 'ictadmin', 'rep', 'unithead', 'individual', 'programme', 'council'];
const OVERVIEW_LIMITS = ['programme', 'sub', 'unit'];
const SCOPE_TYPES = ['sub', 'unit', 'individual', 'programme'];

// Change a user's role/scope — e.g. reassigning a Unit Head to a different
// unit, or promoting someone into a new role. ICT admin only (this whole
// file is gated that way). Left deliberately simple: it does NOT touch the
// user's existing granted permissions, since a role change and a
// permission change are different decisions — review the Permissions
// panel afterwards if the new role needs a different permission set.
router.patch('/:id/role', (req, res) => {
  const { id } = req.params;
  const { role, scopeType, scopeId } = req.body || {};
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (scopeType != null && !SCOPE_TYPES.includes(scopeType)) return res.status(400).json({ error: 'Invalid scope type.' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  db.prepare('UPDATE users SET role = ?, scope_type = ?, scope_id = ? WHERE id = ?')
    .run(role, scopeType || null, scopeId || null, id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'change_role', 'user', id, `${target.name}: role changed from "${target.role}" to "${role}".`
  );
  res.json({ user: db.prepare('SELECT id, name, title, email, role, scope_type, scope_id FROM users WHERE id = ?').get(id) });
});

// Sets (or clears) how deep this account may drill into Overview's
// Programme -> Sub-programme -> Unit -> Individual structure — a real
// visibility ceiling on the exploratory browsing view, independent of role
// or any other permission (see db.js's users.overview_limit / lib/scope.js's
// canDrillToKind on the frontend, which is what actually enforces it).
// null clears the restriction entirely ("the overall structure" — no cap).
router.patch('/:id/overview-limit', (req, res) => {
  const { id } = req.params;
  const { overviewLimit } = req.body || {};
  if (overviewLimit != null && !OVERVIEW_LIMITS.includes(overviewLimit)) {
    return res.status(400).json({ error: `overviewLimit must be one of: ${OVERVIEW_LIMITS.join(', ')}, or null.` });
  }
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  db.prepare('UPDATE users SET overview_limit = ? WHERE id = ?').run(overviewLimit || null, id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'set_overview_limit', 'user', id,
    overviewLimit ? `${target.name}'s Overview navigation was capped at "${overviewLimit}" level.` : `${target.name}'s Overview navigation restriction was cleared.`
  );
  res.json({ ok: true });
});

// Designates (or un-designates) the single account that is this
// university's Executive Owner — accountable for overall institutional
// performance against the Plan (see routes/org.js's GET / and
// Overview.jsx's "Overall Institutional Performance" card). Deliberately
// single-holder: setting it on one account clears it from every other in
// the same transaction, so "who is accountable" is never ambiguous.
router.patch('/:id/executive-owner', (req, res) => {
  const { id } = req.params;
  const { executiveOwner } = req.body || {};
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const txn = db.transaction(() => {
    if (executiveOwner) db.prepare('UPDATE users SET is_executive_owner = 0 WHERE is_executive_owner = 1').run();
    db.prepare('UPDATE users SET is_executive_owner = ? WHERE id = ?').run(executiveOwner ? 1 : 0, id);
  });
  txn();
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'set_executive_owner', 'user', id,
    executiveOwner ? `${target.name} designated Executive Owner — accountable for overall institutional performance.` : `${target.name} un-designated as Executive Owner.`
  );
  res.json({ ok: true });
});

// Remove a user account — stamped deleted_at (see db.js's migration and
// routes/org.js's deactivateUserAccount, which uses the same mechanism),
// never a real SQL DELETE. Sign-in is blocked immediately (routes/auth.js's
// POST /login, middleware/auth.js's requireAuth) and the account drops out
// of the Directory above, but the row itself, its permissions, its audit
// history, and its links from any Unit/Sub it heads or represents
// (head_user_id/rep_user_id) or Individual record it's the login for
// (individuals.user_id) are all left exactly as they were — nothing is
// nulled out, because nothing needs to satisfy a foreign key that a real
// DELETE would have violated. Fully reversible from Recently Removed
// (POST /:id/restore below) or use DELETE /api/org/individuals/:id instead
// to remove an Individual's whole org record along with their account in
// one step.
// Recently-removed accounts — the same "Recently Removed" idea as
// routes/org.js's GET /api/org/removed and routes/kpis.js's GET /removed,
// scoped to accounts removed directly from this Directory (DELETE /:id
// below). An account deactivated as a side effect of removing the
// Individual/Unit-head/Sub-Rep/Programme-head it belongs to already
// reappears in Organisation Maintenance's own Recently Removed instead —
// restoring the person there reactivates their account in the same step —
// so this list only ever shows accounts removed by that DELETE route
// directly, which had no restore path visible anywhere in the UI at all
// until this endpoint existed to back one.
router.get('/removed', (req, res) => {
  const users = db.prepare(
    'SELECT id, name, title, email, role, scope_type, scope_id, deleted_at FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
  ).all();
  res.json({ users });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  const target = db.prepare('SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?").run(id);

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_account', 'user', id, `Account removed: ${target.name}. Recoverable from Recently Removed.`
  );
  res.json({ ok: true });
});

// Restore a previously-removed account — clears deleted_at so it can sign
// in again immediately, with its permissions, role, and every link to it
// (Unit/Sub headship, Individual record) intact exactly as they were.
router.post('/:id/restore', (req, res) => {
  const { id } = req.params;
  const target = db.prepare('SELECT id, name FROM users WHERE id = ? AND deleted_at IS NOT NULL').get(id);
  if (!target) return res.status(404).json({ error: 'Removed account not found.' });

  db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').run(id);

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_account', 'user', id, `Account restored: ${target.name}.`
  );
  res.json({ ok: true });
});

module.exports = router;
