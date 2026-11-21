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
import PaginatedRows from '../components/PaginatedRows.jsx';

// Organisation scope is a property of the PERSON, not the role (see
// routes/users.js's role and scope endpoints) — all roles may optionally
// be given a Programme/Sub-programme/Unit or individual Employee scope.
const GENERAL_SCOPE_TYPE_OPTIONS = [
  { key: 'programme', label: 'Programme' },
  { key: 'sub', label: 'Sub-programme' },
  { key: 'unit', label: 'Unit / Department / Faculty / Region' },
  { key: 'employee', label: 'Employee' },
];
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
  const [userSearch, setUserSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionTableOpen, setPermissionTableOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  const [assignRole, setAssignRole] = useState('');
  const [assigning, setAssigning] = useState(false);
  // Whether the bulk role-only modal is open — see openAssignForSelection()
  // below, which chooses this or the single-person role modal.
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  // Per-person role assignment is independent of the separate scope editor
  // below.
  const [roleManageUser, setRoleManageUser] = useState(null);
  // The user whose row was clicked to open the standalone "Change scope"
  // popup (see openChangeScope/applyScopeChange below) — entirely separate
  // from roleManageUser above: this one only ever changes scope, never
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

  // Single-person and bulk role assignment change only role. Scope is
  // managed independently from the user's row.

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

  const filteredPermissions = useMemo(() => {
    const needle = permissionSearch.trim().toLowerCase();
    if (!needle) return catalog;

    return catalog.filter((permission) =>
      [permission?.label, permission?.key, permission?.group]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [catalog, permissionSearch]);

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
    if (selectedRoleId === key) {
      setSelectedRoleId(null);
      return;
    }
    setPermissionSearch('');
    setPermissionTableOpen(false);
    setSelectedRoleId(key);
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
        setRoleManageUser(null);
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
   * ASSIGN ROLE (per person or in bulk)
   *
   * Role assignment changes the role only. Scope is edited separately.
   * =========================================================
   */

  function openRoleManage(user) {
    setRoleManageUser(user);
    setRoleDraft((draft) => ({ ...draft, [user.id]: user.role }));
  }

  function closeRoleManage() {
    setRoleManageUser(null);
  }

  // The "Assign role" button above the table (see openAssignForSelection)
  // routes here when exactly one row is checked.
  // More than one checked opens the bulk modal instead (see
  // setBulkAssignOpen below); both role flows are independent of scope.
  function openRoleManageForSelection() {
    if (selectedUsers.length !== 1) return;
    const user = (users || []).find((u) => u.id === selectedUsers[0]);
    if (user) openRoleManage(user);
  }

  // The ONE "Assign role" button above the table opens the per-person role
  // modal for one selection or the bulk role-only modal for multiple users.
  function openAssignForSelection() {
    if (selectedUsers.length === 0) return;
    if (selectedUsers.length === 1) {
      openRoleManageForSelection();
    } else {
      setAssignRole('');
      setBulkAssignOpen(true);
    }
  }

  // Role drafts are independent of the separately edited scope.
  function updateRoleDraft(userId, newRole) {
    setRoleDraft((draft) => ({ ...draft, [userId]: newRole }));
  }

  async function applyRole(user) {
    const role = roleDraft[user.id] || user.role;
    const roleChanged = role !== user.role;
    if (!roleChanged) return;
    const roleName = ROLE_LABEL[role] || role;
    if (!(await confirm({
      title: `Change ${user.name}'s role to ${roleName}?`,
      message: `Their organisation scope will remain unchanged.`,
      confirmLabel: 'Change role',
    }))) return;
    setScopeBusyId(user.id);
    try {
      await api(`/users/${user.id}/role`, { method: 'PATCH', body: { role } });
      toast(`${user.name}'s role changed to ${roleName}.`);
      await load();
      setRoleManageUser(null);
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
   * for EVERY user regardless of role. It calls PATCH /:id/scope, which
   * accepts only the new scope and leaves role and permissions untouched.
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
      await api(`/users/${user.id}/scope`, { method: 'PATCH', body: { scopeType: scope.type || null, scopeId: scope.id ? Number(scope.id) : null } });
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
    <div className="space-y-5 pb-2">

      {/* =====================================================
          PAGE HEADER
          ===================================================== */}

      <header className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="border-l-4 border-accent-500 p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-accent-700">
                Administration · Access control
              </p>
              <h1 className="font-display text-[25px] font-extrabold leading-tight sm:text-[30px]">
                Roles &amp; permissions
              </h1>
              <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-secondary">
                Manage role permissions and account assignments.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryTile label="Role catalogue" value={roles?.length ?? '—'} />
            <SummaryTile label="Accounts" value={users?.length ?? '—'} />
            <SummaryTile label="Custom roles" value={roles ? roles.filter((role) => !role.built_in).length : '—'} />
            <SummaryTile label="Available permissions" value={catalog.length} />
          </div>
        </div>
      </header>

      {/* =====================================================
          ROLES
          ===================================================== */}

      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" aria-labelledby="role-catalogue-heading">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <button
            type="button"
            className="group flex min-w-0 items-center gap-3 text-left"
            onClick={() => setRolesOpen((open) => !open)}
            aria-expanded={rolesOpen}
            aria-controls="role-catalogue-content"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3 19 6v5c0 4.5-2.9 7.6-7 10-4.1-2.4-7-5.5-7-10V6l7-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <span className="min-w-0">
              <span id="role-catalogue-heading" className="block font-display text-[16px] font-extrabold">Role catalogue</span>
              <span className="mt-0.5 block text-[11px] text-ink-muted">Review assigned users and the permissions each role grants.</span>
            </span>
            <span className="chip ml-1">{filteredRoles?.length || 0}</span>
          </button>
          <div className="flex items-center gap-2 sm:shrink-0">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateRole(true)}>
              <span aria-hidden="true">+</span> Create role
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRolesOpen((open) => !open)}
              aria-expanded={rolesOpen}
              aria-controls="role-catalogue-content"
            >
              {rolesOpen ? 'Collapse roles' : 'Browse roles'}
            </button>
          </div>
        </div>

        {rolesOpen && (
          <div id="role-catalogue-content" className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">

            {/* FIXED HEADER + SCROLLABLE TABLE */}
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line bg-sunken/70 p-3">
                <label htmlFor="role-search" className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-muted">
                  Find a role
                </label>
                <input
                  id="role-search"
                  type="search"
                  className="field-input w-full bg-surface sm:max-w-md"
                  placeholder="Search roles…"
                  aria-label="Search roles in this table"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                />
              </div>

              <div className="max-h-[440px] overflow-auto">
                <table className="w-full min-w-[540px] text-left text-[12.5px]">

                <thead className="sticky top-0 z-10 border-b border-line-strong bg-sunken text-[10px] uppercase tracking-[0.1em] text-ink-muted">

                  <tr>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Role
                    </th>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Users
                    </th>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Permissions
                    </th>

                  </tr>

                </thead>

                <tbody>

                  <PaginatedRows items={filteredRoles || []} colSpan={3} emptyMessage="No roles match your filters." renderRow={(role) => {

                      const permissions =
                        getRolePermissions(
                          role
                        );
                      const permissionCoverage = catalog.length
                        ? Math.round((permissions.length / catalog.length) * 100)
                        : 0;

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
                          className={`border-b border-line border-l-2 last:border-b-0 cursor-pointer transition-colors focus:outline-none focus-visible:bg-accent-50 ${
                            isSelected
                              ? 'border-l-accent-500 bg-accent-50'
                              : 'border-l-transparent hover:bg-sunken/70'
                          }`}
                        >

                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken text-[11px] font-extrabold uppercase text-ink-secondary" aria-hidden="true">
                                {getRoleName(role).slice(0, 1)}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-bold text-ink">{getRoleName(role)}</span>
                                <span className="mt-0.5 block text-[10.5px] text-ink-muted">{getRoleKey(role)}{role.built_in ? ' · Built-in' : ' · Custom'}</span>
                              </span>
                            </div>

                          </td>

                          <td className="px-4 py-3 text-ink-secondary">
                            <span className="inline-flex min-w-8 justify-center rounded-lg bg-sunken px-2.5 py-1 font-bold tabular-nums">
                              {role.user_count ?? role.users_count ?? 0}
                            </span>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex min-w-[150px] items-center gap-3">
                              <div className="min-w-[74px]">
                                <span className="font-bold tabular-nums text-ink">{permissions.length}</span>
                                <span className="text-ink-muted"> / {catalog.length}</span>
                                <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-ink-muted">permissions</span>
                              </div>
                              <div role="img" className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-sunken" aria-label={`${permissionCoverage}% of available permissions granted`}>
                                <div className="h-full rounded-full bg-accent-500 transition-[width]" style={{ width: `${permissionCoverage}%` }} />
                              </div>
                            </div>
                          </td>

                        </tr>
                      );
                  }} />

                </tbody>

                </table>
              </div>

            </div>

          </div>
        )}

      </section>

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
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl"
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
              the roles table once it appears to grant some.
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

      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" aria-labelledby="accounts-heading">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 19v-1.3A4.7 4.7 0 0 1 8.2 13h1.6a4.7 4.7 0 0 1 4.7 4.7V19H3.5Z" />
                <path d="M16 5.3a3 3 0 0 1 0 5.8M17 13.2a4.6 4.6 0 0 1 3.5 4.5V19h-3" />
              </svg>
            </span>
            <span className="min-w-0">
              <span id="accounts-heading" className="block font-display text-[16px] font-extrabold">Assign roles to users</span>
              <span className="mt-0.5 block text-[11px] text-ink-muted">Select accounts to assign a role.</span>
            </span>
            <span className="chip ml-1">{users?.length ?? '—'} accounts</span>
          </div>
          <div className="flex items-center gap-2 sm:shrink-0">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setUsersOpen((open) => !open)}
              aria-expanded={usersOpen}
              aria-controls="user-assignment-content"
            >
              {usersOpen ? 'Collapse accounts' : 'Browse accounts'}
            </button>
          </div>
        </div>

        {usersOpen && (
          <div id="user-assignment-content" className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
            {/* =================================================
                ONE ACTION BUTTON — the "assign a role" flow lives behind
                this single button: it reads selectedUsers and opens either
                the single-person role modal or the bulk modal
                (bulkAssignOpen) — see openAssignForSelection() above.
                Single-person and bulk role assignments preserve each
                person's current scope.
                ================================================= */}

            {/* FIXED HEADER + SCROLLABLE TABLE */}
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex flex-col gap-2 border-b border-line bg-sunken/70 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 sm:max-w-md">
                  <label htmlFor="assign-role-user-search" className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-muted">
                    Find an account
                  </label>
                  <input
                    id="assign-role-user-search"
                    type="search"
                    className="field-input w-full bg-surface"
                    placeholder="Name, email, role, or scope…"
                    aria-label="Search users in this table"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                  />
                </div>
                <div className="flex shrink-0 flex-nowrap items-center gap-2 sm:ml-auto">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm h-9 min-w-[138px] justify-center gap-2 px-3 whitespace-nowrap shadow-sm"
                    disabled={selectedUsers.length === 0}
                    onClick={openAssignForSelection}
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <circle cx="9" cy="8" r="3" />
                      <path d="M3.5 19v-1.3A4.7 4.7 0 0 1 8.2 13h1.6a4.7 4.7 0 0 1 4.7 4.7V19H3.5Z" />
                      <path d="M19 8v6M22 11h-6" />
                    </svg>
                    <span>Assign role{selectedUsers.length ? ` (${selectedUsers.length})` : ''}</span>
                  </button>
                  {selectedUsers.length > 0 && (
                    <button type="button" className="btn btn-sm h-9 px-3 whitespace-nowrap" onClick={clearSelection}>
                      Clear selection
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[620px] text-left text-[12.5px]">

                <thead className="sticky top-0 z-10 border-b border-line-strong bg-sunken text-[10px] uppercase tracking-[0.1em] text-ink-muted">

                  <tr>

                    <th className="w-[52px] px-4 py-3 whitespace-nowrap">

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

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Account
                    </th>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Current Role
                    </th>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Organisation scope
                    </th>

                  </tr>

                </thead>

                <tbody>

                  <PaginatedRows items={filteredUsers || []} colSpan={4} emptyMessage="No users found." renderRow={(user) => {

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
                          className={`border-b border-line last:border-b-0 cursor-pointer transition-colors focus:outline-none focus-visible:bg-accent-50 ${
                            checked
                              ? 'bg-accent-50'
                              : 'hover:bg-sunken/70'
                          }`}
                        >

                          <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>

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

                          <td className="px-4 py-3">
                            <span className="flex items-center gap-3">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-[11px] font-extrabold uppercase text-accent-700" aria-hidden="true">
                                {user.name?.trim().charAt(0) || '?'}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-bold text-ink">{user.name}</span>
                                <span className="mt-0.5 block truncate text-[10.5px] font-normal text-ink-muted">{user.email}</span>
                              </span>
                            </span>
                          </td>

                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-lg border border-line bg-sunken px-2.5 py-1 text-[11px] font-bold text-ink-secondary">
                              {getUserRoleName(user)}
                            </span>
                          </td>

                          <td className="max-w-[320px] whitespace-normal break-words px-4 py-3 text-[11.5px] leading-relaxed text-ink-secondary">
                            <span className="flex items-center justify-between gap-3">
                              <span className="min-w-0">{breadcrumb?.join(' › ') || 'No scope'}</span>
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-100 bg-accent-50 px-2 py-1 text-[10px] font-bold text-accent-700">
                                Change scope
                                <span aria-hidden="true">→</span>
                              </span>
                            </span>
                          </td>

                        </tr>
                      );
                  }} />

                </tbody>

                </table>
              </div>

            </div>

            {filteredUsers &&
              filteredUsers.length ===
                0 && (
                <p className="text-[12px] text-ink-muted py-4 text-center">
                  No users found.
                </p>
              )}

          </div>
        )}

      </section>

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
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >

            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-lg font-extrabold uppercase text-accent-700" aria-hidden="true">
                  {getRoleName(selectedRole).slice(0, 1)}
                </span>
                <div>
                  <p className="mb-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-accent-700">Role permissions</p>
                  <h2 id="permissions-dialog-title" className="font-display text-[18px] font-extrabold leading-tight">
                    {getRoleName(selectedRole)}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md border border-line bg-sunken px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-secondary">
                      {getRoleKey(selectedRole)}
                    </span>
                    <span className="rounded-md bg-sunken px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                      {selectedRole.built_in ? 'Built-in role' : 'Custom role'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">

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

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sunken/70 px-4 py-3">
              <div>
                <p className="text-[12px] font-bold text-ink">Role-based access</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                  Assigned users inherit these permissions automatically.
                  {selectedRole.built_in ? ' Built-in role keys are protected.' : ''}
                </p>
              </div>
              <span className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-bold tabular-nums text-ink-secondary">
                {getRolePermissions(selectedRole).length} <span className="font-medium text-ink-muted">of {catalog.length} granted</span>
              </span>
            </div>

            {/* FIXED HEADER + SCROLLABLE PERMISSIONS TABLE */}
            <div id="role-permissions-table" className="overflow-hidden rounded-xl border border-line">
              <div className="flex flex-col gap-2 border-b border-line bg-sunken/70 p-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="permission-search" className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-muted">
                    Find a permission
                  </label>
                  <input
                    id="permission-search"
                    type="search"
                    className="field-input w-full bg-surface"
                    placeholder="Search permissions…"
                    aria-label="Search permissions in this table"
                    value={permissionSearch}
                    onChange={(event) => setPermissionSearch(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-sm shrink-0"
                  onClick={() => setPermissionTableOpen((open) => !open)}
                  aria-expanded={permissionTableOpen}
                  aria-controls="role-permissions-table-content"
                >
                  {permissionTableOpen ? 'Collapse permissions' : 'Show permissions'}
                </button>
              </div>

              {permissionTableOpen && (
                <div id="role-permissions-table-content" className="max-h-[500px] overflow-auto">
                  <table className="w-full min-w-[560px] text-left text-[12px]">

                <thead className="sticky top-0 z-10 border-b border-line-strong bg-sunken text-[10px] uppercase tracking-[0.1em] text-ink-muted">

                  <tr>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Permission
                    </th>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Group
                    </th>

                    <th className="px-4 py-3 font-extrabold whitespace-nowrap">
                      Status
                    </th>

                  </tr>

                </thead>

                <tbody>

                  <PaginatedRows
                    items={filteredPermissions}
                    colSpan={3}
                    emptyMessage={permissionSearch.trim() ? 'No permissions match your search.' : 'No permissions are available.'}
                    renderRow={(permission) => {

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
                          className="border-b border-line last:border-b-0 transition-colors hover:bg-sunken/70"
                        >

                          <td className="px-4 py-3 text-ink-secondary">
                            <span className="font-semibold">{permission.label}</span>
                            <span className="mt-0.5 block font-mono text-[9.5px] text-ink-muted">{permission.key}</span>
                          </td>

                          <td className="px-4 py-3 text-ink-muted">
                            <span className="rounded-md bg-sunken px-2 py-1 text-[10px] font-semibold">{permission.group}</span>
                          </td>

                          <td className="px-4 py-3">

                            <button
                              type="button"
                              role="switch"
                              aria-checked={enabled}
                              aria-label={`${enabled ? 'Revoke' : 'Grant'} ${permission.label} permission`}
                              onClick={() =>
                                togglePermission(
                                  selectedRole,
                                  permission
                                )
                              }
                              className={`inline-flex min-w-[104px] items-center justify-between gap-2 rounded-full border px-2 py-1 text-[10px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${
                                enabled
                                  ? 'border-good/30 bg-good-soft text-good'
                                  : 'border-line bg-sunken text-ink-muted'
                              }`}
                            >
                              <span>{enabled ? 'Granted' : 'Not granted'}</span>
                              <span className={`relative h-4 w-7 rounded-full transition-colors ${enabled ? 'bg-good' : 'bg-line-strong'}`} aria-hidden="true">
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                              </span>
                            </button>

                          </td>

                        </tr>
                      );
                    }}
                  />

                  </tbody>

                  </table>
                </div>
              )}

            </div>

          </div>

        </div>
      )}

      {/* =====================================================
          ASSIGN ROLE MODAL — per-person role only

          This is the ONE place any role, including the built-in Employee
          role, is assigned to a person. Scope is edited through its
          separate row action. Escape, the backdrop, and Close all
          dismiss it without saving.
          ===================================================== */}

      {roleManageUser && (() => {
        const draftRole = roleDraft[roleManageUser.id] || roleManageUser.role;
        const roleChanged = draftRole !== roleManageUser.role;
        return (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="role-manage-dialog-title"
          onMouseDown={closeRoleManage}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 id="role-manage-dialog-title" className="font-display font-bold text-[16px]">
                  Assign role to {roleManageUser.name}
                </h2>
                <p className="text-[12px] text-ink-muted">
                  Currently {getUserRoleName(roleManageUser)} · {roleManageUser.email}
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={closeRoleManage}>Close</button>
            </div>

            <div className="space-y-1 mb-3">
              <label className="field-label">Role</label>
              {/* This modal changes role only. */}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a role">
                {(roles || []).map((role) => {
                  const key = getRoleKey(role);
                  const isSelected = key === draftRole;
                  return (
                    <button
                      key={role.id || key}
                      type="button"
                      disabled={scopeBusyId === roleManageUser.id}
                      aria-pressed={isSelected}
                      onClick={() => updateRoleDraft(roleManageUser.id, key)}
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
                disabled={!roleChanged || scopeBusyId === roleManageUser.id}
                onClick={() => applyRole(roleManageUser)}
              >
                {scopeBusyId === roleManageUser.id ? 'Applying…' : 'Apply role'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* =====================================================
          CHANGE SCOPE MODAL — scope only, independent of role

          Opened by clicking a user's row in the table below (see
          openChangeScope). Works for every user regardless of role;
          changing scope leaves their role and permissions untouched.
          Escape, the backdrop, and Close all dismiss it without saving.
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
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl"
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

            <div className="flex justify-end mt-3">
              <button
                className="btn btn-sm btn-primary"
                disabled={!scopeChanged || scopeBusyId === changeScopeUser.id}
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
          row is checked. This bulk form has no scope field and never
          touches scope — each
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
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 id="bulk-assign-dialog-title" className="font-display font-bold text-[16px]">
                  Assign role to {selectedUsers.length} people
                </h2>
                <p className="text-[12px] text-ink-muted">
                  Changes role only — everyone keeps their current organisation scope.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setBulkAssignOpen(false)}>Close</button>
            </div>

            <div className="space-y-1 mb-3">
              <label className="field-label">Role</label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a role">
                {(roles || []).map((role) => {
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

function SummaryTile({ label, value }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm">
      <span className="absolute inset-y-0 left-0 w-0.5 bg-accent-500" aria-hidden="true" />
      <div className="pl-1">
        <div className="text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-ink-muted">{label}</div>
        <div className="mt-1 font-display text-[21px] font-extrabold leading-none tabular-nums text-ink">{value}</div>
      </div>
    </div>
  );
}

// Organisation scope is now a property of the PERSON, entirely free of the
// DRAFT role being assigned. Scope options stay the same regardless of
// role; all roles may have a scope or none.
function ScopePicker({ user, org, scopeDraft, setScopeDraft, unitKindDraft, setUnitKindDraft, disabled = false }) {
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