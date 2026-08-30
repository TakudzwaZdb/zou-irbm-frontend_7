const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/permissions');

const router = express.Router();

// Every route below is double-gated: requireAuth (must be signed in) AND
// requireRole('ictadmin') (must structurally BE the ICT Systems Administrator
// role — not just hold a permission that could itself be granted away). This
// is what makes "only ICT admin can give and remove permissions" a real,
// server-enforced rule rather than a client-side convention.
router.use(requireAuth, requireRole('ictadmin'));

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, name, title, email, role, scope_type, scope_id, avatar FROM users ORDER BY role, name').all();
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
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
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
// password immediately, exactly like the demo-password note already shown
// when a new Unit Head/Individual account is provisioned elsewhere in this
// app. The new password is only ever returned once, here, to the admin who
// just set it — never stored or logged in plain text.
router.post('/:id/reset-password', (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const chosen = (newPassword && String(newPassword).trim()) || crypto.randomBytes(9).toString('base64url');
  if (chosen.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const hash = bcrypt.hashSync(chosen, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'reset_password', 'user', id, `Password reset for ${target.name} by ICT admin.`
  );
  res.json({ newPassword: chosen });
});

const ROLES = ['exec', 'cpu', 'ictadmin', 'rep', 'unithead', 'individual', 'programme'];
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

// Remove a user account entirely. Any unit/sub they head/represent, or
// individual record they're the login for, is left in place but loses
// its account (head_user_id/rep_user_id/individuals.user_id set to NULL)
// rather than being deleted outright — use DELETE /api/org/individuals/:id
// instead to remove an Individual's org record along with their account.
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const removeTxn = db.transaction(() => {
    db.prepare('UPDATE units SET head_user_id = NULL WHERE head_user_id = ?').run(id);
    db.prepare('UPDATE subs SET rep_user_id = NULL WHERE rep_user_id = ?').run(id);
    db.prepare('UPDATE individuals SET user_id = NULL WHERE user_id = ?').run(id);
    // Past audit entries where this person was the actor are kept, just
    // no longer attributed to a user row that's about to be gone.
    db.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  removeTxn();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_account', 'user', id, `Account removed: ${target.name}.`
  );
  res.json({ ok: true });
});

module.exports = router;
