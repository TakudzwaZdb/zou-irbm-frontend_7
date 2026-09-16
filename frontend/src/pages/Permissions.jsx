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
  const [users, setUsers] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState('');
  const [usersOpen, setUsersOpen] = useState(false);

  async function load() {
    const result = await api('/users');
    setUsers(result.users);
    setCatalog(Array.isArray(result.catalog) ? result.catalog : []);
  }

  useEffect(() => { load().catch((error) => toast(error.message, 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!users) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => [user.name, user.email, user.role, ROLE_LABEL[user.role]].join(' ').toLowerCase().includes(needle));
  }, [users, q]);

  const selectedUser = filtered?.find((user) => user.id === selectedId) || users?.find((user) => user.id === selectedId) || null;

  useEffect(() => {
    if (!selectedUser) return undefined;
    function closeOnEscape(event) {
      if (event.key === 'Escape') setSelectedId(null);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [selectedUser]);

  async function toggle(user, permission) {
    const enabled = user.permissions.includes(permission.key);
    try {
      const result = await api(`/users/${user.id}/permissions/${permission.key}/${enabled ? 'revoke' : 'grant'}`, { method: 'POST' });
      const hasPermission = result.user?.permissions?.includes(permission.key);
      if (hasPermission !== !enabled) throw new Error(`The server did not confirm that ${permission.key} was ${enabled ? 'revoked' : 'granted'}.`);
      toast(`${enabled ? 'Revoked' : 'Granted'} ${permission.key}.`);
      await load();
    } catch (error) { toast(error.message, 'err'); }
  }

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Permissions</h1>
          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            Grant or revoke individual permissions independently from a user&apos;s role.
          </p>
        </div>
        <input
          className="field-input w-auto min-w-[220px]"
          placeholder="Search name, email, role…"
          aria-label="Search users"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {users && <p className="text-[11.8px] text-ink-muted mb-2.5">
        Showing {filtered.length} of {users.length} account{users.length === 1 ? '' : 's'}{q.trim() ? ` matching "${q.trim()}"` : ''}.
      </p>}

      <div className="card overflow-hidden">
        <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => setUsersOpen((open) => !open)} aria-expanded={usersOpen}>
          <span className="font-display font-bold text-[14px] flex items-center gap-2">
            Users
            <span className="chip">{filtered?.length || 0}</span>
          </span>
          <span className="text-ink-muted text-[12px]">{usersOpen ? 'Hide ▲' : 'Click to view ▼'}</span>
        </button>
        {usersOpen && <>
        <p className="text-[12px] text-ink-muted mt-1">Click a user to view or manage their permissions.</p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-sunken border-b border-line">
              <tr><th className="px-3 py-2 font-bold">User</th><th className="px-3 py-2 font-bold">Role</th><th className="px-3 py-2 font-bold">Granted</th></tr>
            </thead>
            <tbody>
              {(filtered || []).map((user) => (
                <tr key={user.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-left font-semibold hover:text-accent-600" onClick={() => setSelectedId((current) => current === user.id ? null : user.id)}>
                      {user.name}
                    </button>
                    <div className="text-ink-muted">{user.email}</div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-secondary">{ROLE_LABEL[user.role] || user.role}</td>
                  <td className="px-3 py-2.5">{user.permissions.length} of {catalog.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>}
      </div>

      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="permissions-dialog-title" onMouseDown={() => setSelectedId(null)}>
          <div className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-4" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 id="permissions-dialog-title" className="font-display font-bold text-[16px]">Permissions for {selectedUser.name}</h2>
                <p className="text-[12px] text-ink-muted">{ROLE_LABEL[selectedUser.role] || selectedUser.role} · {selectedUser.email}</p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setSelectedId(null)}>Close</button>
            </div>
            <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-line">
              <span className="text-[12px] text-ink-muted">Toggle access for this account.</span>
              <span className="chip">{selectedUser.permissions.length} granted</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-sunken border-b border-line">
                  <tr><th className="px-3 py-2 font-bold">Permission</th><th className="px-3 py-2 font-bold">Group</th><th className="px-3 py-2 font-bold">Status</th></tr>
                </thead>
                <tbody>
                  {catalog.map((permission) => {
                    const enabled = selectedUser.permissions.includes(permission.key);
                    return (
                      <tr key={permission.key} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 text-ink-secondary">{permission.label}</td>
                        <td className="px-3 py-2 text-ink-muted">{permission.group}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => toggle(selectedUser, permission)} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${enabled ? 'bg-good-soft text-good border-transparent' : 'bg-sunken text-ink-muted border-line'}`}>
                            {enabled ? 'Granted' : 'Not granted'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
