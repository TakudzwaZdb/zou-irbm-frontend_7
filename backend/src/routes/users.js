const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole, requireAnyPerm, getUserPermissions, applyRolePermissions, listRolesWithPermissions, permissionsForRole } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/permissions');
const { generateTempPassword } = require('../utils/password');
const { sendPasswordResetEmail, isEmailConfigured } = require('../utils/mailer');

const router = express.Router();
router.use(requireAuth);

// Every route below already requires the ictadmin role (see the big
// comment further down), so this isn't guarding against a stranger
// guessing credentials the way auth.js's login limiters are — it's a
// backstop against a compromised or malfunctioning admin session mass-
// resetting passwords. Each reset immediately signs the target out of
// every session and forces a real password change, so at scale that's a
// genuine way to lock a whole organisation out of its own accounts, not
// just an inconvenience. Keyed on the acting admin's own user id, not IP.
const WORKER_COUNT = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);
const resetPasswordLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Math.max(2, Math.ceil(20 / WORKER_COUNT)),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `reset:${req.user?.id ?? 'unknown'}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many password resets in a short window. Please wait a few minutes and try again.' },
});

// Every mutating route below is individually gated requireRole('ictadmin')
// — must structurally BE the ICT Systems Administrator role, not just hold
// a permission that could itself be granted away. That's what makes "only
// ICT admin can give and remove permissions, change a role, reset a
// password, or remove an account" a real, server-enforced rule rather than
// a client-side convention. The two read-only routes just below (GET / and
// GET /removed) are the one exception: they accept EITHER manage_users
// (ictadmin) OR the narrower view_users permission, so CPU can be handed
// visibility into the Users directory — who exists, their role, their
// scope — without ever being able to act on any of it. See utils/
// permissions.js's comment on 'view_users' for the full reasoning.
router.get('/', requireAnyPerm('manage_users', 'view_users'), async (req, res) => {
  // Deactivated accounts (deleted_at set — see routes/org.js's
  // deactivateUserAccount, fired when the person tied to them is removed
  // from the org structure) are excluded from the Directory the same way a
  // removed Programme/Sub/Unit/Employee is excluded from the org tree:
  // the row and its history are intact, it just isn't part of "current"
  // anymore. It stays fully visible and actionable from Recently Removed →
  // restoring the person there reactivates the account too.
  const users = await db.prepare('SELECT id, name, title, email, role, scope_type, scope_id, avatar, overview_limit, is_executive_owner, mfa_enabled FROM users WHERE deleted_at IS NULL ORDER BY role, name').all();
  users.forEach((u) => { u.mfa_enabled = !!u.mfa_enabled; });
  const permRows = await db.prepare('SELECT user_id, permission_key FROM user_permissions').all();
  const permsByUser = {};
  permRows.forEach((r) => {
    (permsByUser[r.user_id] = permsByUser[r.user_id] || []).push(r.permission_key);
  });
  const roles = await listRolesWithPermissions();
  const rolePerms = {};
  roles.forEach((role) => { rolePerms[role.key] = role.permissions; });
  users.forEach((u) => {
    const direct = permsByUser[u.id] || [];
    u.directPermissions = direct;
    u.permissions = [...new Set([...direct, ...(rolePerms[u.role] || [])])].sort();
  });
  // How many active accounts currently hold each role — the Permissions
  // page's roles table shows this per role, so it needs a real count rather
  // than a field that was never actually populated.
  const countsByRole = {};
  users.forEach((u) => { countsByRole[u.role] = (countsByRole[u.role] || 0) + 1; });
  roles.forEach((role) => { role.user_count = countsByRole[role.key] || 0; });
  res.json({ users, roles, catalog: PERMISSIONS });
});

// Bulk-assigns ONE role to several users at once — a convenience over the
// single-user PATCH /:id/role below, restricted to roles that aren't the
// built-in Employee role: an Employee account needs a specific personal
// organisational scope (Programme/Sub-programme/Unit/individual employee
// record) picked per person, which this bulk form has no field for — that
// goes through this same page's per-row "Assign role & scope" popup instead
// (frontend/src/pages/Permissions.jsx's openScopeManage/applyRoleAndScope,
// which also calls PATCH /:id/role below), never the Users page — Users.jsx
// shows role and scope read-only only and has no editing UI for either at
// all. Every other role (built-in or custom) has no forced-scope concept at
// all any more, and role and scope are independent (see PATCH /:id/role's
// own header note) — this bulk form changes ONLY the role, leaving each
// selected person's existing organisation scope exactly as it was (the one
// exception: an individual-employee-record scope is meaningless on any
// role but Employee, which this route never assigns, so that one combination
// is cleared rather than carried over). Same single-holder-per-role rule
// PATCH /:id/role already enforces: each user is assigned in turn inside
// one transaction, so if two selected users would both occupy the same
// currently-vacant global seat, the first succeeds and the rest fail with
// "already occupied" by that same person — reported back per user rather
// than silently dropped or crashing the whole batch.
router.post('/assign-role', requireRole('ictadmin'), async (req, res) => {
  const { userIds, role } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'Select at least one user.' });
  const roleDefinition = await db.prepare('SELECT key, label FROM role_definitions WHERE key = ?').get(role);
  if (!roleDefinition) return res.status(400).json({ error: 'Invalid role.' });
  if (role === 'employee') {
    return res.status(400).json({ error: `${roleDefinition.label} needs a specific organisational scope for each person — select just that person's row on this page and use "Assign role & scope" instead of bulk assignment.` });
  }
  const ids = [...new Set(userIds.map(Number))].filter((id) => Number.isInteger(id));
  const results = [];
  const txn = db.transaction(async () => {
    for (const id of ids) {
      if (id === req.user.id) { results.push({ id, ok: false, error: 'You cannot change your own role.' }); continue; }
      const target = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!target) { results.push({ id, ok: false, error: 'User not found.' }); continue; }
      // Carry the person's existing scope forward unchanged — this route
      // never touches it — except an 'employee'-type (individual record)
      // scope, which only ever makes sense on the Employee role and this
      // route never assigns that role.
      const nextScopeType = target.scope_type === 'employee' ? null : target.scope_type;
      const nextScopeId = target.scope_type === 'employee' ? null : target.scope_id;
      const occupied = nextScopeType
        ? await db.prepare('SELECT name FROM users WHERE role = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL AND id != ?').get(role, nextScopeType, nextScopeId, id)
        : await db.prepare('SELECT name FROM users WHERE role = ? AND scope_type IS NULL AND scope_id IS NULL AND deleted_at IS NULL AND id != ?').get(role, id);
      if (occupied) { results.push({ id, ok: false, error: `Already occupied by ${occupied.name}.` }); continue; }
      await db.prepare('UPDATE employees SET user_id = NULL WHERE user_id = ?').run(id);
      await db.prepare('UPDATE programmes SET head_user_id = NULL WHERE head_user_id = ?').run(id);
      await db.prepare('UPDATE subs SET rep_user_id = NULL WHERE rep_user_id = ?').run(id);
      await db.prepare('UPDATE units SET head_user_id = NULL WHERE head_user_id = ?').run(id);
      await db.prepare('UPDATE users SET role = ?, title = ?, scope_type = ?, scope_id = ? WHERE id = ?').run(role, roleDefinition.label, nextScopeType, nextScopeId, id);
      if (role === 'programme' && nextScopeType === 'programme') await db.prepare('UPDATE programmes SET head_user_id = ? WHERE id = ?').run(id, nextScopeId);
      if (role === 'rep' && nextScopeType === 'sub') await db.prepare('UPDATE subs SET rep_user_id = ? WHERE id = ?').run(id, nextScopeId);
      if (role === 'unithead' && nextScopeType === 'unit') await db.prepare('UPDATE units SET head_user_id = ? WHERE id = ?').run(id, nextScopeId);
      // Same tier-change invariant as PATCH /:id/role: replace the previous
      // role's default grants so old access can't leak into the new role.
      await db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
      await applyRolePermissions(id, role);
      await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
        req.user.id, 'change_role', 'user', id, `${target.name}: role changed from "${target.role}" to "${role}" (bulk assignment).`
      );
      results.push({ id, ok: true });
    }
  });
  await txn();
  const okCount = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  if (okCount === 0) return res.status(400).json({ error: failed[0]?.error || 'No users were assigned.', results });
  res.json({ ok: true, assigned: okCount, failed: failed.length, results });
});

