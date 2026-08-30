import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { avatarClass, initialsOf, scopeBreadcrumb } from '../lib/scope.js';
import PhotoLightbox from '../components/PhotoLightbox.jsx';

const ROLES = ['exec', 'cpu', 'ictadmin', 'rep', 'unithead', 'individual', 'programme'];
const ROLE_LABEL = {
  exec: 'Executive', cpu: 'Corporate Planning Unit', ictadmin: 'ICT Systems Administrator',
  rep: 'Sub-programme Rep', unithead: 'Unit Head', individual: 'Individual', programme: 'Programme Head',
};

export default function Users() {
  const { user: me, org, refreshUser } = useApp();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [roleDraft, setRoleDraft] = useState({});
  // Which Programme to scope a "Programme Head" role-change to — only
  // relevant while the drafted role for that row is 'programme'; every
  // other role's scope is left untouched by a role change (unchanged
  // behaviour), since only Programme Head needs a picker here at all.
  const [programmeScopeDraft, setProgrammeScopeDraft] = useState({});
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [profileDraft, setProfileDraft] = useState({ name: '', title: '', email: '' });
  const [resetDraft, setResetDraft] = useState({});
  const [resetResult, setResetResult] = useState({});
  const [viewingUser, setViewingUser] = useState(null);

  async function load() {
    const r = await api('/users');
    setUsers(r.users);
    setCatalog(r.catalog);
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function toggle(userId, permKey, on) {
    try {
      await api(`/users/${userId}/permissions/${permKey}/${on ? 'revoke' : 'grant'}`, { method: 'POST' });
      toast((on ? 'Revoked ' : 'Granted ') + permKey + '.');
      await load();
    } catch (err) { toast(err.message, 'err'); }
  }

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
    if (role === u.role) return;
    let scopeType = u.scope_type;
    let scopeId = u.scope_id;
    if (role === 'programme') {
      const programmeId = programmeScopeDraft[u.id] ?? org.programmes[0]?.id;
      if (!programmeId) { toast('No Programmes exist to scope this account to.', 'err'); return; }
      scopeType = 'programme';
      scopeId = Number(programmeId);
    }
    const programmeName = role === 'programme' ? ` (${org.programmes.find((p) => p.id === scopeId)?.name})` : '';
    if (!window.confirm(`Change ${u.name}'s role from "${u.role}" to "${role}"${programmeName}? Their existing permission grants are left as-is — review them below afterwards.`)) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}/role`, { method: 'PATCH', body: { role, scopeType, scopeId } });
      toast(`${u.name}'s role changed to ${role}.`);
      await load();
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

  async function removeAccount(u) {
    if (!window.confirm(`Remove ${u.name}'s account entirely? This cannot be undone.`)) return;
    setBusyId(u.id);
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast(`${u.name}'s account removed.`);
      await load();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Permissions &amp; User Directory</h1>
          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            Every account in the system, with its full profile. Only ICT System Administrators can update a
            profile, reset a forgotten password, grant/revoke permissions, change a role, or remove an account.
          </p>
        </div>
        <input
          className="field-input w-auto min-w-[220px]"
          placeholder="Search name, email, role, unit…"
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

      {(filtered || []).map((u) => {
        const isSelf = u.id === me.id;
        const isEditing = editingId === u.id;
        const breadcrumb = scopeBreadcrumb(org, u);
        return (
          <details key={u.id} className="rounded-xl border border-line bg-surface px-3.5 py-2.5 mb-2" open={isEditing || undefined}>
            <summary className="cursor-pointer flex items-center gap-2.5 text-[12.8px] font-semibold select-none">
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
              <span className="text-ink-muted font-normal text-[12px]">({ROLE_LABEL[u.role]}{isSelf ? ' · you' : ''})</span>
              <span className="ml-auto chip chip-tag">{u.permissions.length} of {catalog.length} granted</span>
            </summary>
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
                  <button className="ml-auto text-good/70 hover:text-good font-bold" onClick={() => setResetResult((s) => { const n = { ...s }; delete n[u.id]; return n; })}>✕</button>
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
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {catalog.map((p) => {
                const on = u.permissions.includes(p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => toggle(u.id, p.key, on)}
                    className={`chip border cursor-pointer font-semibold ${on ? 'bg-good-soft text-good border-transparent' : 'bg-sunken text-ink-muted border-line'}`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {!isSelf && (
              <div className="flex flex-wrap items-end gap-2.5 mt-3.5 pt-3 border-t border-line">
                <div className="space-y-1">
                  <label className="field-label">Role</label>
                  <select
                    className="field-input py-1.5"
                    value={roleDraft[u.id] ?? u.role}
                    onChange={(e) => setRoleDraft((d) => ({ ...d, [u.id]: e.target.value }))}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </div>
                {(roleDraft[u.id] ?? u.role) === 'programme' && (
                  <div className="space-y-1">
                    <label className="field-label">Programme</label>
                    <select
                      className="field-input py-1.5"
                      value={programmeScopeDraft[u.id] ?? (u.scope_type === 'programme' ? u.scope_id : org.programmes[0]?.id) ?? ''}
                      onChange={(e) => setProgrammeScopeDraft((d) => ({ ...d, [u.id]: Number(e.target.value) }))}
                    >
                      {org.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
                <button className="btn btn-sm" disabled={busyId === u.id} onClick={() => changeRole(u)}>Change role</button>
                <button className="btn btn-sm btn-danger ml-auto" disabled={busyId === u.id} onClick={() => removeAccount(u)}>Remove account</button>
              </div>
            )}
          </details>
        );
      })}

      {viewingUser && <PhotoLightbox src={viewingUser.avatar} name={viewingUser.name} onClose={() => setViewingUser(null)} />}
    </div>
  );
}
