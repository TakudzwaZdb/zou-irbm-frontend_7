import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { scopeBreadcrumb } from '../lib/scope.js';
// Users.jsx stays the one canonical source of the role list/labels (see its
// own header comment) even though organisation scope is now managed from
// here — importing rather than keeping a second, driftable copy of
// ROLE_LABEL, as this file used to.
import { ROLE_LABEL, UNIT_KIND_OPTIONS } from './Users.jsx';

// Organisation scope is a property of the PERSON, not the role (see
// routes/users.js's PATCH /:id/role) — a role no longer declares or
// requires one, so there's nothing here to pick when creating a role.
// Every role EXCEPT the built-in Employee role can optionally be given a
// Programme/Sub-programme/Unit scope, freely, per person — "Employee" is
// deliberately not one of these choices since Employee is a role, not a
// scope type; ScopePicker below only offers it when role === 'employee'.
const GENERAL_SCOPE_TYPE_OPTIONS = [
  { key: 'programme', label: 'Programme' },
  { key: 'sub', label: 'Sub-programme' },
  { key: 'unit', label: 'Unit / Department / Faculty / Region' },
];
// Only the built-in Employee role still needs a specific organisation scope
// picked for every person holding it — see PATCH /:id/role. No other role
// declares a required scope any more, so this is the only key the bulk
// "Assign Roles to Users" modal ever needs to exclude (a scoped Employee
// account can only be set up through the single-person "Assign role"
// modal, never bulk).
const BULK_EXCLUDED_ROLE_KEYS = new Set(['employee']);

