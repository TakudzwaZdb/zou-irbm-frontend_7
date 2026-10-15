import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { avatarClass, initialsOf, scopeBreadcrumb } from '../lib/scope.js';
import PhotoLightbox from '../components/PhotoLightbox.jsx';

// Exported so every other page that needs to show or pick a role — right
// now just Permissions.jsx's role/scope-assignment popup (see its own
// import of these four) — uses the exact same role list/labels/scope rules
// rather than a second, driftable copy. This file stays their one
// canonical source even though Users.jsx itself no longer edits role or
// scope at all — see the note above UserManagementDialog for why, and
// OrgStructure.jsx's own note on why its former, separate, scope-blind
// role-change control was removed rather than also reading from here.
export const ROLES = ['exec', 'vc', 'cpu', 'ictadmin', 'rep', 'unithead', 'employee', 'programme', 'council'];
export const ROLE_LABEL = {
  exec: 'Executive', vc: 'Vice Chancellor', cpu: 'Corporate Planning Unit', ictadmin: 'ICT Systems Administrator',
  rep: 'Sub-programme Rep', unithead: 'Unit Head', employee: 'Employee', programme: 'Programme Head',
  council: 'University Council',
};
export const UNIT_KIND_OPTIONS = ['All organisation units', 'Unit', 'Department', 'Faculty', 'Region', 'Regional Campus'];
const OVERVIEW_LIMIT_LABEL = {
  '': 'No restriction — the overall structure',
  programme: 'Up to Programme level only',
  sub: 'Up to Sub-programme level',
  unit: 'Up to Unit level',
};

// Shared keyboard-activation predicate for elements that act like a button
// but aren't one (the table row below) — Enter and Space are the two keys
// a screen-reader/keyboard user expects to "press" a focused row="button"
// element with, matching native <button> behaviour.
function isActivationKey(event) {
  return event.key === 'Enter' || event.key === ' ';
}

