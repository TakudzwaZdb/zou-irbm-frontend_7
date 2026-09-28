import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

const ROLE_LABEL = {
  exec: 'Executive',
  cpu: 'Corporate Planning Unit',
  ictadmin: 'ICT Systems Administrator',
  rep: 'Sub-programme Rep',
  unithead: 'Unit Head',
  individual: 'Individual',
  programme: 'Programme Head',
  council: 'University Council',
};

export default function Permissions() {
  const toast = useToast();

  const [roles, setRoles] = useState(null);
  const [users, setUsers] = useState(null);
  const [catalog, setCatalog] = useState([]);

  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);

  const [q, setQ] = useState('');
  const [rolesOpen, setRolesOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  const [assignRole, setAssignRole] = useState('');
  const [assigning, setAssigning] = useState(false);

  const [newRoleKey, setNewRoleKey] = useState('');
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [creatingRole, setCreatingRole] = useState(false);
  // Create-role popup: opened from the "+ Create role" button above the
  // roles table, closed automatically the moment a role is actually
  // created (see createRole() below) — same popup-then-auto-close pattern
  // as KPI Management's "Create a KPI" dialog.
  const [showCreateRole, setShowCreateRole] = useState(false);

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

    const needle = q.trim().toLowerCase();

    if (!needle) {
      return users;
    }

    return users.filter((user) => {
      return [
        user?.name,
        user?.email,
        user?.role,
        ROLE_LABEL[user?.role],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [users, q]);

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
            Permissions
          </h1>

          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            Permissions are assigned to roles only.
            Users receive access through the role
            assigned to their account.
          </p>

        </div>

        <input
          className="field-input w-auto min-w-[220px]"
          placeholder="Search roles or users…"
          aria-label="Search roles or users"
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

          <span className="text-ink-muted text-[12px]">
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
              Systems Administrator, and the rest) can't be created or
              removed here. A new role starts with no permissions
              granted — open it from the roles table once it appears to
              grant some.
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

          <span className="text-ink-muted text-[12px]">
            {usersOpen
              ? 'Hide ▲'
              : 'Click to view ▼'}
          </span>

        </button>

        {usersOpen && (
          <>

            <p className="text-[12px] text-ink-muted mt-1">
              Select one or more users and
              assign them a role. Users inherit
              permissions from their assigned role.
            </p>

            {/* =================================================
                ASSIGN ROLE CONTROLS
                ================================================= */}

            <div className="mt-3 mb-3 p-3 rounded-lg border border-line bg-sunken">

              <div className="flex flex-wrap items-end gap-3">

                <div className="min-w-[240px]">

                  <label
                    htmlFor="assign-role"
                    className="block text-[11px] font-semibold mb-1"
                  >
                    Role
                  </label>

                  <select
                    id="assign-role"
                    className="field-input w-full"
                    value={assignRole}
                    onChange={(event) =>
                      setAssignRole(
                        event.target.value
                      )
                    }
                  >

                    <option value="">
                      Select role...
                    </option>

                    {(roles || []).map(
                      (role) => (
                        <option
                          key={
                            role.id ||
                            getRoleKey(
                              role
                            )
                          }
                          value={getRoleKey(
                            role
                          )}
                        >
                          {getRoleName(
                            role
                          )}
                        </option>
                      )
                    )}

                  </select>

                </div>

                <button
                  type="button"
                  className="btn"
                  disabled={
                    assigning ||
                    selectedUsers.length ===
                      0 ||
                    !assignRole
                  }
                  onClick={
                    assignSelectedUsers
                  }
                >
                  {assigning
                    ? 'Assigning...'
                    : `Assign Role${
                        selectedUsers.length
                          ? ` (${selectedUsers.length})`
                          : ''
                      }`}
                </button>

                {selectedUsers.length >
                  0 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={
                      clearSelection
                    }
                  >
                    Clear Selection
                  </button>
                )}

              </div>

            </div>

            {/* =================================================
                USERS TABLE
                ================================================= */}

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

                  </tr>

                </thead>

                <tbody>

                  {(filteredUsers || []).map(
                    (user) => {

                      const checked =
                        selectedUsers.includes(
                          user.id
                        );

                      return (
                        <tr
                          key={user.id}
                          className={`border-b border-line last:border-b-0 ${
                            checked
                              ? 'bg-sunken'
                              : ''
                          }`}
                        >

                          <td className="px-3 py-2.5">

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

    </div>
  );
}