router.post('/roles/:role/permissions/:key/grant', requireRole('ictadmin'), async (req, res) => {
  const { role, key } = req.params;
  if (!PERMISSIONS.some((p) => p.key === key)) return res.status(404).json({ error: 'Unknown permission key.' });
  const definition = await db.prepare('SELECT key, label FROM role_definitions WHERE key = ?').get(role);
  if (!definition) return res.status(404).json({ error: 'Role not found.' });
  await db.transaction(async () => {
    await db.prepare('INSERT OR IGNORE INTO role_permissions (role_key, permission_key) VALUES (?, ?)').run(role, key);
    await db.prepare(`
      INSERT OR IGNORE INTO user_permissions (user_id, permission_key)
      SELECT id, ? FROM users WHERE role = ?
    `).run(key, role);
    await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id, 'permission_grant', 'role', null, `Granted "${key}" to the ${definition.label} role.`
    );
  })();
  res.json({ ok: true, role: { key: definition.key, permissions: await permissionsForRole(role) } });
});

router.post('/roles/:role/permissions/:key/revoke', requireRole('ictadmin'), async (req, res) => {
  const { role, key } = req.params;
  if (!PERMISSIONS.some((p) => p.key === key)) return res.status(404).json({ error: 'Unknown permission key.' });
  const definition = await db.prepare('SELECT key, label FROM role_definitions WHERE key = ?').get(role);
  if (!definition) return res.status(404).json({ error: 'Role not found.' });
  await db.transaction(async () => {
    await db.prepare('DELETE FROM role_permissions WHERE role_key = ? AND permission_key = ?').run(role, key);
    await db.prepare(`
      DELETE FROM user_permissions
      WHERE permission_key = ? AND user_id IN (SELECT id FROM users WHERE role = ?)
    `).run(key, role);
    await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id, 'permission_revoke', 'role', null, `Revoked "${key}" from the ${definition.label} role.`
    );
  })();
  res.json({ ok: true, role: { key: definition.key, permissions: await permissionsForRole(role) } });
});