export default function Users() {
  const { user: me, org, refreshUser, reloadCore, hasPerm } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  // manage_users (ictadmin) is full edit access; view_users (granted to CPU
  // by default — see utils/permissions.js) reaches this same page but gets
  // a read-only version of it — every action below is gated on this, not
  // just the backend routes (which 403 on their own regardless), so a
  // view-only visitor never sees a button that would just fail.
  const canEdit = hasPerm('manage_users');
  const [users, setUsers] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [profileDraft, setProfileDraft] = useState({ name: '', email: '' });
  const [viewingUser, setViewingUser] = useState(null);
  const [removedUsers, setRemovedUsers] = useState([]);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState(null);
  // The single popup this whole page now opens into — clicking anywhere on
  // a user's row (not a separate "Select user" button) sets this, the same
  // row-click-opens-a-popup pattern Permissions.jsx uses for its Roles
  // table. Everything that used to be split across that popup AND a
  // separate inline "account controls" disclosure (profile, password,
  // MFA, overview limit, Executive Owner, remove account) now lives in
  // this one dialog together.
  const [managementUser, setManagementUser] = useState(null);
  // Starts collapsed — a click on the header is required to view the
  // account directory, same as every other collapsible table in the app.
  const [usersOpen, setUsersOpen] = useState(false);

  async function load() {
    const r = await api('/users');
    setUsers(r.users);
  }
  async function loadRemoved() {
    try { setRemovedUsers((await api('/users/removed')).users); } catch (err) { toast(err.message, 'err'); }
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'err')); loadRemoved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Whatever's currently open in the popup should track live data (e.g.
  // after a scope change or profile save reloads `users`) instead of going
  // stale mid-session with the object captured at click-time.
  useEffect(() => {
    if (!managementUser || !users) return;
    const fresh = users.find((u) => u.id === managementUser.id);
    if (fresh && fresh !== managementUser) setManagementUser(fresh);
  }, [users]); // eslint-disable-line react-hooks/exhaustive-deps

  async function restoreAccount(u) {
    setRestoreBusyId(u.id);
    try {
      await api(`/users/${u.id}/restore`, { method: 'POST' });
      toast(`${u.name}'s account restored.`);
      await Promise.all([load(), loadRemoved()]);
    } catch (err) { toast(err.message, 'err'); }
    finally { setRestoreBusyId(null); }
  }

  // Search reaches every visible field of a user's profile — name, email,
  // title, role, and where they sit in the org tree — so "search all users
  // together with their profiles" means one box that actually covers the
  // whole profile, not just a name filter.
  const filtered = useMemo(() => {
    if (!users) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => {
      const breadcrumb = (scopeBreadcrumb(org, u) || []).join(' ');
      const haystack = [u.name, u.email, u.title, u.role, ROLE_LABEL[u.role], breadcrumb].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [users, q, org]);

  // Opens the one popup for a row — called from the row's onClick/onKeyDown
  // below. Role and organisation scope are both shown read-only in this
  // dialog now (edited from the Permissions page instead — see the note
  // above UserManagementDialog), so there's no draft state to seed here.
  function openUser(u) {
    setManagementUser(u);
    setEditingId(null);
  }

  function startEdit(u) {
    setEditingId(u.id);
    setProfileDraft({ name: u.name, email: u.email });
  }

  async function saveProfile(u) {
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/profile`, { method: 'PATCH', body: profileDraft });
      toast(`${profileDraft.name}'s profile updated.`);
      setEditingId(null);
      await load();
      if (u.id === me.id) await refreshUser();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function removeEmployee(u) {
    if (!u.scope_id) return;
    if (!(await confirm({
      title: `Remove ${u.name}'s Employee record?`,
      message: `Their account, KPIs, and history will be deactivated but can be restored from Organisation Maintenance's Recently Removed.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    }))) return;
    setBusyId(u.id);
    try {
      await api(`/org/employees/${u.scope_id}`, { method: 'DELETE' });
      toast(`${u.name}'s Employee record was removed.`);
      await Promise.all([load(), reloadCore()]);
      setManagementUser(null);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  // Admin-assisted local password reset used to live here (POST /users/:id/
  // reset-password, still on the backend and still covered by its own
  // test — see auth.test.js — but deliberately no longer wired to any UI).
  // Every account this app creates signs in with "Sign in with Microsoft"
  // (see OrganisationBuilder.jsx's AddAccountModal and routes/org.js's POST
  // /employees), so password reset and management belong to Azure AD
  // (Entra ID) now, not to a button here — see the read-only note in
  // UserManagementDialog's PASSWORD section below.

  // Admin-assisted MFA reset — the same "when they can't help themselves"
  // shape the old resetPassword above used, for the one other credential
  // this app still manages itself (see routes/users.js's POST /:id/mfa/
  // disable) — two-factor authentication is a separate credential from the
  // password and isn't part of Azure AD sign-in here, so it stays. Only
  // ever turns it OFF for a locked-out person; they set it back up
  // themselves from their own Profile page with a new device whenever
  // they're ready.
  async function resetMfa(u) {
    if (!(await confirm({
      title: `Turn off two-factor authentication for ${u.name}?`,
      message: `Use this only if they've lost their authenticator device and their recovery codes — they can set it back up themselves afterward.`,
      confirmLabel: 'Turn off',
      tone: 'danger',
    }))) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/mfa/disable`, { method: 'POST' });
      toast(`Two-factor authentication turned off for ${u.name}.`);
      await load();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  // Overview navigation restriction — a visibility ceiling independent of
  // role/permissions (see db.js's users.overview_limit / lib/scope.js's
  // canDrillToKind), not a permission grant, so it lives here as its own
  // control rather than another catalog chip.
  async function setOverviewLimit(u, value) {
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/overview-limit`, { method: 'PATCH', body: { overviewLimit: value || null } });
      toast(`${u.name}'s Overview navigation ${value ? `capped at ${OVERVIEW_LIMIT_LABEL[value].toLowerCase()}` : 'restriction cleared'}.`);
      await load();
    } catch (err) { toast(err.message, 'err'); } finally { setBusyId(null); }
  }

  // Executive Owner — single-holder accountability designation (see
  // db.js's users.is_executive_owner / routes/org.js's GET /), ordinarily
  // the Vice Chancellor. Setting it on one account clears it from any
  // other, server-side, in one transaction.
  async function setExecutiveOwner(u, on) {
    if (on && !(await confirm({
      title: `Designate ${u.name} as Executive Owner?`,
      message: 'This clears the designation from anyone who currently holds it.',
      confirmLabel: 'Designate',
    }))) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/executive-owner`, { method: 'PATCH', body: { executiveOwner: on } });
      toast(on ? `${u.name} designated Executive Owner.` : `${u.name} un-designated as Executive Owner.`);
      await load();
    } catch (err) { toast(err.message, 'err'); } finally { setBusyId(null); }
  }

  async function removeAccount(u) {
    if (!(await confirm({
      title: `Remove ${u.name}'s account?`,
      message: `They're deactivated, not deleted — their permissions, role, and full history (audit log, messages, past KPI submissions) stay intact, and it's recoverable from Recently Removed below.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    }))) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast(`${u.name}'s account removed.`);
      setManagementUser(null);
      await load();
      await loadRemoved();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Users</h1>
          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            {canEdit ? (
              <>
                Every account in the system, with its full profile. Only ICT System Administrators can update a
                profile, reset a forgotten password, or remove an account. Role and organisation scope are both
                shown here read-only — assign or change either one from the Permissions &amp; Roles page's bulk
                "Assign Roles to Users" (university-wide roles) or a row's own "Assign role &amp; scope" (Unit Head,
                Sub-programme Rep, Programme Head, Employee).
              </>
            ) : (
              <>
                Every account in the system, with its full profile — view only. Updating a profile, resetting a
                password, changing a role or organisation scope, or removing an account is reserved for ICT
                System Administrators.
              </>
            )}
          </p>
        </div>
        <input
          className="field-input w-auto min-w-[280px]"
          placeholder="Search name, email, role, unit…"
          aria-label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {users && (
        <p className="text-[11.8px] text-ink-muted mb-2.5">
          Showing {filtered.length} of {users.length} account{users.length === 1 ? '' : 's'}{q.trim() ? ` matching "${q.trim()}"` : ''}.
        </p>
      )}

      {filtered?.length === 0 && <div className="card text-center text-ink-muted py-8">No accounts match that search.</div>}

      <div className="card mt-4">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => setUsersOpen((value) => !value)} aria-expanded={usersOpen}>
          <span className="font-display font-bold text-[14px] flex items-center gap-2">
            Users
            <span className="chip">{filtered?.length || 0}</span>
          </span>
          <span className="text-accent-600 font-semibold text-[12px]">{usersOpen ? 'Hide ▲' : 'Click to view ▼'}</span>
        </button>
        {usersOpen && <>
          <p className="text-[12px] text-ink-muted mt-1">
            {canEdit ? 'Click anywhere on an account’s row to open its management popup.' : 'Click anywhere on an account’s row to view its full profile.'}
          </p>
          <div className="mt-3 overflow-x-auto max-h-[65vh] overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-sunken border-b border-line sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 font-bold">User</th>
                <th className="px-3 py-2 font-bold">Email</th>
                <th className="px-3 py-2 font-bold">Title</th>
                <th className="px-3 py-2 font-bold">Role</th>
                <th className="px-3 py-2 font-bold">Organisation scope</th>
                <th className="px-3 py-2 font-bold" />
              </tr>
            </thead>
            <tbody>
      {(filtered || []).map((u) => {
        const isSelf = u.id === me.id;
        const breadcrumb = scopeBreadcrumb(org, u);
        // Named per-row so the intent reads at the call site (onClick={handleRowActivate}
        // instead of an inline arrow) and so the exact same function backs both the
        // mouse and keyboard paths below — one code path, not two that can drift apart.
        const handleRowActivate = () => openUser(u);
        function handleRowKeyDown(event) {
          if (!isActivationKey(event)) return;
          event.preventDefault();
          handleRowActivate();
        }
        // The row itself opens the management popup on click, so viewing the
        // photo needs to stop that click from bubbling up to the row —
        // otherwise it would pop the management dialog open behind the
        // lightbox at the same time.
        function handleAvatarClick(event) {
          event.preventDefault();
          event.stopPropagation();
          setViewingUser(u);
        }
        return (
          <tr
            key={u.id}
            onClick={handleRowActivate}
            onKeyDown={handleRowKeyDown}
            role="button"
            tabIndex={0}
            aria-label={`Manage ${u.name}`}
            className="border-b border-line last:border-b-0 cursor-pointer transition-colors hover:bg-sunken"
          >
            <td className="px-3 py-2.5 min-w-44">
              {u.avatar ? (
                <button
                  type="button"
                  className="w-7 h-7 rounded-full flex-none cursor-zoom-in"
                  title={`View ${u.name}'s photo`}
                  onClick={handleAvatarClick}
                >
                  <img src={u.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                </button>
              ) : (
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-none ${avatarClass(u.id)}`}>
                  {initialsOf(u.name)}
                </span>
              )}
              <span className="truncate">{u.name}</span>
            </td>
            <td className="px-3 py-2.5 text-ink-secondary">{u.email}</td>
            <td className="px-3 py-2.5 text-ink-secondary">{u.title || '—'}</td>
            <td className="px-3 py-2.5">{ROLE_LABEL[u.role] || u.role}{isSelf ? ' · you' : ''}</td>
            <td className="px-3 py-2.5 text-ink-secondary">{breadcrumb?.join(' › ') || 'No scope'}</td>
            <td className="px-3 py-2.5 text-accent-600 font-semibold text-[11px] whitespace-nowrap">{canEdit ? 'Click to manage ›' : 'Click to view ›'}</td>
          </tr>
        );
      })}
            </tbody>
          </table>
          </div>
        </>}
      </div>

      <div className="card mt-4">
        <button className="w-full flex items-center justify-between text-left" onClick={() => setRemovedOpen((v) => !v)}>
          <span className="font-display font-bold text-[14px] flex items-center gap-2">
            Recently Removed
            <span className={`chip ${removedUsers.length ? 'chip-rag-amber' : ''}`}>{removedUsers.length}</span>
          </span>
          <span className="text-accent-600 font-semibold text-[12px]">{removedOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
        <p className="text-[12px] text-ink-muted mt-1">
          Accounts removed directly from this Directory — nothing here is deleted; restoring lets them sign in again
          immediately with their role, permissions, and full history intact. (An account deactivated because its
          Employee/Unit-head/Sub-Rep/Programme-head was removed shows up on Organisation Maintenance's own Recently
          Removed instead — restoring the person there reactivates the account too.)
        </p>
        {removedOpen && (
          removedUsers.length === 0 ? (
            <p className="text-[12px] text-ink-muted mt-3">Nothing removed right now.</p>
          ) : (
            <div className="mt-3 space-y-1 text-[12.5px]">
              {removedUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 bg-sunken rounded-lg px-2.5 py-1.5">
                  <span className="text-ink-muted">{u.name} — {u.email} ({ROLE_LABEL[u.role] || u.role})</span>
                  {canEdit && (
                    <button className="btn btn-sm btn-primary" disabled={restoreBusyId === u.id} onClick={() => restoreAccount(u)}>
                      {restoreBusyId === u.id ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {managementUser && <UserManagementDialog
        user={managementUser}
        me={me}
        org={org}
        canEdit={canEdit}
        busy={busyId === managementUser.id}
        onRemoveEmployee={removeEmployee}
        onClose={() => { setManagementUser(null); setEditingId(null); }}
        editingId={editingId}
        profileDraft={profileDraft}
        setProfileDraft={setProfileDraft}
        onStartEdit={startEdit}
        onCancelEdit={() => setEditingId(null)}
        onSaveProfile={saveProfile}
        onResetMfa={resetMfa}
        onSetOverviewLimit={setOverviewLimit}
        onSetExecutiveOwner={setExecutiveOwner}
        onRemoveAccount={removeAccount}
      />}

      {viewingUser && <PhotoLightbox src={viewingUser.avatar} name={viewingUser.name} onClose={() => setViewingUser(null)} />}
    </div>
  );
}

// One popup covering everything an ICT admin can do to an account: role and
// organisation scope are both shown read-only (both assigned/changed from
// the Permissions & Roles page instead — see Users()'s header note),
// profile (name/email — title is never a free-text field, it's always the
// role's own label, set server-side whenever role/scope changes),
// password/MFA reset, the Overview navigation ceiling, Executive Owner, and
// account removal. This replaces what used to be two separate surfaces (a
// "Select user" popup for role+scope, and a second inline "account
// controls" disclosure for everything else) with the one dialog opened by
// clicking the row.
function UserManagementDialog({
  user, me, org, canEdit, busy,
  onRemoveEmployee, onClose,
  editingId, profileDraft, setProfileDraft, onStartEdit, onCancelEdit, onSaveProfile,
  onResetMfa,
  onSetOverviewLimit, onSetExecutiveOwner, onRemoveAccount,
}) {
  const isSelf = user.id === me.id;
  const isEditing = editingId === user.id;
  const breadcrumb = scopeBreadcrumb(org, user);

  // Escape closes the dialog — every other modal in this app (Permissions'
  // role-permissions dialog, KPI Management's create-KPI popup) supports
  // this, so this one should too. Scoped to a useEffect that only runs
  // while the dialog is actually mounted, so the listener is added and
  // removed automatically with it rather than needing a manual open/closed
  // check in a handler that's registered for the component's whole life.
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Click-outside-to-close: the backdrop's onMouseDown fires onClose, and
  // the dialog card stops that same event from bubbling up to the backdrop
  // so a click that starts and ends inside the dialog never closes it.
  function handleBackdropMouseDown() {
    onClose();
  }
  function stopMouseDownPropagation(event) {
    event.stopPropagation();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="user-management-dialog-title" onMouseDown={handleBackdropMouseDown}>
      <div className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-4" onMouseDown={stopMouseDownPropagation}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 id="user-management-dialog-title" className="font-display font-bold text-[16px]">{canEdit ? 'Manage' : 'View'} {user.name}</h2>
            <p className="text-[12px] text-ink-muted">
              {user.email} · {user.title || '—'}
              {breadcrumb && breadcrumb.length > 0 && <span> · {breadcrumb.join(' › ')}</span>}
              {isSelf && <span> · you</span>}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {/* ROLE + ORGANISATION SCOPE — both read-only here */}
        <div className="space-y-3 pb-3 border-b border-line">
          <div className="space-y-1">
            <label className="field-label">Role</label>
            <div className="field-input bg-sunken text-ink-secondary cursor-not-allowed">
              {ROLE_LABEL[user.role] || user.role}
            </div>
          </div>
          <div className="space-y-1">
            <label className="field-label">Organisation scope</label>
            <div className="field-input bg-sunken text-ink-secondary cursor-not-allowed">
              {breadcrumb && breadcrumb.length > 0 ? breadcrumb.join(' › ') : 'No scope'}
            </div>
          </div>
          <p className="text-[11px] text-ink-muted">
            Role and organisation scope are both assigned from the Permissions &amp; Roles page — bulk "Assign
            Roles to Users" for a university-wide role, or that row's own "Assign role &amp; scope" for Unit Head,
            Sub-programme Rep, Programme Head, or Employee — never from here.
          </p>
        </div>

        {/* PROFILE */}
        <div className="mt-3 pt-3 border-b border-line pb-3">
          <label className="field-label block mb-1.5">Profile</label>
          {!isEditing && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[12px] text-ink-secondary">
                {user.name} · {user.email}
                <span className="text-ink-muted"> — title "{user.title || '—'}" is set automatically from the role above.</span>
              </p>
              {canEdit && <button className="btn btn-sm" onClick={() => onStartEdit(user)}>Edit profile</button>}
            </div>
          )}
          {isEditing && canEdit && (
            <div className="max-w-md space-y-2.5">
              <div className="space-y-1">
                <label htmlFor="user-profile-name" className="field-label">Full name</label>
                <input id="user-profile-name" className="field-input" value={profileDraft.name}
                  onChange={(e) => setProfileDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label htmlFor="user-profile-email" className="field-label">Email</label>
                <input id="user-profile-email" type="email" className="field-input" value={profileDraft.email}
                  onChange={(e) => setProfileDraft((d) => ({ ...d, email: e.target.value }))} />
              </div>
              <p className="text-[11px] text-ink-muted">
                Title isn't editable here — it always mirrors the role above and updates automatically if that role
                or its scope changes.
              </p>
              <div className="flex gap-2">
                <button className="btn btn-sm btn-primary" disabled={busy || !profileDraft.name.trim() || !profileDraft.email.trim()} onClick={() => onSaveProfile(user)}>
                  Save profile
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={onCancelEdit}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* PASSWORD / MFA — ICT admin only. There is no local password
            reset here any more: every account signs in with "Sign in with
            Microsoft" (see OrganisationBuilder.jsx's AddAccountModal /
            routes/org.js's POST /employees), so password reset and
            management belong to Azure AD (Entra ID), not this app. Two-
            factor authentication is a separate credential from the
            password and isn't part of Azure AD sign-in here, so its reset
            control stays. */}
        {canEdit && (
          <div className="mt-3 pt-3 border-b border-line pb-3">
            <label className="field-label block mb-1">Password</label>
            <p className="text-[12px] text-ink-secondary max-w-[52ch]">
              Managed in Microsoft / Azure AD (Entra ID), not here — there's no local password reset for any
              account in this app.
            </p>
            <div className="flex gap-2 flex-wrap items-center mt-1.5">
              {user.mfa_enabled && (
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onResetMfa(user)}>
                  Turn off two-factor authentication
                </button>
              )}
            </div>
          </div>
        )}

        {/* OVERVIEW LIMIT / EXECUTIVE OWNER — shown either way; editable controls only for ICT admin */}
        <div className="flex flex-wrap items-end gap-2.5 mt-3 pt-3 border-b border-line pb-3">
          <div className="space-y-1">
            <label htmlFor="user-overview-limit" className="field-label">Overview navigation limit</label>
            {canEdit ? (
              <select
                id="user-overview-limit"
                className="field-input py-1.5"
                value={user.overview_limit || ''}
                disabled={busy}
                onChange={(e) => onSetOverviewLimit(user, e.target.value)}
              >
                {Object.entries(OVERVIEW_LIMIT_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            ) : (
              <div className="field-input py-1.5 bg-sunken text-ink-secondary cursor-not-allowed">
                {OVERVIEW_LIMIT_LABEL[user.overview_limit || '']}
              </div>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-[12px] font-semibold select-none pb-1.5">
            <input
              type="checkbox"
              checked={!!user.is_executive_owner}
              disabled={!canEdit || busy}
              onChange={(e) => onSetExecutiveOwner(user, e.target.checked)}
            />
            Executive Owner
            <span className="text-ink-muted font-normal">(accountable for overall institutional performance)</span>
          </label>
        </div>

        {/* REMOVE — ICT admin only */}
        {canEdit && (
          <div className="flex items-center justify-between gap-2 flex-wrap mt-3 pt-3">
            {user.role === 'employee' ? (
              <button className="btn btn-sm btn-danger" disabled={isSelf || busy} onClick={() => onRemoveEmployee(user)}>Remove Employee</button>
            ) : <span />}
            {!isSelf && (
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onRemoveAccount(user)}>Remove account</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ScopePicker, employeeScopeLabel, and scopeLabel used to live here —
// they now live in Permissions.jsx, which is where organisation scope is
// actually edited from (see the header note above and Users()'s own
// description paragraph). ROLES/ROLE_LABEL/UNIT_KIND_OPTIONS stay exported
// from this file as the one canonical source Permissions.jsx shares.
//
// ROLE_SCOPE_TYPES — a hardcoded { rep: 'sub', unithead: 'unit', programme:
// 'programme' } mapping each role to the one scope type it required — used
// to live here too. It's gone for good, not moved: organisation scope is a
// property of the PERSON, not the role (see routes/users.js's PATCH
// /:id/role), so no role — built-in or custom — declares or requires a
// scope type any more. The one exception is the built-in Employee role,
// which is just a literal `role === 'employee'` check wherever it matters
// (Permissions.jsx, routes/users.js), not a lookup table.
