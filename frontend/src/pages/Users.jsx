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

export default function Users() {
  const { user: me, org, refreshUser, reloadCore } = useApp();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [roleDraft, setRoleDraft] = useState({});
  const [scopeDraft, setScopeDraft] = useState({});
  const [unitKindDraft, setUnitKindDraft] = useState({});
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [profileDraft, setProfileDraft] = useState({ name: '', title: '', email: '' });
  const [resetDraft, setResetDraft] = useState({});
  const [resetResult, setResetResult] = useState({});
  const [viewingUser, setViewingUser] = useState(null);
  const [removedUsers, setRemovedUsers] = useState([]);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState(null);
  const [managementUser, setManagementUser] = useState(null);
  const [accountControlUser, setAccountControlUser] = useState(null);
  const [usersOpen, setUsersOpen] = useState(false);

  async function load() {
    const r = await api('/users');
    setUsers(r.users);
  }
  async function loadRemoved() {
    try { setRemovedUsers((await api('/users/removed')).users); } catch (err) { toast(err.message, 'err'); }
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'err')); loadRemoved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  function startEdit(u) {
    setEditingId(u.id);
    setProfileDraft({ name: u.name, title: u.title || '', email: u.email });
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

  async function changeRole(u) {
    const role = roleDraft[u.id] ?? u.role;
    const scope = scopeDraft[u.id] || { type: u.scope_type || '', id: u.scope_id || '' };
    if (role === u.role && String(scope.type || '') === String(u.scope_type || '') && String(scope.id || '') === String(u.scope_id || '')) return;
    const scopeName = scopeLabel(scope.type, scope.id, org);
    if (!window.confirm(`Change ${u.name}'s role from "${u.role}" to "${role}"${scopeName ? ` and scope them to ${scopeName}` : ''}?`)) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/role`, { method: 'PATCH', body: { role, scopeType: scope.type || null, scopeId: scope.id ? Number(scope.id) : null } });
      toast(`${u.name}'s role changed to ${role}.`);
      await load();
      setManagementUser(null);
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
            profile, reset a forgotten password, change a role, or remove an account.
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
          <p className="text-[12px] text-ink-muted mt-1">Select an account to open its management popup.</p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-sunken border-b border-line">
              <tr>
                <th className="px-3 py-2 font-bold">User</th>
                <th className="px-3 py-2 font-bold">Email</th>
                <th className="px-3 py-2 font-bold">Title</th>
                <th className="px-3 py-2 font-bold">Role</th>
                <th className="px-3 py-2 font-bold">Organisation scope</th>
                <th className="px-3 py-2 font-bold">Manage</th>
              </tr>
            </thead>
            <tbody>
      {(filtered || []).map((u) => {
        const isSelf = u.id === me.id;
        const isEditing = editingId === u.id;
        const breadcrumb = scopeBreadcrumb(org, u);
        return (
          <>
          <tr key={`${u.id}-summary`} className="border-b border-line">
            <td className="px-3 py-2.5 min-w-44">
              {u.avatar ? (
                <button
                  type="button"
                  className="w-7 h-7 rounded-full flex-none cursor-zoom-in"
                  title={`View ${u.name}'s photo`}
                  // Sits inside a <summary> — clicking it would otherwise
                  // also toggle the details panel open/closed along with
                  // opening the lightbox, which reads as the row jumping
                  // around for no reason right as the photo view opens.
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setViewingUser(u); }}
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
            <td className="px-3 py-2.5 whitespace-nowrap">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setManagementUser(u);
                  setRoleDraft((draft) => ({ ...draft, [u.id]: u.role }));
                  setScopeDraft((draft) => ({ ...draft, [u.id]: { type: u.scope_type || '', id: u.scope_id || '' } }));
                  const unit = org.units.find((item) => item.id === Number(u.scope_id));
                  setUnitKindDraft((draft) => ({ ...draft, [u.id]: unit?.kind || 'All organisation units' }));
                }}
              >
                Select user
              </button>
            </td>
          </tr>
          <tr key={`${u.id}-details`} className="border-b border-line last:border-b-0">
            <td colSpan="6" className="p-0">
          <details className={accountControlUser === u.id ? 'fixed inset-4 m-auto z-50 bg-surface border border-line rounded-xl shadow-xl w-auto max-w-3xl max-h-[85vh] overflow-y-auto p-4' : 'bg-surface px-3.5 py-2.5'} open={accountControlUser === u.id}>
            <summary
              className="cursor-pointer text-[12px] font-semibold select-none text-ink-secondary"
              onClick={(e) => { e.preventDefault(); setAccountControlUser((current) => current === u.id ? null : u.id); }}
            >
              {accountControlUser === u.id ? 'Close account controls' : `View account controls for ${u.name}`}
            </summary>
            {accountControlUser === u.id && <div className="flex justify-end mt-2"><button type="button" className="btn btn-sm" onClick={() => setAccountControlUser(null)}>Close</button></div>}
            <div className="text-[11.3px] text-ink-muted mt-1.5">
              {u.email} · {u.title || '—'}
              {breadcrumb && breadcrumb.length > 0 && <span> · {breadcrumb.join(' › ')}</span>}
            </div>

            <div className="mt-3 pt-3 border-t border-line">
              {!isEditing && (
                <button className="btn btn-sm" onClick={() => startEdit(u)}>Edit profile</button>
              )}
              {isEditing && (
                <div className="max-w-md space-y-2.5">
                  <div className="space-y-1">
                    <label className="field-label">Full name</label>
                    <input className="field-input" value={profileDraft.name}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="field-label">Title</label>
                    <input className="field-input" value={profileDraft.title}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, title: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="field-label">Email</label>
                    <input type="email" className="field-input" value={profileDraft.email}
                      onChange={(e) => setProfileDraft((d) => ({ ...d, email: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-sm btn-primary" disabled={busyId === u.id || !profileDraft.name.trim() || !profileDraft.email.trim()} onClick={() => saveProfile(u)}>
                      Save profile
                    </button>
                    <button className="btn btn-sm" disabled={busyId === u.id} onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-line">
              <label className="field-label block mb-1">Password</label>
              {resetResult[u.id] && (
                <div className="mb-2 rounded-lg bg-good-soft text-good text-[12.3px] px-3 py-2 flex items-center gap-2 flex-wrap">
                  <span>New password: <b className="font-mono">{resetResult[u.id]}</b> — share it with {u.name} now, it won't be shown again.</span>
                  <button className="ml-auto text-good/70 hover:text-good font-bold" onClick={() => setResetResult((s) => { const n = { ...s }; delete n[u.id]; return n; })} aria-label="Dismiss">✕</button>
                </div>
              )}
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  className="field-input py-1.5 w-auto min-w-[180px]"
                  placeholder="New password (blank = generate one)"
                  value={resetDraft[u.id] || ''}
                  onChange={(e) => setResetDraft((s) => ({ ...s, [u.id]: e.target.value }))}
                />
                <button className="btn btn-sm" disabled={busyId === u.id} onClick={() => resetPassword(u)}>Reset password</button>
                {u.mfa_enabled && (
                  <button className="btn btn-sm btn-danger" disabled={busyId === u.id} onClick={() => resetMfa(u)}>
                    Turn off two-factor authentication
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2.5 mt-3.5 pt-3 border-t border-line">
              <div className="space-y-1">
                <label className="field-label">Overview navigation limit</label>
                <select
                  className="field-input py-1.5"
                  value={u.overview_limit || ''}
                  disabled={busyId === u.id}
                  onChange={(e) => setOverviewLimit(u, e.target.value)}
                >
                  {Object.entries(OVERVIEW_LIMIT_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer select-none pb-1.5">
                <input
                  type="checkbox"
                  checked={!!u.is_executive_owner}
                  disabled={busyId === u.id}
                  onChange={(e) => setExecutiveOwner(u, e.target.checked)}
                />
                Executive Owner
                <span className="text-ink-muted font-normal">(accountable for overall institutional performance)</span>
              </label>
            </div>

            {!isSelf && <div className="flex justify-end mt-3.5 pt-3 border-t border-line">
              <button className="btn btn-sm btn-danger" disabled={busyId === u.id} onClick={() => removeAccount(u)}>Remove account</button>
            </div>}
          </details>
            </td>
          </tr>
          </>
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
        roleDraft={roleDraft}
        setRoleDraft={setRoleDraft}
        scopeDraft={scopeDraft}
        setScopeDraft={setScopeDraft}
        unitKindDraft={unitKindDraft}
        setUnitKindDraft={setUnitKindDraft}
        busy={busyId === managementUser.id}
        onApply={changeRole}
        onRemoveIndividual={removeIndividual}
        onClose={() => setManagementUser(null)}
      />}

      {viewingUser && <PhotoLightbox src={viewingUser.avatar} name={viewingUser.name} onClose={() => setViewingUser(null)} />}
    </div>
  );
}

function UserManagementDialog({ user, me, org, roleDraft, setRoleDraft, scopeDraft, setScopeDraft, unitKindDraft, setUnitKindDraft, busy, onApply, onRemoveIndividual, onClose }) {
  const selectedRole = roleDraft[user.id] ?? user.role;
  const currentScope = scopeDraft[user.id] || { type: user.scope_type || '', id: user.scope_id || '' };
  const changed = selectedRole !== user.role
    || String(currentScope.type || '') !== String(user.scope_type || '')
    || String(currentScope.id || '') !== String(user.scope_id || '');
  const isSelf = user.id === me.id;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="user-management-dialog-title">
      <div className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="user-management-dialog-title" className="font-display font-bold text-[16px]">Manage {user.name}</h2>
            <p className="text-[12px] text-ink-muted">Change role and organisation scope here.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="field-label">Role</label>
            <select
              className="field-input"
              value={selectedRole}
              disabled={isSelf || busy}
              onChange={(e) => {
                const nextRole = e.target.value;
                setRoleDraft((draft) => ({ ...draft, [user.id]: nextRole }));
                const nextType = ROLE_SCOPE_TYPES[nextRole] || (nextRole === 'individual' && ['programme', 'sub', 'unit', 'individual'].includes(user.scope_type) ? user.scope_type : nextRole === 'individual' ? 'unit' : '');
                setScopeDraft((draft) => ({ ...draft, [user.id]: { type: nextType, id: nextType === user.scope_type ? user.scope_id : '' } }));
              }}
              aria-label={`Role for ${user.name}`}
            >
              {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </select>
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
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap mt-5 pt-3 border-t border-line">
          {user.role === 'individual' ? (
            <button className="btn btn-sm btn-danger" disabled={isSelf || busy} onClick={() => onRemoveIndividual(user)}>Remove Individual</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={isSelf || !changed || busy} onClick={() => onApply(user)}>Apply changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScopePicker({ user, org, scopeDraft, setScopeDraft, unitKindDraft, setUnitKindDraft, disabled = false }) {
  const current = scopeDraft[user.id] || { type: user.scope_type || '', id: user.scope_id || '' };
  const selectedUnit = org.units.find((unit) => unit.id === Number(current.id));
  const selectedKind = unitKindDraft[user.id] || selectedUnit?.kind || 'All organisation units';
  const options = current.type === 'programme' ? org.programmes
    : current.type === 'sub' ? org.subs
      : current.type === 'unit' ? org.units.filter((unit) => selectedKind === 'All organisation units' || unit.kind === selectedKind)
        : current.type === 'individual' ? org.individuals
          : [];
  function update(key, value) {
    setScopeDraft((draft) => ({ ...draft, [user.id]: { ...current, [key]: value } }));
  }
  return <div className="space-y-1">
    <label className="field-label">Organisation scope</label>
    <div className="flex gap-1.5 flex-wrap">
      <select className="field-input py-1.5" value={current.type} disabled={disabled} onChange={(e) => update('type', e.target.value)}>
        <option value="">No scope</option>
        <option value="unit">Unit / Department / Faculty / Region</option>
        <option value="programme">Programme</option>
        <option value="sub">Sub-programme</option>
        <option value="individual">Individual</option>
      </select>
      {current.type === 'unit' && <select
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
      {current.type && <select className="field-input py-1.5" value={current.id} disabled={disabled} onChange={(e) => update('id', e.target.value)}>
        <option value="">Select scope</option>
        {options.map((item) => <option key={item.id} value={item.id}>{current.type === 'individual' ? individualScopeLabel(item, org) : item.kind ? `${item.kind} — ${item.name}` : item.name}</option>)}
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