router.post('/:id/permissions/:key/grant', requireRole('ictadmin'), async (req, res) => {
  const { id, key } = req.params;
  if (!PERMISSIONS.some((p) => p.key === key)) return res.status(404).json({ error: 'Unknown permission key.' });
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await db.transaction(async () => {
    await db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission_key) VALUES (?, ?)').run(id, key);
    await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id, 'permission_grant', 'user', id, `Granted "${key}" to ${target.name}.`
    );
  })();
  const permissions = await getUserPermissions(id);
  res.json({ ok: true, user: { id: Number(id), permissions } });
});

router.post('/:id/permissions/:key/revoke', requireRole('ictadmin'), async (req, res) => {
  const { id, key } = req.params;
  if (!PERMISSIONS.some((p) => p.key === key)) return res.status(404).json({ error: 'Unknown permission key.' });
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await db.transaction(async () => {
    await db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission_key = ?').run(id, key);
    await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id, 'permission_revoke', 'user', id, `Revoked "${key}" from ${target.name}.`
    );
  })();
  const permissions = await getUserPermissions(id);
  res.json({ ok: true, user: { id: Number(id), permissions } });
});

// Update a user's profile fields — name, email. Separate from role change
// and permission grants (different decision, different form), and
// deliberately allowed on your own account too (unlike role change/removal
// below) since fixing your own name or email typo shouldn't require another
// ICT admin.
//
// `title` is intentionally NOT accepted here — it is never free text typed
// by an admin. It is derived automatically from the account's role (see
// PATCH /:id/role and POST /assign-role, both of which set
// title = roleDefinition.label whenever a role/scope change is applied) so
// the label shown across the app always matches what the database actually
// says the account's role is, instead of drifting out of sync with a
// manually-typed value.
router.patch('/:id/profile', requireRole('ictadmin'), async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body || {};
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
  const normalizedEmail = email.trim().toLowerCase();
  const clash = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, id);
  if (clash) return res.status(400).json({ error: 'Another account already uses that email.' });

  await db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?')
    .run(name.trim(), normalizedEmail, id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'update_profile', 'user', id, `Profile updated for ${target.name} (was "${target.name}" <${target.email}>).`
  );
  res.json({ user: await db.prepare('SELECT id, name, title, email, role, scope_type, scope_id FROM users WHERE id = ?').get(id) });
});

