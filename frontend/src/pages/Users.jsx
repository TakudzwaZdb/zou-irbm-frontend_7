import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { avatarClass, initialsOf, scopeBreadcrumb } from '../lib/scope.js';
import PhotoLightbox from '../components/PhotoLightbox.jsx';

// Exported so OrgStructure.jsx's own (narrower — individuals only) role
// control uses the exact same role list/labels rather than a second,
// driftable copy.
export const ROLES = ['exec', 'cpu', 'ictadmin', 'rep', 'unithead', 'individual', 'programme', 'council'];
export const ROLE_LABEL = {
  exec: 'Executive', cpu: 'Corporate Planning Unit', ictadmin: 'ICT Systems Administrator',
  rep: 'Sub-programme Rep', unithead: 'Unit Head', individual: 'Individual', programme: 'Programme Head',
  council: 'University Council',
};
const ROLE_SCOPE_TYPES = { rep: 'sub', unithead: 'unit', programme: 'programme' };
const UNIT_KIND_OPTIONS = ['All organisation units', 'Unit', 'Department', 'Faculty', 'Region', 'Regional Campus'];
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
  const { user: me, org, refreshUser, reloadCore } = useApp();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [scopeDraft, setScopeDraft] = useState({});
  const [unitKindDraft, setUnitKindDraft] = useState({});
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [profileDraft, setProfileDraft] = useState({ name: '', email: '' });
  const [resetDraft, setResetDraft] = useState({});
  const [resetResult, setResetResult] = useState({});
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
  // below. Seeds the scope draft from whatever the account actually has
  // right now (locked to the role's required scope type for rep/unit
  // head/programme — see ScopePicker) so the dialog always starts in sync
  // with the database, never with leftover state from a previously-opened
  // user.
  function openUser(u) {
    setManagementUser(u);
    setEditingId(null);
    const requiredType = ROLE_SCOPE_TYPES[u.role];
    setScopeDraft((draft) => ({ ...draft, [u.id]: { type: requiredType || u.scope_type || '', id: u.scope_id || '' } }));
    const unit = org.units.find((item) => item.id === Number(u.scope_id));
    setUnitKindDraft((draft) => ({ ...draft, [u.id]: unit?.kind || 'All organisation units' }));
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

  // Organisation scope only now — role itself is assigned from the
  // Permissions page ("Assign Roles to Users"), not here. The same
  // PATCH /:id/role endpoint still backs this (it's the one place the
  // database ties role + scope together and re-derives `title` from the
  // role's label), it's just always sent the account's own unchanged role.
  async function applyScope(u) {
    const scope = scopeDraft[u.id] || { type: u.scope_type || '', id: u.scope_id || '' };
    if (String(scope.type || '') === String(u.scope_type || '') && String(scope.id || '') === String(u.scope_id || '')) return;
    const scopeName = scopeLabel(scope.type, scope.id, org);
    if (!window.confirm(`Move ${u.name}'s organisation scope${scopeName ? ` to ${scopeName}` : ' to no scope'}?`)) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/role`, { method: 'PATCH', body: { role: u.role, scopeType: scope.type || null, scopeId: scope.id ? Number(scope.id) : null } });
      toast(`${u.name}'s organisation scope updated.`);
      await load();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function removeIndividual(u) {
    if (!u.scope_id) return;
    if (!window.confirm(`Remove ${u.name} and their Individual record? Their account, KPIs, and history will be deactivated but can be restored from Organisation Maintenance's Recently Removed.`)) return;
    setBusyId(u.id);
    try {
      await api(`/org/individuals/${u.scope_id}`, { method: 'DELETE' });
      toast(`${u.name}'s Individual record was removed.`);
      await Promise.all([load(), reloadCore()]);
      setManagementUser(null);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  // Admin-assisted reset — the real answer to "when they forget" for a
  // system with no email/SMS delivery to send a reset link through (see
  // Profile.jsx's own note to the same effect). Leaving the field blank
  // generates a random one; either way the plaintext is only ever shown
  // here, once, to the admin who just set it.
  async function resetPassword(u) {
    const typed = (resetDraft[u.id] || '').trim();
    if (!window.confirm(typed
      ? `Set ${u.name}'s password to the value you entered?`
      : `Generate a new random password for ${u.name}?`)) return;
    setBusyId(u.id);
    try {
      const r = await api(`/users/${u.id}/reset-password`, { method: 'POST', body: { newPassword: typed || undefined } });
      setResetResult((s) => ({ ...s, [u.id]: r.newPassword }));
      setResetDraft((s) => ({ ...s, [u.id]: '' }));
      toast(`Password reset for ${u.name}.`);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  // Admin-assisted MFA reset — the same "when they can't help themselves"
  // shape as resetPassword above, for the one other credential this app
  // now has (see routes/users.js's POST /:id/mfa/disable). Only ever turns
  // it OFF for a locked-out person; they set it back up themselves from
  // their own Profile page with a new device whenever they're ready.
  async function resetMfa(u) {
    if (!window.confirm(`Turn off two-factor authentication for ${u.name}? Use this only if they've lost their authenticator device and their recovery codes — they can set it back up themselves afterward.`)) return;
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
    if (on && !window.confirm(`Designate ${u.name} as Executive Owner? This clears the designation from anyone who currently holds it.`)) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/executive-owner`, { method: 'PATCH', body: { executiveOwner: on } });
      toast(on ? `${u.name} designated Executive Owner.` : `${u.name} un-designated as Executive Owner.`);
      await load();
    } catch (err) { toast(err.message, 'err'); } finally { setBusyId(null); }
  }

  async function removeAccount(u) {
    if (!window.confirm(`Remove ${u.name}'s account? They're deactivated, not deleted — their permissions, role, and full history (audit log, messages, past KPI submissions) stay intact, and it's recoverable from Recently Removed below.`)) return;
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
          <h1 className="text-xl font-bold mb-0.5">User &amp; Roles</h1>
          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            Every account in the system, with its full profile. Only ICT System Administrators can update a
            profile, reset a forgotten password, adjust organisation scope, or remove an account. Roles
            themselves are assigned from the Permissions page's "Assign Roles to Users".
          </p>
        </div>
        <input
          className="field-input w-auto min-w-[220px]"
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
          <span className="text-ink-muted text-[12px]">{usersOpen ? 'Hide ▲' : 'Click to view ▼'}</span>
        </button>
        {usersOpen && <>
          <p className="text-[12px] text-ink-muted mt-1">Click anywhere on an account's row to open its management popup.</p>
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
            <td className="px-3 py-2.5 text-ink-muted text-[11px] whitespace-nowrap">Click to manage ›</td>
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
          <span className="text-ink-muted text-[12px]">{removedOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
        <p className="text-[12px] text-ink-muted mt-1">
          Accounts removed directly from this Directory — nothing here is deleted; restoring lets them sign in again
          immediately with their role, permissions, and full history intact. (An account deactivated because its
          Individual/Unit-head/Sub-Rep/Programme-head was removed shows up on Organisation Maintenance's own Recently
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
                  <button className="btn btn-sm btn-primary" disabled={restoreBusyId === u.id} onClick={() => restoreAccount(u)}>
                    {restoreBusyId === u.id ? 'Restoring…' : 'Restore'}
                  </button>
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
        scopeDraft={scopeDraft}
        setScopeDraft={setScopeDraft}
        unitKindDraft={unitKindDraft}
        setUnitKindDraft={setUnitKindDraft}
        busy={busyId === managementUser.id}
        onApplyScope={applyScope}
        onRemoveIndividual={removeIndividual}
        onClose={() => { setManagementUser(null); setEditingId(null); }}
        editingId={editingId}
        profileDraft={profileDraft}
        setProfileDraft={setProfileDraft}
        onStartEdit={startEdit}
        onCancelEdit={() => setEditingId(null)}
        onSaveProfile={saveProfile}
        resetDraft={resetDraft}
        setResetDraft={setResetDraft}
        resetResult={resetResult}
        onDismissResetResult={(id) => setResetResult((s) => { const n = { ...s }; delete n[id]; return n; })}
        onResetPassword={resetPassword}
        onResetMfa={resetMfa}
        onSetOverviewLimit={setOverviewLimit}
        onSetExecutiveOwner={setExecutiveOwner}
        onRemoveAccount={removeAccount}
      />}

      {viewingUser && <PhotoLightbox src={viewingUser.avatar} name={viewingUser.name} onClose={() => setViewingUser(null)} />}
    </div>
  );
}

// One popup covering everything an ICT admin can do to an account: role is
// shown but read-only (changed from the Permissions page instead — see
// Users()'s header note), organisation scope, profile (name/email —
// title is never a free-text field, it's always the role's own label, set
// server-side whenever role/scope changes), password/MFA reset, the
// Overview navigation ceiling, Executive Owner, and account removal. This
// replaces what used to be two separate surfaces (a "Select user" popup for
// role+scope, and a second inline "account controls" disclosure for
// everything else) with the one dialog opened by clicking the row.
function UserManagementDialog({
  user, me, org, scopeDraft, setScopeDraft, unitKindDraft, setUnitKindDraft, busy,
  onApplyScope, onRemoveIndividual, onClose,
  editingId, profileDraft, setProfileDraft, onStartEdit, onCancelEdit, onSaveProfile,
  resetDraft, setResetDraft, resetResult, onDismissResetResult, onResetPassword, onResetMfa,
  onSetOverviewLimit, onSetExecutiveOwner, onRemoveAccount,
}) {
  const currentScope = scopeDraft[user.id] || { type: user.scope_type || '', id: user.scope_id || '' };
  const scopeChanged = String(currentScope.type || '') !== String(user.scope_type || '')
    || String(currentScope.id || '') !== String(user.scope_id || '');
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
            <h2 id="user-management-dialog-title" className="font-display font-bold text-[16px]">Manage {user.name}</h2>
            <p className="text-[12px] text-ink-muted">
              {user.email} · {user.title || '—'}
              {breadcrumb && breadcrumb.length > 0 && <span> · {breadcrumb.join(' › ')}</span>}
              {isSelf && <span> · you</span>}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {/* ROLE (read-only) + ORGANISATION SCOPE */}
        <div className="space-y-3 pb-3 border-b border-line">
          <div className="space-y-1">
            <label className="field-label">Role</label>
            <div className="field-input bg-sunken text-ink-secondary cursor-not-allowed">
              {ROLE_LABEL[user.role] || user.role}
            </div>
            <p className="text-[11px] text-ink-muted">
              Roles are assigned from the Permissions page's "Assign Roles to Users" — not here.
            </p>
          </div>
          <ScopePicker
            user={user}
            org={org}
            scopeDraft={scopeDraft}
            setScopeDraft={setScopeDraft}
            unitKindDraft={unitKindDraft}
            setUnitKindDraft={setUnitKindDraft}
            disabled={isSelf || busy}
          />
          {!isSelf && (
            <div className="flex justify-end">
              <button className="btn btn-sm btn-primary" disabled={!scopeChanged || busy} onClick={() => onApplyScope(user)}>
                Apply scope change
              </button>
            </div>
          )}
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
              <button className="btn btn-sm" onClick={() => onStartEdit(user)}>Edit profile</button>
            </div>
          )}
          {isEditing && (
            <div className="max-w-md space-y-2.5">
              <div className="space-y-1">
                <label className="field-label">Full name</label>
                <input className="field-input" value={profileDraft.name}
                  onChange={(e) => setProfileDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="field-label">Email</label>
                <input type="email" className="field-input" value={profileDraft.email}
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

        {/* PASSWORD / MFA */}
        <div className="mt-3 pt-3 border-b border-line pb-3">
          <label className="field-label block mb-1">Password</label>
          {resetResult[user.id] && (
            <div className="mb-2 rounded-lg bg-good-soft text-good text-[12.3px] px-3 py-2 flex items-center gap-2 flex-wrap">
              <span>New password: <b className="font-mono">{resetResult[user.id]}</b> — share it with {user.name} now, it won't be shown again.</span>
              <button className="ml-auto text-good/70 hover:text-good font-bold" onClick={() => onDismissResetResult(user.id)} aria-label="Dismiss">✕</button>
            </div>
          )}
          <div className="flex gap-2 flex-wrap items-center">
            <input
              className="field-input py-1.5 w-auto min-w-[180px]"
              placeholder="New password (blank = generate one)"
              value={resetDraft[user.id] || ''}
              onChange={(e) => setResetDraft((s) => ({ ...s, [user.id]: e.target.value }))}
            />
            <button className="btn btn-sm" disabled={busy} onClick={() => onResetPassword(user)}>Reset password</button>
            {user.mfa_enabled && (
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onResetMfa(user)}>
                Turn off two-factor authentication
              </button>
            )}
          </div>
        </div>

        {/* OVERVIEW LIMIT / EXECUTIVE OWNER */}
        <div className="flex flex-wrap items-end gap-2.5 mt-3 pt-3 border-b border-line pb-3">
          <div className="space-y-1">
            <label className="field-label">Overview navigation limit</label>
            <select
              className="field-input py-1.5"
              value={user.overview_limit || ''}
              disabled={busy}
              onChange={(e) => onSetOverviewLimit(user, e.target.value)}
            >
              {Object.entries(OVERVIEW_LIMIT_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer select-none pb-1.5">
            <input
              type="checkbox"
              checked={!!user.is_executive_owner}
              disabled={busy}
              onChange={(e) => onSetExecutiveOwner(user, e.target.checked)}
            />
            Executive Owner
            <span className="text-ink-muted font-normal">(accountable for overall institutional performance)</span>
          </label>
        </div>

        {/* REMOVE */}
        <div className="flex items-center justify-between gap-2 flex-wrap mt-3 pt-3">
          {user.role === 'individual' ? (
            <button className="btn btn-sm btn-danger" disabled={isSelf || busy} onClick={() => onRemoveIndividual(user)}>Remove Individual</button>
          ) : <span />}
          {!isSelf && (
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onRemoveAccount(user)}>Remove account</button>
          )}
        </div>
      </div>
    </div>
  );
}

// Scope type is now derived from the account's (fixed, read-only) role —
// Sub-programme Rep/Unit Head/Programme Head each have exactly one valid
// scope type (ROLE_SCOPE_TYPES) so there's nothing to choose; Individual is
// the one role with a real choice of container (Programme/Sub-programme/
// Unit/Individual); every other role (exec/cpu/ictadmin/council) is
// university-wide and simply has no scope to set.
function ScopePicker({ user, org, scopeDraft, setScopeDraft, unitKindDraft, setUnitKindDraft, disabled = false }) {
  const requiredType = ROLE_SCOPE_TYPES[user.role];
  const isIndividual = user.role === 'individual';
  const isUniversityWide = !requiredType && !isIndividual;

  if (isUniversityWide) {
    return (
      <div className="space-y-1">
        <label className="field-label">Organisation scope</label>
        <p className="text-[12px] text-ink-muted">No scope — {ROLE_LABEL[user.role] || user.role} accounts are university-wide.</p>
      </div>
    );
  }

  const current = scopeDraft[user.id] || { type: requiredType || user.scope_type || '', id: user.scope_id || '' };
  const effectiveType = requiredType || current.type;
  const selectedUnit = org.units.find((unit) => unit.id === Number(current.id));
  const selectedKind = unitKindDraft[user.id] || selectedUnit?.kind || 'All organisation units';
  const options = effectiveType === 'programme' ? org.programmes
    : effectiveType === 'sub' ? org.subs
      : effectiveType === 'unit' ? org.units.filter((unit) => selectedKind === 'All organisation units' || unit.kind === selectedKind)
        : effectiveType === 'individual' ? org.individuals
          : [];
  function update(key, value) {
    setScopeDraft((draft) => ({ ...draft, [user.id]: { ...current, type: effectiveType, [key]: value } }));
  }
  return <div className="space-y-1">
    <label className="field-label">Organisation scope</label>
    <div className="flex gap-1.5 flex-wrap items-center">
      {isIndividual ? (
        <select className="field-input py-1.5" value={current.type} disabled={disabled} onChange={(e) => { setScopeDraft((draft) => ({ ...draft, [user.id]: { type: e.target.value, id: '' } })); }}>
          <option value="">No scope</option>
          <option value="unit">Unit / Department / Faculty / Region</option>
          <option value="programme">Programme</option>
          <option value="sub">Sub-programme</option>
          <option value="individual">Individual</option>
        </select>
      ) : (
        <span className="field-input py-1.5 bg-sunken text-ink-secondary cursor-not-allowed w-auto">
          {requiredType === 'sub' ? 'Sub-programme' : requiredType === 'unit' ? 'Unit / Department / Faculty / Region' : 'Programme'}
        </span>
      )}
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
        {options.map((item) => <option key={item.id} value={item.id}>{effectiveType === 'individual' ? individualScopeLabel(item, org) : item.kind ? `${item.kind} — ${item.name}` : item.name}</option>)}
      </select>}
    </div>
  </div>;
}

function individualScopeLabel(individual, org) {
  const unit = org.units.find((item) => item.id === individual.unit_id);
  const sub = unit && org.subs.find((item) => item.id === unit.sub_id);
  const programme = sub && org.programmes.find((item) => item.id === sub.programme_id);
  const unitLabel = unit ? `${unit.kind || 'Unit'} — ${unit.name}` : 'Unit not found';
  return `${individual.name} · ${programme?.name || 'Programme not found'} / ${sub?.name || 'Sub-programme not found'} / ${unitLabel}`;
}

function scopeLabel(type, id, org) {
  if (!type || !id) return '';
  const items = type === 'programme' ? org.programmes : type === 'sub' ? org.subs : type === 'unit' ? org.units : org.individuals;
  const item = items.find((entry) => entry.id === Number(id));
  return item ? `${type} "${item.name}"` : '';
}
