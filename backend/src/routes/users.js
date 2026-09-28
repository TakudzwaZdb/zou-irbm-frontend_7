const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole, getUserPermissions, applyRolePermissions, listRolesWithPermissions, permissionsForRole } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/permissions');
const { generateTempPassword } = require('../utils/password');

const router = express.Router();

// Every route below is double-gated: requireAuth (must be signed in) AND
// requireRole('ictadmin') (must structurally BE the ICT Systems Administrator
// role — not just hold a permission that could itself be granted away). This
// is what makes "only ICT admin can give and remove permissions" a real,
// server-enforced rule rather than a client-side convention.
router.use(requireAuth, requireRole('ictadmin'));

router.get('/', async (req, res) => {
  // Deactivated accounts (deleted_at set — see routes/org.js's
  // deactivateUserAccount, fired when the person tied to them is removed
  // from the org structure) are excluded from the Directory the same way a
  // removed Programme/Sub/Unit/Individual is excluded from the org tree:
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
// single-user PATCH /:id/role below, restricted to roles that don't need a
// personal organisational scope (exec/cpu/ictadmin/council and any custom
// global role created via POST /api/org/roles): a scoped role (Unit Head,
// Sub-programme Rep, Programme Head, Individual) needs a specific
// Unit/Sub/Programme/Individual picked per person, which this bulk form has
// no field for — those still go through the Users page's per-person role
// change. Same single-holder-per-global-role rule PATCH /:id/role already
// enforces: each user is assigned in turn inside one transaction, so if two
// selected users would both occupy the same currently-vacant global seat,
// the first succeeds and the rest fail with "already occupied" by that same
// person — reported back per user rather than silently dropped or crashing
// the whole batch.
router.post('/assign-role', async (req, res) => {
  const { userIds, role } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'Select at least one user.' });
  const roleDefinition = await db.prepare('SELECT key, label FROM role_definitions WHERE key = ?').get(role);
  if (!roleDefinition) return res.status(400).json({ error: 'Invalid role.' });
  if (ROLE_SCOPE_TYPES[role] || role === 'individual') {
    return res.status(400).json({ error: `${roleDefinition.label} needs a specific organisational scope for each person — assign it one person at a time from the Users page instead.` });
  }
  const ids = [...new Set(userIds.map(Number))].filter((id) => Number.isInteger(id));
  const results = [];
  const txn = db.transaction(async () => {
    for (const id of ids) {
      if (id === req.user.id) { results.push({ id, ok: false, error: 'You cannot change your own role.' }); continue; }
      const target = await db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!target) { results.push({ id, ok: false, error: 'User not found.' }); continue; }
      const occupied = await db.prepare('SELECT name FROM users WHERE role = ? AND scope_type IS NULL AND scope_id IS NULL AND deleted_at IS NULL AND id != ?').get(role, id);
      if (occupied) { results.push({ id, ok: false, error: `Already occupied by ${occupied.name}.` }); continue; }
      await db.prepare('UPDATE individuals SET user_id = NULL WHERE user_id = ?').run(id);
      await db.prepare('UPDATE programmes SET head_user_id = NULL WHERE head_user_id = ?').run(id);
      await db.prepare('UPDATE subs SET rep_user_id = NULL WHERE rep_user_id = ?').run(id);
      await db.prepare('UPDATE units SET head_user_id = NULL WHERE head_user_id = ?').run(id);
      await db.prepare('UPDATE users SET role = ?, title = ?, scope_type = NULL, scope_id = NULL WHERE id = ?').run(role, roleDefinition.label, id);
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

router.post('/roles/:role/permissions/:key/grant', async (req, res) => {
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

router.post('/roles/:role/permissions/:key/revoke', async (req, res) => {
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

router.post('/:id/permissions/:key/grant', async (req, res) => {
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

router.post('/:id/permissions/:key/revoke', async (req, res) => {
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
router.patch('/:id/profile', async (req, res) => {
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
router.post('/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const chosen = (newPassword && String(newPassword).trim()) || generateTempPassword();
  if (chosen.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const hash = bcrypt.hashSync(chosen, 10);
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?').run(hash, id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
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
router.post('/:id/mfa/disable', async (req, res) => {
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
const SCOPE_TYPES = ['sub', 'unit', 'individual', 'programme'];
const ROLE_SCOPE_TYPES = { rep: 'sub', unithead: 'unit', programme: 'programme' };

// Change a user's role/scope — e.g. reassigning a Unit Head to a different
// unit, or promoting someone into a new role. ICT admin only (this whole
// file is gated that way). Left deliberately simple: it does NOT touch the
// user's existing granted permissions, since a role change and a
// permission change are different decisions — review the Permissions
// panel afterwards if the new role needs a different permission set.
router.patch('/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role, scopeType, scopeId } = req.body || {};
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
  const roleDefinition = await db.prepare('SELECT key, label FROM role_definitions WHERE key = ?').get(role);
  if (!roleDefinition) return res.status(400).json({ error: 'Invalid role.' });
  const requiredScopeType = ROLE_SCOPE_TYPES[role];
  if (requiredScopeType && scopeType !== requiredScopeType) {
    return res.status(400).json({ error: `${roleDefinition.label} accounts must be assigned to a ${requiredScopeType} scope.` });
  }
  if (!requiredScopeType && role !== 'individual' && (scopeType != null || scopeId != null)) {
    return res.status(400).json({ error: `${roleDefinition.label} accounts use a university-wide scope.` });
  }
  if (scopeType != null && !SCOPE_TYPES.includes(scopeType)) return res.status(400).json({ error: 'Invalid scope type.' });
  if (scopeType && !scopeId) return res.status(400).json({ error: 'A scope selection is required.' });
  if (role === 'individual' && !['programme', 'sub', 'unit', 'individual'].includes(scopeType)) {
    return res.status(400).json({ error: 'Individual accounts must be assigned to a Programme, Sub-programme, Unit / Department / Faculty / Region, or Individual scope.' });
  }
  if (scopeType) {
    const scopeTables = { programme: 'programmes', sub: 'subs', unit: 'units', individual: 'individuals' };
    const scope = await db.prepare(`SELECT id FROM ${scopeTables[scopeType]} WHERE id = ? AND deleted_at IS NULL`).get(scopeId);
    if (!scope) return res.status(400).json({ error: 'The selected organisation scope was not found.' });
  }
  if (role === 'individual' && scopeType === 'individual') {
    const individual = await db.prepare(`
      SELECT i.id, i.user_id, u.id AS unit_id, u.deleted_at AS unit_deleted_at,
        s.id AS sub_id, s.deleted_at AS sub_deleted_at,
        p.id AS programme_id, p.deleted_at AS programme_deleted_at
      FROM individuals i
      JOIN units u ON u.id = i.unit_id
      JOIN subs s ON s.id = u.sub_id
      JOIN programmes p ON p.id = s.programme_id
      WHERE i.id = ? AND i.deleted_at IS NULL
    `).get(scopeId);
    if (!individual || individual.unit_deleted_at || individual.sub_deleted_at || individual.programme_deleted_at) {
      return res.status(400).json({ error: 'An Individual must be assigned to an active Programme, Sub-programme, and Unit / Department / Faculty / Region.' });
    }
  }
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  // A role represents a single occupied appointment at its scope. Global
  // roles have one university-wide appointment; scoped roles have one
  // appointment per selected Programme, Sub-programme, or Unit. Individual
  // is deliberately exempt because multiple Individual accounts are valid.
  if (role !== 'individual') {
    const occupied = scopeType
      ? await db.prepare('SELECT name FROM users WHERE role = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL AND id != ? ORDER BY id LIMIT 1')
        .get(role, scopeType, scopeId, id)
      : await db.prepare('SELECT name FROM users WHERE role = ? AND scope_type IS NULL AND scope_id IS NULL AND deleted_at IS NULL AND id != ? ORDER BY id LIMIT 1')
        .get(role, id);
    if (occupied) {
      return res.status(400).json({ error: `That ${roleDefinition.label} role is already occupied by ${occupied.name}.` });
    }

    const appointment = role === 'programme'
      ? await db.prepare('SELECT u.name FROM programmes p JOIN users u ON u.id = p.head_user_id WHERE p.id = ? AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND p.head_user_id != ?').get(scopeId, id)
      : role === 'rep'
        ? await db.prepare('SELECT u.name FROM subs s JOIN users u ON u.id = s.rep_user_id WHERE s.id = ? AND s.deleted_at IS NULL AND u.deleted_at IS NULL AND s.rep_user_id != ?').get(scopeId, id)
        : role === 'unithead'
          ? await db.prepare('SELECT u.name FROM units n JOIN users u ON u.id = n.head_user_id WHERE n.id = ? AND n.deleted_at IS NULL AND u.deleted_at IS NULL AND n.head_user_id != ?').get(scopeId, id)
          : null;
    if (appointment) {
      return res.status(400).json({ error: `That ${roleDefinition.label} appointment is already occupied by ${appointment.name}.` });
    }
  }

  const change = db.transaction(async () => {
    await db.prepare('UPDATE individuals SET user_id = NULL WHERE user_id = ?').run(id);
    await db.prepare('UPDATE programmes SET head_user_id = NULL WHERE head_user_id = ?').run(id);
    await db.prepare('UPDATE subs SET rep_user_id = NULL WHERE rep_user_id = ?').run(id);
    await db.prepare('UPDATE units SET head_user_id = NULL WHERE head_user_id = ?').run(id);
    await db.prepare('UPDATE users SET role = ?, title = ?, scope_type = ?, scope_id = ? WHERE id = ?')
      .run(role, roleDefinition.label, scopeType || null, scopeId || null, id);
    if (role === 'individual' && scopeType === 'individual') await db.prepare('UPDATE individuals SET user_id = ? WHERE id = ?').run(id, scopeId);
    if (role === 'programme') await db.prepare('UPDATE programmes SET head_user_id = ? WHERE id = ?').run(id, scopeId);
    if (role === 'rep') await db.prepare('UPDATE subs SET rep_user_id = ? WHERE id = ?').run(id, scopeId);
    if (role === 'unithead') await db.prepare('UPDATE units SET head_user_id = ? WHERE id = ?').run(id, scopeId);
    // A tier change changes the account's authority everywhere, not just its
    // label. Replace the previous tier's default grants so old access cannot
    // leak into the new role.
    await db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
    await applyRolePermissions(id, role);
  });
  await change();
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'change_role', 'user', id, `${target.name}: role changed from "${target.role}" to "${role}".`
  );
  res.json({ user: await db.prepare('SELECT id, name, title, email, role, scope_type, scope_id FROM users WHERE id = ?').get(id) });
});

// Sets (or clears) how deep this account may drill into Overview's
// Programme -> Sub-programme -> Unit -> Individual structure — a real
// visibility ceiling on the exploratory browsing view, independent of role
// or any other permission (see db.js's users.overview_limit / lib/scope.js's
// canDrillToKind on the frontend, which is what actually enforces it).
// null clears the restriction entirely ("the overall structure" — no cap).
router.patch('/:id/overview-limit', async (req, res) => {
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
router.patch('/:id/executive-owner', async (req, res) => {
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
router.get('/removed', async (req, res) => {
  const users = await db.prepare(
    'SELECT id, name, title, email, role, scope_type, scope_id, deleted_at FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
  ).all();
  res.json({ users });
});

router.delete('/:id', async (req, res) => {
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
// (Unit/Sub headship, Individual record) intact exactly as they were.
router.post('/:id/restore', async (req, res) => {
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