// Admin-assisted password reset — the real, working answer to "reset it when
// they forget". ICT admin sets (or generates) a new password immediately,
// exactly like the temporary-password note already shown when a new Unit
// Head/Employee account is provisioned elsewhere in this app. The new
// password is always returned once, here, to the admin who just set it —
// never stored or logged in plain text — so this keeps working exactly as
// before on a deployment with no SMTP relay configured. When
// utils/mailer.js's isEmailConfigured() is true, this ALSO emails the new
// password directly to the account holder — best-effort, never blocking:
// a delivery failure just falls back to the admin relaying it by hand,
// same as always (see `emailed` in the response).
//
// Always marks the account must_change_password (see SECURITY_REVIEW.md's
// finding #1): whatever password ICT admin just set — a real word they
// spoke over the phone, or a generated one — is by definition known to a
// second person, so the account is required to set its own real password at
// next sign-in before it can do anything else. Also bumps token_version, so
// a reset done because an account may be compromised actually signs that
// account out of every session it currently holds, not just changes what a
// future login would need.
router.post('/:id/reset-password', requireRole('ictadmin'), resetPasswordLimiter, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  const target = await db.prepare('SELECT id, name, email, auth_provider FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.auth_provider === 'azure') {
    return res.status(400).json({ error: 'This account signs in with Microsoft — there is no password to reset.' });
  }

  const chosen = (newPassword && String(newPassword).trim()) || generateTempPassword();
  if (chosen.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const hash = bcrypt.hashSync(chosen, 10);
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?').run(hash, id);

  let emailed = false;
  if (isEmailConfigured()) {
    const result = await sendPasswordResetEmail({ to: target.email, name: target.name, password: chosen });
    emailed = result.ok;
  }

  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'reset_password', 'user', id,
    `Password reset for ${target.name} by ICT admin (must change it at next sign-in)${emailed ? ' — emailed to them directly.' : '.'}`
  );
  res.json({ newPassword: chosen, emailed });
});

// The real answer to "I lost my phone and my recovery codes" — the same
// admin-assisted-recovery shape as reset-password just above, for the one
// other credential this app now has. Turns MFA off for the account (never
// silently re-enables it) and clears every recovery code; the person signs
// in with just their password afterward and can set MFA back up with a new
// device from their own Profile page whenever they're ready.
router.post('/:id/mfa/disable', requireRole('ictadmin'), async (req, res) => {
  const { id } = req.params;
  const target = await db.prepare('SELECT id, name, mfa_enabled FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (!target.mfa_enabled) return res.status(400).json({ error: 'That account does not have two-factor authentication enabled.' });

  await db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(id);
  await db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'mfa_disabled', 'user', id, `Two-factor authentication reset for ${target.name} by ICT admin (lost device/recovery codes).`
  );
  res.json({ ok: true });
});

const OVERVIEW_LIMITS = ['programme', 'sub', 'unit'];
// Scope is a property of the PERSON, never something a role declares or
// requires (see db.js's CREATE TABLE comment for role_definitions and
// routes/org.js's POST/PATCH /roles). The one exception, unchanged since
// before any of this: the built-in Employee role always needs a specific
// organisation scope for each person — Programme, Sub-programme, Unit, or
// an individual employee record. Every other role, built-in or custom, may
// optionally be given a Programme/Sub-programme/Unit scope or none at all —
// "Employee" is not offered as a scope choice for a non-Employee role,
// since Employee is a role, not a scope type.
const GENERAL_SCOPE_TYPES = ['programme', 'sub', 'unit'];