export default function Permissions() {
  const toast = useToast();
  const confirm = useConfirm();
  const { org } = useApp();

  const [roles, setRoles] = useState(null);
  const [users, setUsers] = useState(null);
  const [catalog, setCatalog] = useState([]);

  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);

  const [q, setQ] = useState('');
  // Its own dedicated, always-visible search bar right on the "Assign Roles
  // to Users" table below — separate from the page-header search above
  // (which now only searches Roles), so filtering the Users table doesn't
  // depend on a search box that's visually anchored to a different table.
  const [userSearch, setUserSearch] = useState('');
  // Both tables on this page start collapsed — a click on the header is
  // required to view either the Roles table or the Users list, same as
  // every other collapsible table across the app.
  const [rolesOpen, setRolesOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  const [assignRole, setAssignRole] = useState('');
  const [assigning, setAssigning] = useState(false);
  // Whether the bulk (multi-user, global-role-only) variant of the "Assign
  // role & scope" modal is open — see openAssignForSelection() below, the
  // ONE button above the table that opens either this or the single-person
  // scopeManageUser modal depending on how many rows are checked.
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  // Per-person role assignment — moved here from Users.jsx (see that
  // file's own header note; it now shows role and scope read-only). This
  // is the ONE place the built-in Employee role can actually be assigned:
  // the bulk "Assign Roles to Users" control below excludes it, since
  // Employee needs its own Programme/Sub/Unit/individual-employee-record
  // scope picked in the same action — see roleDraft/scopeDraft and
  // applyRoleAndScope() below. Every other role's scope is changed
  // separately, independent of role — see changeScopeUser just below.
  const [scopeManageUser, setScopeManageUser] = useState(null);
  // The user whose row was clicked to open the standalone "Change scope"
  // popup (see openChangeScope/applyScopeChange below) — entirely separate
  // from scopeManageUser above: this one only ever changes scope, never
  // role, and works for every user in the table, not just the ones
  // selected via checkbox.
  const [changeScopeUser, setChangeScopeUser] = useState(null);
  const [roleDraft, setRoleDraft] = useState({});
  const [scopeDraft, setScopeDraft] = useState({});
  const [unitKindDraft, setUnitKindDraft] = useState({});
  const [scopeBusyId, setScopeBusyId] = useState(null);

  const [newRoleKey, setNewRoleKey] = useState('');
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [creatingRole, setCreatingRole] = useState(false);
  // Create-role popup: opened from the "+ Create role" button above the
  // roles table, closed automatically the moment a role is actually
  // created (see createRole() below) — same popup-then-auto-close pattern
  // as KPI Management's "Create a KPI" dialog.
  const [showCreateRole, setShowCreateRole] = useState(false);
  // Delete-role busy flag, shown on the "Delete role" button inside the
  // role permissions modal (see deleteRole() below) — DELETE /org/roles/:key
  // already existed and fully worked server-side; this is the frontend UI
  // for it, which didn't exist before.
  const [deletingRole, setDeletingRole] = useState(false);

  async function load() {
    const result = await api('/users');

    setUsers(
      Array.isArray(result.users)
        ? result.users
        : []
    );

    setRoles(
      Array.isArray(result.roles)
        ? result.roles
        : []
    );

    setCatalog(
      Array.isArray(result.catalog)
        ? result.catalog
        : []
    );
  }

  useEffect(() => {
    load().catch((error) =>
      toast(error.message, 'err')
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * =========================================================
   * ROLE HELPERS
   * =========================================================
   */

  function getRoleKey(role) {
    return (
      role?.key ||
      role?.role ||
      role?.name ||
      ''
    );
  }

  function getRoleName(role) {
    const key = getRoleKey(role);

    return (
      ROLE_LABEL[key] ||
      role?.name ||
      role?.label ||
      key ||
      'Unknown Role'
    );
  }

  function getRolePermissions(role) {
    return Array.isArray(role?.permissions)
      ? role.permissions
      : [];
  }

  function getUserRoleName(user) {
    return (
      ROLE_LABEL[user?.role] ||
      user?.role ||
      'No role'
    );
  }

  // Only the built-in Employee role needs a specific organisation scope
  // picked per person (see BULK_EXCLUDED_ROLE_KEYS above) — there's one
  // "Assign role" button above the Users table (see openAssignForSelection):
  // checking exactly one person opens the role modal, which can assign any
  // role, Employee included (with an inline scope picker only for
  // Employee); checking more than one opens the bulk modal instead, which
  // excludes Employee from its role chips — it has no per-user scope field,
  // and Employee always needs one picked per person. Every other role's
  // scope, if any, is changed entirely separately — click that person's row
  // in the table to open "Change scope" (see changeScopeUser below).

  /*
   * =========================================================
   * SEARCH
   * =========================================================
   */

  const filteredRoles = useMemo(() => {
    if (!roles) return null;

    const needle = q.trim().toLowerCase();

    if (!needle) {
      return roles;
    }

    return roles.filter((role) => {
      const key = getRoleKey(role);

      return [
        key,
        role?.name,
        role?.label,
        ROLE_LABEL[key],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [roles, q]);

  const filteredUsers = useMemo(() => {
    if (!users) return null;

    const needle = userSearch.trim().toLowerCase();

    if (!needle) {
      return users;
    }

    return users.filter((user) => {
      const breadcrumb = (scopeBreadcrumb(org, user) || []).join(' ');
      return [
        user?.name,
        user?.email,
        user?.role,
        ROLE_LABEL[user?.role],
        breadcrumb,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [users, userSearch, org]);

  /*
   * =========================================================
   * CREATE ROLE
   *
   * POST /api/org/roles (routes/org.js) writes into the same
   * role_definitions table GET /api/users reads back from — a role
   * created here shows up in the Roles table and the "Assign Roles to
   * Users" select below the moment load() re-runs, with no separate
   * step to make it "known" anywhere else.
   * =========================================================
   */

  async function createRole() {
    const key = newRoleKey.trim().toLowerCase();
    const label = newRoleLabel.trim();

    if (!/^[a-z][a-z0-9_]{1,30}$/.test(key)) {
      toast(
        'Role key must start with a letter and use 2-31 lowercase letters, numbers, or underscores.',
        'err'
      );
      return;
    }

    if (!label) {
      toast(
        'A display label is required.',
        'err'
      );
      return;
    }

    try {
      setCreatingRole(true);

      await api(
        '/org/roles',
        {
          method: 'POST',
          body: { key, label },
        }
      );

      toast(
        `Role "${label}" created — it now appears below and in the assign-role list.`
      );

      setNewRoleKey('');
      setNewRoleLabel('');
      setShowCreateRole(false);

      await load();
    } catch (error) {
      toast(
        error.message,
        'err'
      );
    } finally {
      setCreatingRole(false);
    }
  }

  /*
   * =========================================================
   * DELETE ROLE
   *
   * DELETE /api/org/roles/:key (routes/org.js) already existed and fully
   * worked — it blocks built-in roles and any role still held by an active
   * user — this is just the frontend button/flow to reach it, which didn't
   * exist before.
   * =========================================================
   */

  async function deleteRole(role) {
    const key = getRoleKey(role);
    const name = getRoleName(role);

    if (!(await confirm({
      title: `Delete the "${name}" role?`,
      message: 'This can’t be undone. Reassign any users who still hold it first.',
      confirmLabel: 'Delete role',
      tone: 'danger',
    }))) {
      return;
    }

    try {
      setDeletingRole(true);

      await api(
        `/org/roles/${encodeURIComponent(key)}`,
        { method: 'DELETE' }
      );

      toast(`Role "${name}" deleted.`);

      setSelectedRoleId(null);

      await load();
    } catch (error) {
      toast(
        error.message,
        'err'
      );
    } finally {
      setDeletingRole(false);
    }
  }

  /*
   * =========================================================
   * SELECTED ROLE
   * =========================================================
   */

  // Roles are identified by their string key (e.g. "cpu", "ictadmin") — the
  // API never returns a numeric `role.id` (see utils/permissions.js's
  // listRolesWithPermissions, which selects key/label/built_in/permissions
  // only). Comparing on `role.id` would compare `undefined === undefined`
  // for every role, so the very first row clicked would match ANY later
  // row too — clicking a second role would just close the first one's
  // modal instead of opening the second's. selectedRoleId now holds the
  // role KEY itself, not an id.
  const selectedRole =
    filteredRoles?.find(
      (role) =>
        getRoleKey(role) ===
        selectedRoleId
    ) ||
    roles?.find(
      (role) =>
        getRoleKey(role) ===
        selectedRoleId
    ) ||
    null;

  /*
   * =========================================================
   * OPEN ROLE
   * =========================================================
   */

  function openRole(role) {
    const key = getRoleKey(role);
    setSelectedRoleId((current) =>
      current === key
        ? null
        : key
    );
  }

  /*
   * =========================================================
   * ESCAPE KEY
   * =========================================================
   */

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setSelectedRoleId(null);
        setShowCreateRole(false);
        setScopeManageUser(null);
        setChangeScopeUser(null);
        setBulkAssignOpen(false);
      }
    }

    document.addEventListener(
      'keydown',
      closeOnEscape
    );

    return () => {
      document.removeEventListener(
        'keydown',
        closeOnEscape
      );
    };
  }, []);

  /*
   * =========================================================
   * ROLE PERMISSIONS
   *
   * Permissions belong ONLY to roles.
   * =========================================================
   */

  async function togglePermission(
    role,
    permission
  ) {
    const permissions =
      getRolePermissions(role);

    const enabled =
      permissions.includes(permission.key);

    try {
      const roleKey = getRoleKey(role);

      if (!roleKey) {
        throw new Error(
          'The selected role does not have a valid role key.'
        );
      }

      const result = await api(
        `/users/roles/${encodeURIComponent(
          roleKey
        )}/permissions/${encodeURIComponent(
          permission.key
        )}/${enabled ? 'revoke' : 'grant'}`,
        {
          method: 'POST',
        }
      );

      if (
        result.role?.permissions &&
        result.role.permissions.includes(
          permission.key
        ) !== !enabled
      ) {
        throw new Error(
          `The server did not confirm that ${permission.key} was ${
            enabled
              ? 'revoked'
              : 'granted'
          }.`
        );
      }

      toast(
        `${enabled ? 'Revoked' : 'Granted'} ${
          permission.key
        } for ${getRoleName(role)}.`
      );

      await load();
    } catch (error) {
      toast(
        error.message,
        'err'
      );
    }
  }

  /*
   * =========================================================
   * USER SELECTION
   * =========================================================
   */

  function toggleUser(userId) {
    setSelectedUsers((current) => {
      if (current.includes(userId)) {
        return current.filter(
          (id) => id !== userId
        );
      }

      return [
        ...current,
        userId,
      ];
    });
  }

  function toggleAllUsers() {
    if (
      !filteredUsers ||
      filteredUsers.length === 0
    ) {
      return;
    }

    const visibleIds =
      filteredUsers.map(
        (user) => user.id
      );

    const allSelected =
      visibleIds.every((id) =>
        selectedUsers.includes(id)
      );

    if (allSelected) {
      setSelectedUsers((current) =>
        current.filter(
          (id) =>
            !visibleIds.includes(id)
        )
      );
    } else {
      setSelectedUsers((current) => [
        ...new Set([
          ...current,
          ...visibleIds,
        ]),
      ]);
    }
  }

  function clearSelection() {
    setSelectedUsers([]);
  }

  /*
   * =========================================================
   * BULK ROLE ASSIGNMENT
   * =========================================================
   */

  async function assignSelectedUsers() {
    if (!assignRole) {
      toast(
        'Please select a role.',
        'err'
      );
      return;
    }

    if (selectedUsers.length === 0) {
      toast(
        'Please select at least one user.',
        'err'
      );
      return;
    }

    try {
      setAssigning(true);

      await api(
        '/users/assign-role',
        {
          method: 'POST',
          // api() (lib/api.js) already JSON.stringifies whatever's passed
          // here — a plain object, never a pre-stringified string (that
          // would double-encode it into a JSON string literal the backend
          // can't parse as {userIds, role}).
          body: {
            userIds: selectedUsers,
            role: assignRole,
          },
        }
      );

      const roleName =
        ROLE_LABEL[assignRole] ||
        assignRole;

      toast(
        `${selectedUsers.length} user${
          selectedUsers.length === 1
            ? ''
            : 's'
        } assigned to ${roleName}.`
      );

      setSelectedUsers([]);
      setAssignRole('');
      setBulkAssignOpen(false);

      await load();
    } catch (error) {
      toast(
        error.message,
        'err'
      );
    } finally {
      setAssigning(false);
    }
  }

  /*
   * =========================================================
   * ASSIGN ROLE (per person or in bulk) — role only
   *
   * Role and organisation scope are two independent decisions now (see
   * routes/users.js's PATCH /:id/role header note): this modal changes
   * ONLY the role and sends no scope fields at all, so PATCH /:id/role
   * leaves whatever scope the person already had exactly as it was. The
   * one exception is the built-in Employee role, which still needs a
   * specific scope picked in the SAME action (it can't exist without one),
   * so the role picker below shows an inline scope picker only when
   * Employee is chosen. Every other role's scope is changed separately —
   * click that person's row in the table to open "Change scope" instead.
   * =========================================================
   */

  function openScopeManage(user) {
    setScopeManageUser(user);
    setRoleDraft((draft) => ({ ...draft, [user.id]: user.role }));
    setScopeDraft((draft) => ({ ...draft, [user.id]: { type: user.scope_type || '', id: user.scope_id || '' } }));
    const unit = org.units.find((item) => item.id === Number(user.scope_id));
    setUnitKindDraft((draft) => ({ ...draft, [user.id]: unit?.kind || 'All organisation units' }));
  }

  function closeScopeManage() {
    setScopeManageUser(null);
  }

  // The "Assign role" button above the table (see openAssignForSelection)
  // routes here when exactly one row is checked — needed so the Employee
  // role's inline scope picker (see above) can target a specific person.
  // More than one checked opens the bulk modal instead (see
  // setBulkAssignOpen below), which excludes Employee entirely.
  function openScopeManageForSelection() {
    if (selectedUsers.length !== 1) return;
    const user = (users || []).find((u) => u.id === selectedUsers[0]);
    if (user) openScopeManage(user);
  }

  // The ONE "Assign role" button above the table opens whichever modal fits
  // how many rows are checked: exactly one → the per-person role modal
  // above (Employee's inline scope picker only makes sense for one person
  // at a time); more than one → the bulk modal below, which excludes
  // Employee (BULK_EXCLUDED_ROLE_KEYS) since there's no single sensible
  // scope for a batch of different people.
  function openAssignForSelection() {
    if (selectedUsers.length === 0) return;
    if (selectedUsers.length === 1) {
      openScopeManageForSelection();
    } else {
      setAssignRole('');
      setBulkAssignOpen(true);
    }
  }

  // Only the Employee role needs anything from the scope draft here — every
  // other role change leaves scope untouched (see applyRoleAndScope below),
  // so switching TO Employee seeds the picker from whatever the person
  // already has, if it's a valid Employee scope; switching AWAY from
  // Employee doesn't need to clear anything since a non-Employee role never
  // reads or sends the scope draft at all.
  function updateRoleDraft(user, newRole) {
    setRoleDraft((draft) => ({ ...draft, [user.id]: newRole }));
    if (newRole !== 'employee') return;
    const seedScope = ['programme', 'sub', 'unit', 'employee'].includes(user.scope_type)
      ? { type: user.scope_type, id: user.scope_id }
      : { type: '', id: '' };
    setScopeDraft((draft) => ({ ...draft, [user.id]: seedScope }));
    const unit = seedScope.type === 'unit' ? org.units.find((item) => item.id === Number(seedScope.id)) : null;
    setUnitKindDraft((draft) => ({ ...draft, [user.id]: unit?.kind || 'All organisation units' }));
  }

  async function applyRoleAndScope(user) {
    const role = roleDraft[user.id] || user.role;
    const roleChanged = role !== user.role;
    if (!roleChanged) return;
    const isEmployee = role === 'employee';
    const scope = isEmployee ? (scopeDraft[user.id] || { type: '', id: '' }) : null;
    const roleName = ROLE_LABEL[role] || role;
    const scopeName = isEmployee ? scopeLabel(scope.type, scope.id, org) : '';
    if (!(await confirm({
      title: `Change ${user.name}'s role to ${roleName}?`,
      message: isEmployee
        ? (scopeName ? `Scope: ${scopeName}.` : 'No organisation scope will be set.')
        : 'Their organisation scope will not change.',
      confirmLabel: 'Change role',
    }))) return;
    setScopeBusyId(user.id);
    try {
      const body = isEmployee
        ? { role, scopeType: scope.type || null, scopeId: scope.id ? Number(scope.id) : null }
        : { role };
      await api(`/users/${user.id}/role`, { method: 'PATCH', body });
      toast(`${user.name}'s role changed to ${roleName}.`);
      await load();
      setScopeManageUser(null);
      setSelectedUsers([]);
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setScopeBusyId(null);
    }
  }

  /*
   * =========================================================
   * CHANGE SCOPE (per person) — scope only, independent of role
   *
   * Opened by clicking anywhere on a user's row in the table (not the
   * checkbox — that's for the separate "Assign role" flow above). Works
   * for EVERY user regardless of role: PATCH /:id/role is sent the
   * person's CURRENT role unchanged plus the new scope, so this never
   * touches their role or their individually granted permissions (see
   * that route's own header note on why a scope-only request is safe).
   * =========================================================
   */

  function openChangeScope(user) {
    setChangeScopeUser(user);
    setScopeDraft((draft) => ({ ...draft, [user.id]: { type: user.scope_type || '', id: user.scope_id || '' } }));
    const unit = org.units.find((item) => item.id === Number(user.scope_id));
    setUnitKindDraft((draft) => ({ ...draft, [user.id]: unit?.kind || 'All organisation units' }));
  }

  function closeChangeScope() {
    setChangeScopeUser(null);
  }

  async function applyScopeChange(user) {
    const scope = scopeDraft[user.id] || { type: user.scope_type || '', id: user.scope_id || '' };
    const scopeChanged = String(scope.type || '') !== String(user.scope_type || '') || String(scope.id || '') !== String(user.scope_id || '');
    if (!scopeChanged) { closeChangeScope(); return; }
    const scopeName = scopeLabel(scope.type, scope.id, org);
    if (!(await confirm({
      title: `Move ${user.name}'s organisation scope${scopeName ? ` to ${scopeName}` : ' to no scope'}?`,
      message: `Their role (${getUserRoleName(user)}) will not change.`,
      confirmLabel: 'Change scope',
    }))) return;
    setScopeBusyId(user.id);
    try {
      await api(`/users/${user.id}/role`, { method: 'PATCH', body: { role: user.role, scopeType: scope.type || null, scopeId: scope.id ? Number(scope.id) : null } });
      toast(`${user.name}'s organisation scope updated.`);
      await load();
      setChangeScopeUser(null);
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setScopeBusyId(null);
    }
  }

  /*
   * =========================================================
   * SELECT ALL STATE
   * =========================================================
   */

  const visibleUserIds =
    filteredUsers?.map(
      (user) => user.id
    ) || [];

  const allVisibleUsersSelected =
    visibleUserIds.length > 0 &&
    visibleUserIds.every((id) =>
      selectedUsers.includes(id)
    );

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  return (
    <div>

      {/* =====================================================
          PAGE HEADER
          ===================================================== */}

      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">

        <div>

          <h1 className="text-xl font-bold mb-0.5">
            Permissions &amp; Roles
          </h1>

          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            Permissions are assigned to roles only — users receive access through the role assigned to their
            account. Role and organisation scope are changed separately below: check one or more people and use
            "Assign role" to change role, or click any person's row to change just their scope. See the Users
            page for the plain, view-only account directory.
          </p>

        </div>

        {/* Roles only now — the Users table below has its own dedicated
            search bar right on it (see userSearch), so this one no longer
            needs to double up on both. */}
        <input
          className="field-input w-auto min-w-[220px]"
          placeholder="Search roles…"
          aria-label="Search roles"
          value={q}
          onChange={(event) =>
            setQ(event.target.value)
          }
        />

      </div>

      {/* =====================================================
          ROLES
          ===================================================== */}

      <div className="card overflow-hidden mb-4">

        <button
          type="button"
          className="w-full flex items-center justify-between text-left"
          onClick={() =>
            setRolesOpen(
              (open) => !open
            )
          }
          aria-expanded={rolesOpen}
        >

          <span className="font-display font-bold text-[14px] flex items-center gap-2">
            Roles

            <span className="chip">
              {filteredRoles?.length || 0}
            </span>
          </span>

          <span className="text-accent-600 font-semibold text-[12px]">
            {rolesOpen
              ? 'Hide ▲'
              : 'Click to view ▼'}
          </span>

        </button>

        {rolesOpen && (
          <>

            <p className="text-[12px] text-ink-muted mt-1">
              Click anywhere on a role to manage
              its permissions.
            </p>

            {/* =================================================
                CREATE ROLE — trigger only; the form itself is the
                popup modal rendered near the other modals below.
                ================================================= */}

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowCreateRole(true)}
              >
                + Create role
              </button>
            </div>

            {/* FIXED HEADER + SCROLLABLE TABLE */}
            <div className="mt-2 overflow-auto max-h-[400px] rounded-lg border border-line">

              <table className="w-full text-left text-[12px]">

                <thead className="bg-sunken border-b border-line sticky top-0 z-10">

                  <tr>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Role
                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Users
                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Permissions
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {(filteredRoles || []).map(
                    (role) => {

                      const permissions =
                        getRolePermissions(
                          role
                        );

                      const isSelected =
                        selectedRoleId ===
                        getRoleKey(
                          role
                        );

                      return (
                        <tr
                          key={getRoleKey(
                            role
                          )}
                          onClick={() =>
                            openRole(
                              role
                            )
                          }
                          onKeyDown={(
                            event
                          ) => {
                            if (
                              event.key ===
                                'Enter' ||
                              event.key ===
                                ' '
                            ) {
                              event.preventDefault();

                              openRole(
                                role
                              );
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Manage permissions for ${getRoleName(
                            role
                          )}`}
                          className={`border-b border-line last:border-b-0 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-sunken'
                              : 'hover:bg-sunken'
                          }`}
                        >

                          <td className="px-3 py-2.5">

                            <div className="font-semibold">
                              {getRoleName(
                                role
                              )}
                            </div>

                            <div className="text-ink-muted">
                              {getRoleKey(
                                role
                              )}
                            </div>

                          </td>

                          <td className="px-3 py-2.5 text-ink-secondary">
                            {role.user_count ??
                              role.users_count ??
                              0}
                          </td>

                          <td className="px-3 py-2.5">
                            {permissions.length}{' '}
                            of{' '}
                            {catalog.length}
                          </td>

                        </tr>
                      );
                    }
                  )}

                </tbody>

              </table>

            </div>

          </>
        )}

      </div>

      {/* =====================================================
          CREATE ROLE MODAL

          Same popup-then-auto-close pattern as KPI Management's
          "Create a KPI" dialog: opened by the "+ Create role" button
          above, closed automatically the instant createRole() succeeds
          (see setShowCreateRole(false) inside it) — an error leaves the
          dialog open, with the toast, so the person can fix and retry.
          Escape, the backdrop, and the ✕/Cancel buttons all close it
          without creating anything.
          ===================================================== */}

      {showCreateRole && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-role-dialog-title"
          onMouseDown={() => setShowCreateRole(false)}
        >
          <div
            className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-lg p-4"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 id="create-role-dialog-title" className="font-display font-bold text-[16px]">
                Create a role
              </h2>
              <button
                type="button"
                className="text-ink-muted hover:text-ink"
                onClick={() => setShowCreateRole(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="text-[11.5px] text-ink-muted mb-3 max-w-[60ch]">
              Built-in roles (Executive, Corporate Planning Unit, ICT
              Systems Administrator, and the rest) can't be created here —
              only removed if they're custom (see the roles table below). A
              new role starts with no permissions granted — open it from
              the roles table once it appears to grant some. Organisation
              scope isn't set here at all — it's picked per person, after
              the role exists, by clicking that person's row further down
              this page and using "Change scope".
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                createRole();
              }}
              className="flex flex-col gap-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-role-key"
                    className="block text-[11px] font-semibold mb-1"
                  >
                    Role key
                  </label>
                  <input
                    id="new-role-key"
                    autoFocus
                    className="field-input w-full"
                    placeholder="e.g. auditor"
                    value={newRoleKey}
                    onChange={(event) => setNewRoleKey(event.target.value)}
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-role-label"
                    className="block text-[11px] font-semibold mb-1"
                  >
                    Display label
                  </label>
                  <input
                    id="new-role-label"
                    className="field-input w-full"
                    placeholder="e.g. Auditor"
                    value={newRoleLabel}
                    onChange={(event) => setNewRoleLabel(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={creatingRole || !newRoleKey.trim() || !newRoleLabel.trim()}
                >
                  {creatingRole ? 'Creating...' : 'Create role'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowCreateRole(false)}
                  disabled={creatingRole}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================
          ASSIGN ROLES TO USERS
          ===================================================== */}

      <div className="card overflow-hidden">

        <button
          type="button"
          className="w-full flex items-center justify-between text-left"
          onClick={() =>
            setUsersOpen(
              (open) => !open
            )
          }
          aria-expanded={usersOpen}
        >

          <span className="font-display font-bold text-[14px] flex items-center gap-2">

            Assign Roles to Users

            <span className="chip">
              {selectedUsers.length}{' '}
              selected
            </span>

          </span>

          <span className="text-accent-600 font-semibold text-[12px]">
            {usersOpen
              ? 'Hide ▲'
              : 'Click to view ▼'}
          </span>

        </button>

        {usersOpen && (
          <>

            <p className="text-[12px] text-ink-muted mt-1">
              Role and organisation scope are changed separately now. Check one or more people below and use
              "Assign role" to change their role only — Employee is the one exception, since it needs a scope
              picked in that same step. Click anywhere on a single person's row to open "Change scope" instead,
              which changes their organisation scope without touching their role at all.
            </p>

            {/* =================================================
                ONE ACTION BUTTON — the "assign a role" flow lives behind
                this single button: it reads selectedUsers and opens either
                the single-person modal (scopeManageUser) or the bulk modal
                (bulkAssignOpen) — see openAssignForSelection() above.
                Changing scope is a completely separate action — click a
                row (see the table below) rather than using this button.
                ================================================= */}

            <div className="mt-3 mb-3 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={selectedUsers.length === 0}
                onClick={openAssignForSelection}
              >
                Assign role{selectedUsers.length ? ` (${selectedUsers.length})` : ''}
              </button>

              {selectedUsers.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={clearSelection}
                >
                  Clear Selection
                </button>
              )}
            </div>

            {/* =================================================
                USERS TABLE — its own visible search bar, right on the
                table it filters, separate from the page-header search
                above (which only searches Roles now — see userSearch).
                ================================================= */}

            <div className="mb-2">
              <label htmlFor="assign-role-user-search" className="block text-[11px] font-semibold mb-1">
                Search users
              </label>
              <input
                id="assign-role-user-search"
                type="search"
                className="field-input w-full"
                placeholder="Search by name, email, role, or organisation scope…"
                aria-label="Search users in this table"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
              />
            </div>

            {/* FIXED HEADER + SCROLLABLE TABLE */}
            <div className="overflow-auto max-h-[500px] rounded-lg border border-line">

              <table className="w-full text-left text-[12px]">

                <thead className="bg-sunken border-b border-line sticky top-0 z-10">

                  <tr>

                    <th className="px-3 py-2 w-[45px] whitespace-nowrap">

                      <input
                        type="checkbox"
                        checked={
                          allVisibleUsersSelected
                        }
                        onChange={
                          toggleAllUsers
                        }
                        aria-label="Select all users"
                      />

                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      User
                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Email
                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Current Role
                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Organisation scope
                      <span className="block font-normal normal-case text-[10.5px] text-ink-muted">
                        Click a row to change
                      </span>
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {(filteredUsers || []).map(
                    (user) => {

                      const checked =
                        selectedUsers.includes(
                          user.id
                        );
                      const breadcrumb = scopeBreadcrumb(org, user);

                      return (
                        <tr
                          key={user.id}
                          onClick={() => openChangeScope(user)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openChangeScope(user);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Change organisation scope for ${user.name}`}
                          className={`border-b border-line last:border-b-0 cursor-pointer transition-colors ${
                            checked
                              ? 'bg-sunken'
                              : 'hover:bg-sunken'
                          }`}
                        >

                          <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>

                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleUser(
                                  user.id
                                )
                              }
                              aria-label={`Select ${user.name}`}
                            />

                          </td>

                          <td className="px-3 py-2.5 font-semibold">
                            {user.name}
                          </td>

                          <td className="px-3 py-2.5 text-ink-muted">
                            {user.email}
                          </td>

                          <td className="px-3 py-2.5 text-ink-secondary">
                            {getUserRoleName(
                              user
                            )}
                          </td>

                          <td className="px-3 py-2.5 text-ink-secondary">
                            {breadcrumb?.join(' › ') || 'No scope'}
                          </td>

                        </tr>
                      );
                    }
                  )}

                </tbody>

              </table>

            </div>

            {filteredUsers &&
              filteredUsers.length ===
                0 && (
                <p className="text-[12px] text-ink-muted py-4 text-center">
                  No users found.
                </p>
              )}

          </>
        )}

      </div>

      {/* =====================================================
          ROLE PERMISSIONS MODAL
          ===================================================== */}

      {selectedRole && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="permissions-dialog-title"
          onMouseDown={() =>
            setSelectedRoleId(null)
          }
        >

          <div
            className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-4"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >

            <div className="flex items-start justify-between gap-3 mb-3">

              <div>

                <h2
                  id="permissions-dialog-title"
                  className="font-display font-bold text-[16px]"
                >
                  Permissions for{' '}
                  {getRoleName(
                    selectedRole
                  )}
                </h2>

                <p className="text-[12px] text-ink-muted">
                  Role:{' '}
                  {getRoleKey(
                    selectedRole
                  )}
                </p>

              </div>

              <div className="flex items-center gap-2 shrink-0">

                {!selectedRole.built_in && (
                  <button
                    type="button"
                    className="btn btn-sm text-critical"
                    disabled={deletingRole}
                    onClick={() => deleteRole(selectedRole)}
                  >
                    {deletingRole ? 'Deleting…' : 'Delete role'}
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setSelectedRoleId(
                      null
                    )
                  }
                >
                  Close
                </button>

              </div>

            </div>

            {selectedRole.built_in && (
              <p className="text-[11px] text-ink-muted mb-3">
                Built-in roles can't be deleted — authorization and navigation depend on their keys.
              </p>
            )}

            <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-line">

              <span className="text-[12px] text-ink-muted">
                Permissions belong to this role.
                Users assigned to this role inherit
                them automatically.
              </span>

              <span className="chip">
                {
                  getRolePermissions(
                    selectedRole
                  ).length
                }{' '}
                granted
              </span>

            </div>

            {/* FIXED HEADER + SCROLLABLE PERMISSIONS TABLE */}
            <div className="overflow-auto max-h-[500px] rounded-lg border border-line">

              <table className="w-full text-left text-[12px]">

                <thead className="bg-sunken border-b border-line sticky top-0 z-10">

                  <tr>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Permission
                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Group
                    </th>

                    <th className="px-3 py-2 font-bold whitespace-nowrap">
                      Status
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {catalog.map(
                    (permission) => {

                      const enabled =
                        getRolePermissions(
                          selectedRole
                        ).includes(
                          permission.key
                        );

                      return (
                        <tr
                          key={
                            permission.key
                          }
                          className="border-b border-line last:border-b-0"
                        >

                          <td className="px-3 py-2 text-ink-secondary">
                            {permission.label}
                          </td>

                          <td className="px-3 py-2 text-ink-muted">
                            {permission.group}
                          </td>

                          <td className="px-3 py-2">

                            <button
                              type="button"
                              onClick={() =>
                                togglePermission(
                                  selectedRole,
                                  permission
                                )
                              }
                              className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                                enabled
                                  ? 'bg-good-soft text-good border-transparent'
                                  : 'bg-sunken text-ink-muted border-line'
                              }`}
                            >
                              {enabled
                                ? 'Granted'
                                : 'Not granted'}
                            </button>

                          </td>

                        </tr>
                      );
                    }
                  )}

                </tbody>

              </table>

            </div>

          </div>

        </div>
      )}

      {/* =====================================================
          ASSIGN ROLE MODAL — role only, independent of scope

          This is the ONE place any role, including the built-in Employee
          role, is actually assigned to a person — the bulk "Assign Roles
          to Users" control above deliberately excludes Employee (see
          BULK_EXCLUDED_ROLE_KEYS). It changes ONLY the role: no scope
          picker at all, UNLESS Employee is the role picked, since that one
          role can't exist without a scope — see updateRoleDraft/
          applyRoleAndScope above. Every other role's scope is left exactly
          as it was; click that person's row in the table instead to open
          "Change scope" separately. Escape, the backdrop, and Close all
          dismiss it without saving.
          ===================================================== */}

      {scopeManageUser && (() => {
        const draftRole = roleDraft[scopeManageUser.id] || scopeManageUser.role;
        const roleChanged = draftRole !== scopeManageUser.role;
        const isEmployee = draftRole === 'employee';
        const currentScope = scopeDraft[scopeManageUser.id] || { type: scopeManageUser.scope_type || '', id: scopeManageUser.scope_id || '' };
        // Only the Employee role still requires a scope, picked in this
        // same action since it can't exist without one — every other role
        // is applied with no scope field at all (see applyRoleAndScope).
        const missingRequiredScope = isEmployee && !currentScope.id;
        return (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scope-manage-dialog-title"
          onMouseDown={closeScopeManage}
        >
          <div
            className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-lg p-4"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 id="scope-manage-dialog-title" className="font-display font-bold text-[16px]">
                  Assign role for {scopeManageUser.name}
                </h2>
                <p className="text-[12px] text-ink-muted">
                  Currently {getUserRoleName(scopeManageUser)} · {scopeManageUser.email}
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={closeScopeManage}>Close</button>
            </div>

            <div className="space-y-1 mb-3">
              <label className="field-label">Role</label>
              {/* Clickable, not a dropdown — every role including Employee
                  (this modal only ever targets one person, so Employee's
                  own scope requirement is always fine here; the bulk modal
                  below is the one that filters it out). */}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a role">
                {(roles || []).map((role) => {
                  const key = getRoleKey(role);
                  const isSelected = key === draftRole;
                  return (
                    <button
                      key={role.id || key}
                      type="button"
                      disabled={scopeBusyId === scopeManageUser.id}
                      aria-pressed={isSelected}
                      onClick={() => updateRoleDraft(scopeManageUser, key)}
                      className={`rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                        isSelected
                          ? 'bg-accent-50 text-accent-600 border-accent-600'
                          : 'bg-sunken text-ink-secondary border-line hover:bg-line/60'
                      }`}
                    >
                      {getRoleName(role)}
                    </button>
                  );
                })}
              </div>
            </div>

            {isEmployee ? (
              <>
                <ScopePicker
                  user={scopeManageUser}
                  role={draftRole}
                  org={org}
                  scopeDraft={scopeDraft}
                  setScopeDraft={setScopeDraft}
                  unitKindDraft={unitKindDraft}
                  setUnitKindDraft={setUnitKindDraft}
                  disabled={scopeBusyId === scopeManageUser.id}
                />
                {missingRequiredScope && (
                  <p className="text-[11.5px] text-critical mt-2">
                    Employee needs an organisation scope — pick one above before applying.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[12px] text-ink-muted">
                This person's organisation scope won't change — click their row in the table to change it separately.
              </p>
            )}

            <div className="flex justify-end mt-3">
              <button
                className="btn btn-sm btn-primary"
                disabled={!roleChanged || missingRequiredScope || scopeBusyId === scopeManageUser.id}
                onClick={() => applyRoleAndScope(scopeManageUser)}
              >
                {scopeBusyId === scopeManageUser.id ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* =====================================================
          CHANGE SCOPE MODAL — scope only, independent of role

          Opened by clicking a user's row in the table below (see
          openChangeScope). Works for every user in the system regardless
          of role — the only role-specific behavior is which scope types
          ScopePicker offers (Employee is offered only when this person's
          CURRENT role is 'employee'; everyone else gets Programme/Sub-
          programme/Unit or "No scope"). Escape, the backdrop, and Close
          all dismiss it without saving.
          ===================================================== */}

      {changeScopeUser && (() => {
        const currentScope = scopeDraft[changeScopeUser.id] || { type: changeScopeUser.scope_type || '', id: changeScopeUser.scope_id || '' };
        const scopeChanged = String(currentScope.type || '') !== String(changeScopeUser.scope_type || '')
          || String(currentScope.id || '') !== String(changeScopeUser.scope_id || '');
        return (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-scope-dialog-title"
          onMouseDown={closeChangeScope}
        >
          <div
            className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-lg p-4"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 id="change-scope-dialog-title" className="font-display font-bold text-[16px]">
                  Change scope for {changeScopeUser.name}
                </h2>
                <p className="text-[12px] text-ink-muted">
                  {getUserRoleName(changeScopeUser)} · {changeScopeUser.email} — role isn't changed here.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={closeChangeScope}>Close</button>
            </div>

            <ScopePicker
              user={changeScopeUser}
              role={changeScopeUser.role}
              org={org}
              scopeDraft={scopeDraft}
              setScopeDraft={setScopeDraft}
              unitKindDraft={unitKindDraft}
              setUnitKindDraft={setUnitKindDraft}
              disabled={scopeBusyId === changeScopeUser.id}
            />

            {changeScopeUser.role === 'employee' && !currentScope.id && (
              <p className="text-[11.5px] text-critical mt-2">
                Employee accounts must keep an organisation scope — pick one above before applying.
              </p>
            )}

            <div className="flex justify-end mt-3">
              <button
                className="btn btn-sm btn-primary"
                disabled={!scopeChanged || (changeScopeUser.role === 'employee' && !currentScope.id) || scopeBusyId === changeScopeUser.id}
                onClick={() => applyScopeChange(changeScopeUser)}
              >
                {scopeBusyId === changeScopeUser.id ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* =====================================================
          BULK ASSIGN MODAL

          The other half of the "Assign role" button above the table —
          opens instead of the single-person modal above when more than one
          row is checked. Every role except the built-in Employee role (the
          chips below filter out BULK_EXCLUDED_ROLE_KEYS): Employee needs
          its own Programme/Sub/Unit/individual-employee-record scope
          picked per person, which doesn't make sense as one pick for a
          whole batch — check just one person for that instead. This bulk
          form has no scope field at all and never touches scope — each
          selected person keeps whatever organisation scope they already
          had (see routes/users.js's POST /assign-role); change scope by
          clicking a person's row individually, entirely separately.
          Reuses the existing assignSelectedUsers()/POST /users/assign-role
          bulk endpoint; only the UI moved from an always-visible inline
          panel into this popup.
          ===================================================== */}

      {bulkAssignOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-assign-dialog-title"
          onMouseDown={() => setBulkAssignOpen(false)}
        >
          <div
            className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-lg p-4"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 id="bulk-assign-dialog-title" className="font-display font-bold text-[16px]">
                  Assign role to {selectedUsers.length} people
                </h2>
                <p className="text-[12px] text-ink-muted">
                  Changes role only — everyone keeps their current organisation scope. Employee isn't offered here
                  at all — check just one person and click their row afterwards to change scope.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setBulkAssignOpen(false)}>Close</button>
            </div>

            <div className="space-y-1 mb-3">
              <label className="field-label">Role</label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a role">
                {(roles || [])
                  .filter((role) => !BULK_EXCLUDED_ROLE_KEYS.has(getRoleKey(role)))
                  .map((role) => {
                    const key = getRoleKey(role);
                    const isSelected = key === assignRole;
                    return (
                      <button
                        key={role.id || key}
                        type="button"
                        disabled={assigning}
                        aria-pressed={isSelected}
                        onClick={() => setAssignRole(key)}
                        className={`rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                          isSelected
                            ? 'bg-accent-50 text-accent-600 border-accent-600'
                            : 'bg-sunken text-ink-secondary border-line hover:bg-line/60'
                        }`}
                      >
                        {getRoleName(role)}
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end mt-3">
              <button
                className="btn btn-sm btn-primary"
                disabled={assigning || !assignRole}
                onClick={assignSelectedUsers}
              >
                {assigning ? 'Assigning…' : `Assign to ${selectedUsers.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Organisation scope is now a property of the PERSON, entirely free of the
// DRAFT role being assigned (see the role picker above this in the modal),
// with exactly one exception: the built-in Employee role always needs one
// of Programme/Sub-programme/Unit/an individual employee record — every
// other role, built-in or custom, gets the same three-way Programme/Sub-
// programme/Unit choice (or "No scope"), entirely optional. "Employee" is
// only ever offered as a scope choice when role === 'employee', never for
// any other role — Employee is a role, not a scope type. Ported from
// Users.jsx — see that file's own header note on why scope management
// moved here.
function ScopePicker({ user, role, org, scopeDraft, setScopeDraft, unitKindDraft, setUnitKindDraft, disabled = false }) {
  const isEmployee = role === 'employee';
  const current = scopeDraft[user.id] || { type: user.scope_type || '', id: user.scope_id || '' };
  const effectiveType = current.type;
  const selectedUnit = org.units.find((unit) => unit.id === Number(current.id));
  const selectedKind = unitKindDraft[user.id] || selectedUnit?.kind || 'All organisation units';
  const options = effectiveType === 'programme' ? org.programmes
    : effectiveType === 'sub' ? org.subs
      : effectiveType === 'unit' ? org.units.filter((unit) => selectedKind === 'All organisation units' || unit.kind === selectedKind)
        : effectiveType === 'employee' ? org.employees
          : [];
  function update(key, value) {
    setScopeDraft((draft) => ({ ...draft, [user.id]: { ...current, [key]: value } }));
  }
  const scopeTypeId = `scope-type-${user.id}`;
  return <div className="space-y-1">
    <label htmlFor={scopeTypeId} className="field-label">Organisation scope</label>
    <div className="flex gap-1.5 flex-wrap items-center">
      <select id={scopeTypeId} className="field-input py-1.5" value={current.type} disabled={disabled} onChange={(e) => { setScopeDraft((draft) => ({ ...draft, [user.id]: { type: e.target.value, id: '' } })); }}>
        <option value="">No scope</option>
        {GENERAL_SCOPE_TYPE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        {isEmployee && <option value="employee">Employee</option>}
      </select>
      {effectiveType === 'unit' && <select
        className="field-input py-1.5"
        value={selectedKind}
        disabled={disabled}
        onChange={(e) => {
          setUnitKindDraft((draft) => ({ ...draft, [user.id]: e.target.value }));
          update('id', '');
        }}
        aria-label={`Organisation unit kind for ${user.name}`}
      >
        {UNIT_KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </select>}
      {effectiveType && <select className="field-input py-1.5" value={current.id} disabled={disabled} onChange={(e) => update('id', e.target.value)}>
        <option value="">Select scope</option>
        {options.map((item) => <option key={item.id} value={item.id}>{effectiveType === 'employee' ? employeeScopeLabel(item, org) : item.kind ? `${item.kind} — ${item.name}` : item.name}</option>)}
      </select>}
    </div>
  </div>;
}

function employeeScopeLabel(employee, org) {
  const unit = org.units.find((item) => item.id === employee.unit_id);
  const sub = unit && org.subs.find((item) => item.id === unit.sub_id);
  const programme = sub && org.programmes.find((item) => item.id === sub.programme_id);
  const unitLabel = unit ? `${unit.kind || 'Unit'} — ${unit.name}` : 'Unit not found';
  return `${employee.name} · ${programme?.name || 'Programme not found'} / ${sub?.name || 'Sub-programme not found'} / ${unitLabel}`;
}

function scopeLabel(type, id, org) {
  if (!type || !id) return '';
  const items = type === 'programme' ? org.programmes : type === 'sub' ? org.subs : type === 'unit' ? org.units : org.employees;
  const item = items.find((entry) => entry.id === Number(id));
  return item ? `${type} "${item.name}"` : '';
}