// Change a user's role and/or scope — e.g. reassigning a Unit Head to a
// different unit, promoting someone into a new role, or simply moving a
// Sub-programme Rep's scope to a different sub without touching their role
// at all. ICT admin only (this whole file is gated that way). Left
// deliberately simple: it does NOT touch the user's existing granted
// permissions when the role changes, since a role change and a permission
// change are different decisions — review the Permissions panel afterwards
// if the new role needs a different permission set.
//
// Role and scope are independent — one can change without the other. This
// request body carries `role` always (the frontend always knows the
// person's current role, so a scope-only change just resends it unchanged
// — see Permissions.jsx's "Change scope" popup, opened by clicking a
// user's row), but `scopeType`/`scopeId` are optional: a request that
// leaves scopeType OUT of the body entirely changes only the role and
// leaves the person's current scope exactly as it was (see Permissions.jsx's
// "Assign role" modal, which sends role alone for every role except the
// built-in Employee role, which still needs one supplied in the same call
// — see below). Only when scopeType IS a key in the body does this route
// touch scope at all, even to clear it (an explicit `scopeType: null` from
// the "No scope" option means "clear it").
router.patch('/:id/role', requireRole('ictadmin'), async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const { role } = body;
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
  const roleDefinition = await db.prepare('SELECT key, label FROM role_definitions WHERE key = ?').get(role);
  if (!roleDefinition) return res.status(400).json({ error: 'Invalid role.' });
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const scopeProvided = Object.prototype.hasOwnProperty.call(body, 'scopeType');
  let scopeType = scopeProvided ? body.scopeType : target.scope_type;
  let scopeId = scopeProvided ? body.scopeId : target.scope_id;
  // An individual-employee-record scope only ever makes sense on the
  // Employee role. This only fires on a role-only request (scope NOT
  // provided, so it's being carried forward from whatever the person had
  // before) — an explicit attempt to set scopeType: 'employee' on some
  // other role is a real mistake and still rejected below, same as ever.
  if (!scopeProvided && role !== 'employee' && scopeType === 'employee') {
    scopeType = null;
    scopeId = null;
  }

  if (role === 'employee') {
    if (!['programme', 'sub', 'unit', 'employee'].includes(scopeType)) {
      return res.status(400).json({ error: 'Employee accounts must be assigned to a Programme, Sub-programme, Unit / Department / Faculty / Region, or Employee scope.' });
    }
  } else if (scopeType != null && !GENERAL_SCOPE_TYPES.includes(scopeType)) {
    return res.status(400).json({ error: 'Invalid scope type.' });
  }
  if (scopeType && !scopeId) return res.status(400).json({ error: 'A scope selection is required.' });
  if (scopeType) {
    const scopeTables = { programme: 'programmes', sub: 'subs', unit: 'units', employee: 'employees' };
    const scope = await db.prepare(`SELECT id FROM ${scopeTables[scopeType]} WHERE id = ? AND deleted_at IS NULL`).get(scopeId);
    if (!scope) return res.status(400).json({ error: 'The selected organisation scope was not found.' });
  }
  if (role === 'employee' && scopeType === 'employee') {
    const employee = await db.prepare(`
      SELECT i.id, i.user_id, u.id AS unit_id, u.deleted_at AS unit_deleted_at,
        s.id AS sub_id, s.deleted_at AS sub_deleted_at,
        p.id AS programme_id, p.deleted_at AS programme_deleted_at
      FROM employees i
      JOIN units u ON u.id = i.unit_id
      JOIN subs s ON s.id = u.sub_id
      JOIN programmes p ON p.id = s.programme_id
      WHERE i.id = ? AND i.deleted_at IS NULL
    `).get(scopeId);
    if (!employee || employee.unit_deleted_at || employee.sub_deleted_at || employee.programme_deleted_at) {
      return res.status(400).json({ error: 'An Employee must be assigned to an active Programme, Sub-programme, and Unit / Department / Faculty / Region.' });
    }
  }

  // A role represents a single occupied appointment at its scope. Global
  // roles have one university-wide appointment; scoped roles have one
  // appointment per selected Programme, Sub-programme, or Unit. Employee
  // is deliberately exempt because multiple Employee accounts are valid.
  if (role !== 'employee') {
    const occupied = scopeType
      ? await db.prepare('SELECT name FROM users WHERE role = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL AND id != ? ORDER BY id LIMIT 1')
        .get(role, scopeType, scopeId, id)
      : await db.prepare('SELECT name FROM users WHERE role = ? AND scope_type IS NULL AND scope_id IS NULL AND deleted_at IS NULL AND id != ? ORDER BY id LIMIT 1')
        .get(role, id);
    if (occupied) {
      return res.status(400).json({ error: `That ${roleDefinition.label} role is already occupied by ${occupied.name}.` });
    }

    // The org tree's own head_user_id/rep_user_id columns (see below) are a
    // SEPARATE, additional appointment concept from the generic occupied
    // check above — they only make sense when scope isn't just "which
    // Programme/Sub/Unit this person is associated with" but specifically
    // "this person IS the org tree's Programme Head / Sub-programme Rep /
    // Unit Head for that node". Now that scope is decoupled from role,
    // Programme Head can optionally carry a non-programme scope (e.g. a
    // Unit) — that's a person's own organisation scope, not a claim on
    // being some OTHER Unit's Head, so this appointment check (and the
    // matching head_user_id/rep_user_id writes below) only ever fire when
    // the scope type still matches the role's own canonical one.
    const appointment = role === 'programme' && scopeType === 'programme'
      ? await db.prepare('SELECT u.name FROM programmes p JOIN users u ON u.id = p.head_user_id WHERE p.id = ? AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND p.head_user_id != ?').get(scopeId, id)
      : role === 'rep' && scopeType === 'sub'
        ? await db.prepare('SELECT u.name FROM subs s JOIN users u ON u.id = s.rep_user_id WHERE s.id = ? AND s.deleted_at IS NULL AND u.deleted_at IS NULL AND s.rep_user_id != ?').get(scopeId, id)
        : role === 'unithead' && scopeType === 'unit'
          ? await db.prepare('SELECT u.name FROM units n JOIN users u ON u.id = n.head_user_id WHERE n.id = ? AND n.deleted_at IS NULL AND u.deleted_at IS NULL AND n.head_user_id != ?').get(scopeId, id)
          : null;
    if (appointment) {
      return res.status(400).json({ error: `That ${roleDefinition.label} appointment is already occupied by ${appointment.name}.` });
    }
  }

  const roleChanged = role !== target.role;
  const scopeChanged = String(scopeType || '') !== String(target.scope_type || '') || String(scopeId || '') !== String(target.scope_id || '');

  const change = db.transaction(async () => {
    await db.prepare('UPDATE employees SET user_id = NULL WHERE user_id = ?').run(id);
    await db.prepare('UPDATE programmes SET head_user_id = NULL WHERE head_user_id = ?').run(id);
    await db.prepare('UPDATE subs SET rep_user_id = NULL WHERE rep_user_id = ?').run(id);
    await db.prepare('UPDATE units SET head_user_id = NULL WHERE head_user_id = ?').run(id);
    await db.prepare('UPDATE users SET role = ?, title = ?, scope_type = ?, scope_id = ? WHERE id = ?')
      .run(role, roleDefinition.label, scopeType || null, scopeId || null, id);
    if (role === 'employee' && scopeType === 'employee') await db.prepare('UPDATE employees SET user_id = ? WHERE id = ?').run(id, scopeId);
    // Same scope-type guard as the appointment check above — a role's own
    // org-tree appointment column is only ever written when the scope
    // actually matches that role's canonical type.
    if (role === 'programme' && scopeType === 'programme') await db.prepare('UPDATE programmes SET head_user_id = ? WHERE id = ?').run(id, scopeId);
    if (role === 'rep' && scopeType === 'sub') await db.prepare('UPDATE subs SET rep_user_id = ? WHERE id = ?').run(id, scopeId);
    if (role === 'unithead' && scopeType === 'unit') await db.prepare('UPDATE units SET head_user_id = ? WHERE id = ?').run(id, scopeId);
    // A tier change changes the account's authority everywhere, not just its
    // label — replace the previous tier's default grants so old access
    // cannot leak into the new role. A scope-only change (role unchanged —
    // e.g. the "Change scope" popup) is a completely different, unrelated
    // decision and must NOT touch permissions at all, or every individually
    // granted extra permission on that account would be silently wiped out
    // by simply moving them to a different Sub-programme or Unit.
    if (roleChanged) {
      await db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
      await applyRolePermissions(id, role);
    }
  });
  await change();
  const changeDescriptions = [];
  if (roleChanged) changeDescriptions.push(`role changed from "${target.role}" to "${role}"`);
  if (scopeChanged) changeDescriptions.push('organisation scope updated');
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'change_role', 'user', id,
    changeDescriptions.length ? `${target.name}: ${changeDescriptions.join('; ')}.` : `${target.name}: role/scope re-applied with no change.`
  );
  res.json({ user: await db.prepare('SELECT id, name, title, email, role, scope_type, scope_id FROM users WHERE id = ?').get(id) });
});

// Sets (or clears) how deep this account may drill into Overview's
// Programme -> Sub-programme -> Unit -> Employee structure — a real
// visibility ceiling on the exploratory browsing view, independent of role
// or any other permission (see db.js's users.overview_limit / lib/scope.js's
// canDrillToKind on the frontend, which is what actually enforces it).
// null clears the restriction entirely ("the overall structure" — no cap).
router.patch('/:id/overview-limit', requireRole('ictadmin'), async (req, res) => {
  const { id } = req.params;
  const { overviewLimit } = req.body || {};
  if (overviewLimit != null && !OVERVIEW_LIMITS.includes(overviewLimit)) {
    return res.status(400).json({ error: `overviewLimit must be one of: ${OVERVIEW_LIMITS.join(', ')}, or null.` });
  }
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await db.prepare('UPDATE users SET overview_limit = ? WHERE id = ?').run(overviewLimit || null, id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
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
router.patch('/:id/executive-owner', requireRole('ictadmin'), async (req, res) => {
  const { id } = req.params;
  const { executiveOwner } = req.body || {};
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const txn = db.transaction(async () => {
    if (executiveOwner) await db.prepare('UPDATE users SET is_executive_owner = 0 WHERE is_executive_owner = 1').run();
    await db.prepare('UPDATE users SET is_executive_owner = ? WHERE id = ?').run(executiveOwner ? 1 : 0, id);
  });
  await txn();
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
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
// (head_user_id/rep_user_id) or Employee record it's the login for
// (employees.user_id) are all left exactly as they were — nothing is
// nulled out, because nothing needs to satisfy a foreign key that a real
// DELETE would have violated. Fully reversible from Recently Removed
// (POST /:id/restore below) or use DELETE /api/org/employees/:id instead
// to remove an Employee's whole org record along with their account in
// one step.
// Recently-removed accounts — the same "Recently Removed" idea as
// routes/org.js's GET /api/org/removed and routes/kpis.js's GET /removed,
// scoped to accounts removed directly from this Directory (DELETE /:id
// below). An account deactivated as a side effect of removing the
// Employee/Unit-head/Sub-Rep/Programme-head it belongs to already
// reappears in Organisation Maintenance's own Recently Removed instead —
// restoring the person there reactivates their account in the same step —
// so this list only ever shows accounts removed by that DELETE route
// directly, which had no restore path visible anywhere in the UI at all
// until this endpoint existed to back one.
router.get('/removed', requireAnyPerm('manage_users', 'view_users'), async (req, res) => {
  const users = await db.prepare(
    'SELECT id, name, title, email, role, scope_type, scope_id, deleted_at FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
  ).all();
  res.json({ users });
});

router.delete('/:id', requireRole('ictadmin'), async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  await db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?").run(id);

  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'remove_account', 'user', id, `Account removed: ${target.name}. Recoverable from Recently Removed.`
  );
  res.json({ ok: true });
});

// Restore a previously-removed account — clears deleted_at so it can sign
// in again immediately, with its permissions, role, and every link to it
// (Unit/Sub headship, Employee record) intact exactly as they were.
router.post('/:id/restore', requireRole('ictadmin'), async (req, res) => {
  const { id } = req.params;
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ? AND deleted_at IS NOT NULL').get(id);
  if (!target) return res.status(404).json({ error: 'Removed account not found.' });

  await db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').run(id);

  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_account', 'user', id, `Account restored: ${target.name}.`
  );
  res.json({ ok: true });
});

module.exports = router;
