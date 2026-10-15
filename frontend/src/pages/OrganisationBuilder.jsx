import { Children, cloneElement, useEffect, useId, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { api } from '../lib/api.js';
import { byId } from '../lib/scope.js';

// Organisation Setup — the one place creation AND updating of the org
// structure happens: Programmes, Sub-programmes, Units/Departments/
// Faculties/Regions, and adding Employees. Split out of what used to be
// Organisation Maintenance's own bottom half (four bare creation forms with
// no way to correct a typo afterward short of deleting and recreating the
// whole thing) into its own dedicated page, deliberately distinct from:
//   - Framework — read-only org chart, everyone can see it
//   - Organisation Maintenance — the OTHER half of admin: removing something
//     (and, since the soft-delete rollout, restoring it from "Recently
//     Removed"), plus editing/role-changing an existing Employee
// so "build the structure" and "maintain/retire it" are two clearly
// separated concerns instead of one long scroll of unrelated forms.
//
// Deliberately simple navigation, not a wall of forms: a top-level
// Create/Update switch, then a second row picking which kind of entity —
// Programme, Sub-programme, Unit, or (Create only) Employee — with
// exactly ONE form visible at a time. Each option only appears at all if
// the caller actually holds a permission it would succeed against (see the
// three real, independently-grantable permissions below), so nobody is
// ever shown a switch that would just 403.
//
// Every "Create" button, for every entity, opens a small popup (see
// CreateEntityModal and AddAccountModal below) that closes itself the
// instant the create succeeds — nothing is ever created inline in the
// table any more. Update still edits a row in place (see cells()'s
// isEditing branch) — that's a deliberately different, unrelated flow.
//
// Real, independently-grantable permissions behind the two switches (see
// utils/permissions.js on the backend for the full rationale) — each is a
// narrower sibling of the broad manage_org_units, so ICT admin can hand
// someone exactly one slice of control instead of all of it:
//   - create_org_units — Create tab's Programme/Sub-programme/Unit popups
//   - edit_org_units   — the entire Update tab
//   - add_employee   — Create tab's "Add an account" popup (see
//                         AddAccountModal below): just a name + the email
//                         they'll sign in with via Microsoft — no role and
//                         no unit/department are ever picked here (see
//                         routes/org.js's POST /employees: every account
//                         this creates takes the same fixed, bare 'default'
//                         role; a Unit Head's own unit is inherited
//                         automatically, never asked). No own-scope
//                         restriction on the permission itself either.
// manage_org_units alone still covers all of the above, same as before. An
// Employee is delete-only once created — there is no Edit form for one,
// anywhere in this app (see Organisation Maintenance too).
export default function OrganisationBuilder() {
  const { user, org, hasPerm } = useApp();
  const canManage = hasPerm('manage_org_units');
  const canCreateUnits = canManage || hasPerm('create_org_units') || hasPerm('create_programmes') || hasPerm('create_subprogrammes') || hasPerm('create_units');
  const canEditUnits = canManage || hasPerm('edit_org_units') || hasPerm('edit_programmes') || hasPerm('edit_subprogrammes') || hasPerm('edit_units');
  const canAddEmployee = canManage || hasPerm('add_employee') || hasPerm('create_employees');
  const canEditEmployee = canManage || hasPerm('add_employee') || hasPerm('edit_employees');
  const canDeleteAny = canManage || hasPerm('delete_programmes') || hasPerm('delete_subprogrammes') || hasPerm('delete_units') || hasPerm('delete_employees');

  const createEntities = [
    canCreateUnits && { key: 'programme', label: 'Programme' },
    canCreateUnits && { key: 'sub', label: 'Sub-programme' },
    canCreateUnits && { key: 'unit', label: 'Unit / Department / Faculty / Region' },
    canAddEmployee && { key: 'employee', label: 'Employee' },
  ].filter(Boolean);
  const updateEntities = canEditUnits
    ? [{ key: 'programme', label: 'Programme' }, { key: 'sub', label: 'Sub-programme' }, { key: 'unit', label: 'Unit / Department / Faculty / Region' }]
    : [];

  const modes = [
    createEntities.length > 0 && { key: 'create', label: 'Create', entities: createEntities },
    updateEntities.length > 0 && { key: 'update', label: 'Update', entities: updateEntities },
  ].filter(Boolean);

  const [modeKey, setModeKey] = useState(modes[0]?.key);
  const mode = modes.find((m) => m.key === modeKey) || modes[0];
  const [entityKey, setEntityKey] = useState(mode?.entities[0]?.key);

  // Keeps the entity choice valid whenever the mode switches — e.g. leaving
  // "Employee" selected after flipping to Update (which has no Employee
  // option) would otherwise show nothing at all.
  useEffect(() => {
    if (mode && !mode.entities.some((e) => e.key === entityKey)) setEntityKey(mode.entities[0]?.key);
  }, [modeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (modes.length === 0 && !canDeleteAny) {
    return (
      <div>
        <div className="mb-5">
          <h1 className="text-xl font-bold mb-0.5">Organisation Setup</h1>
          <p className="text-[13px] text-ink-secondary">Create and update Programmes, Sub-programmes, Units, and add Employees.</p>
        </div>
        <div className="card text-center text-ink-muted py-10">
          You don't hold a permission that manages this. Ask an ICT System Administrator for "Create Programmes /
          Sub-programmes / Units", "Update existing Programmes / Sub-programmes / Units", or "Add an Employee" if
          you need access here.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Organisation Setup</h1>
        <p className="text-[13px] text-ink-secondary max-w-[72ch]">
          Pick Create or Update, then what you're working on. An Employee, once added, can only be removed — not
          edited — from here or anywhere else; add a fresh one instead if a detail needs correcting. Removing
          something, restoring something you removed, or re-assigning an existing account's role happens on{' '}
          <span className="font-semibold text-ink-secondary">Organisation Maintenance</span>.
        </p>
      </div>

      <OrganisationTable
        org={org}
        user={user}
        canManage={canManage}
        canCreateUnits={canCreateUnits}
        canEditUnits={canEditUnits}
        canAddEmployee={canAddEmployee}
        canEditEmployee={canEditEmployee}
        hasPerm={hasPerm}
      />
    </div>
  );
}

function OrganisationTable({ org, user, canManage, canCreateUnits, canEditUnits, canAddEmployee, canEditEmployee, hasPerm }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { reloadCore } = useApp();
  const entities = [
    canCreateUnits || canEditUnits || canManage ? { key: 'programme', label: 'Programmes' } : null,
    canCreateUnits || canEditUnits || canManage ? { key: 'sub', label: 'Sub-programmes' } : null,
    canCreateUnits || canEditUnits || canManage ? { key: 'unit', label: 'Units/Departments/Faculties/Regions' } : null,
    canAddEmployee || canManage ? { key: 'employee', label: 'Employees' } : null,
  ].filter(Boolean);
  const [entityKey, setEntityKey] = useState(entities[0]?.key);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Starts collapsed — a click on the header is required to view the
  // organisation table, same as every other collapsible table in the app.
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Every "Create" flow is its own popup, entirely separate from the
  // `draft`/`editingId` state below — that state now belongs exclusively
  // to the Update tab's edit-in-place row (see cells()'s isEditing branch).
  // Employee ("Add an account") and Programme/Sub-programme/Unit use two
  // different popup components (different fields, different endpoints)
  // but the same open/close pattern — see AddAccountModal and
  // CreateEntityModal below.
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showCreateEntity, setShowCreateEntity] = useState(false);

  const canCreate = entityKey === 'employee' ? canAddEmployee : entityKey === 'programme' ? canManage || hasPerm('create_programmes') || hasPerm('create_org_units') : entityKey === 'sub' ? canManage || hasPerm('create_subprogrammes') || hasPerm('create_org_units') : canManage || hasPerm('create_units') || hasPerm('create_org_units');
  // An Employee is delete-only, always — there is no PATCH /org/
  // employees/:id route any more (see routes/org.js's big comment above
  // POST /employees), regardless of what edit_employees/add_employee
  // grants say. canEditEmployee is accepted as a prop for backward
  // compatibility with callers but deliberately never drives this.
  const canEdit = entityKey === 'employee' ? false : entityKey === 'programme' ? canManage || hasPerm('edit_programmes') || hasPerm('edit_org_units') : entityKey === 'sub' ? canManage || hasPerm('edit_subprogrammes') || hasPerm('edit_org_units') : canManage || hasPerm('edit_units') || hasPerm('edit_org_units');
  const canDelete = entityKey === 'programme' ? canManage || hasPerm('delete_programmes') : entityKey === 'sub' ? canManage || hasPerm('delete_subprogrammes') : entityKey === 'unit' ? canManage || hasPerm('delete_units') : canManage || hasPerm('delete_employees');
  const rows = org[entityKey === 'sub' ? 'subs' : `${entityKey}s`] || [];
  const filteredRows = rows.filter((row) => {
    const parent = parentLabel(row);
    const values = [row.name, row.head, row.role_title, row.kind, row.unit_label, parent];
    return values.some((value) => String(value || '').toLowerCase().includes(search.trim().toLowerCase()));
  });
  const eligibleUnits = canManage
    ? org.units
    : user.role === 'unithead'
      ? org.units.filter((u) => u.id === user.scope_id)
      : org.units.filter((u) => u.sub_id === user.scope_id);

  function parentLabel(row) {
    if (entityKey === 'sub') return byId(org.programmes, row.programme_id)?.name || '—';
    if (entityKey === 'unit') return byId(org.subs, row.sub_id)?.name || '—';
    if (entityKey === 'employee') return byId(org.units, row.unit_id)?.name || '—';
    return '—';
  }

  // Every entity's Create button opens a popup now — Employee gets its own
  // (AddAccountModal), Programme/Sub-programme/Unit share CreateEntityModal.
  // Neither one touches `draft`/`editingId`, which are Update-only now.
  function startCreate() {
    if (entityKey === 'employee') { setShowAddAccount(true); return; }
    setShowCreateEntity(true);
  }

  // Employees are delete-only (see canEdit above) — this never actually
  // runs for entityKey === 'employee' since no Edit control is rendered
  // for one, but the guard makes that explicit rather than implicit.
  function startEdit(row) {
    if (!canEdit || entityKey === 'employee') return;
    if (entityKey === 'programme') setDraft({ name: row.name, head: row.head });
    if (entityKey === 'sub') setDraft({ programmeId: row.programme_id, name: row.name, head: row.head, unitLabel: row.unit_label || 'Unit' });
    if (entityKey === 'unit') setDraft({ subId: row.sub_id, name: row.name, kind: row.kind || 'Unit', head: row.head });
    setEditingId(row.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  // Update's edit-in-place save only, now — every Create flow (Employee's
  // AddAccountModal, Programme/Sub/Unit's CreateEntityModal) posts on its
  // own below instead of going through this function.
  async function save(row) {
    setBusyId(row.id);
    try {
      const endpoint = entityKey === 'programme' ? '/org/programmes'
        : entityKey === 'sub' ? '/org/subs' : '/org/units';
      const body = entityKey === 'unit'
        ? { subId: Number(draft.subId), name: draft.name, kind: draft.kind, head: draft.head }
        : entityKey === 'sub'
          ? { programmeId: Number(draft.programmeId), name: draft.name, head: draft.head, unitLabel: draft.unitLabel }
          : { name: draft.name, head: draft.head };
      await api(`${endpoint}/${row.id}`, { method: 'PATCH', body });
      toast(`"${draft.name}" updated.`);
      cancelEdit();
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function remove(row) {
    if (!canDelete) return;
    if (!(await confirm({ title: `Remove "${row.name}"?`, message: 'This is recoverable from Recently Removed.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    setBusyId(row.id);
    try {
      await api(`/org/${entityKey === 'sub' ? 'subs' : `${entityKey}s`}/${row.id}`, { method: 'DELETE' });
      toast(`"${row.name}" removed.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  function updateDraft(key, value) { setDraft((current) => ({ ...current, [key]: value })); }

  // `head` is optional/legacy now (see routes/org.js's comment above POST
  // /programmes) — a fresh Programme/Sub-programme/Unit has none at all, so
  // this can't be `required` unconditionally the way it used to be, or
  // renaming one that has no head would be blocked until someone typed one
  // in just to satisfy the form.
  function input(key, type = 'text', required = true) {
    return <input required={required} className="field-input min-w-32" type={type} value={draft[key] ?? ''} onChange={(e) => updateDraft(key, e.target.value)} />;
  }

  function select(key, options) {
    return <select className="field-input min-w-36" value={draft[key] ?? ''} onChange={(e) => updateDraft(key, e.target.value)}>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>;
  }

  function cells(row) {
    const isEditing = editingId === row.id;
    const values = isEditing ? draft : row;
    return (
      <>
        <td className="px-3 py-2.5 font-semibold">{isEditing ? input('name') : row.name}</td>
        <td className="px-3 py-2.5">{isEditing && entityKey !== 'programme' ? (
          entityKey === 'sub' ? select('programmeId', org.programmes) : entityKey === 'unit' ? select('subId', org.subs) : select('unitId', eligibleUnits)
        ) : parentLabel(row)}</td>
        <td className="px-3 py-2.5">{isEditing ? input('head', 'text', false) : (values.head || values.role_title || '—')}</td>
        <td className="px-3 py-2.5">{isEditing && entityKey === 'unit' ? input('kind') : (row.kind || '—')}</td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {isEditing ? (
            <span className="flex gap-1"><button className="btn btn-sm btn-primary" disabled={busyId === row.id} onClick={() => save(row)}>Save</button><button className="btn btn-sm" onClick={cancelEdit}>Cancel</button></span>
          ) : (
            <span className="flex gap-1">
              {/* An Employee is delete-only — no Edit control at all, not
                  just a disabled one, for any Employee account regardless
                  of how it was created (see routes/org.js). */}
              {entityKey !== 'employee' && <button className="btn btn-sm" disabled={!canEdit} onClick={() => startEdit(row)}>Edit</button>}
              {canDelete && <button className="btn btn-sm btn-danger" disabled={busyId === row.id} onClick={() => remove(row)}>Delete</button>}
            </span>
          )}
        </td>
      </>
    );
  }

  return (
    <div className="card mt-4">
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => { setOpen((value) => !value); if (open) { cancelEdit(); setSearch(''); } }} aria-expanded={open}>
        <span className="font-display font-bold text-[14px]">Organisation structure <span className="chip">{rows.length}</span></span>
        <span className="text-accent-600 font-semibold text-[12px]">{open ? 'Hide ▲' : 'Click to view ▼'}</span>
      </button>
      <p className="text-[12px] text-ink-muted mt-1">Manage records in the table below, or click to collapse it.</p>
      {open && <div className="mt-3">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
          <div className="flex gap-1.5 flex-wrap">{entities.map((entity) => <NavButton key={entity.key} active={entity.key === entityKey} onClick={() => { cancelEdit(); setEntityKey(entity.key); }}>{entity.label}</NavButton>)}</div>
          {canCreate && <button className="btn btn-primary btn-sm" onClick={startCreate}>{entityKey === 'employee' ? 'Add an account' : `Create ${entities.find((entity) => entity.key === entityKey)?.label.slice(0, -1)}`}</button>}
        </div>
        <div className="mb-3">
          <label className="field-label block mb-1">Search organisation records</label>
          <input type="search" className="field-input w-full" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, parent, head, role or type…" aria-label="Search organisation records" />
        </div>
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-sunken border-b border-line sticky top-0 z-10"><tr><th className="px-3 py-2 font-bold">Name</th><th className="px-3 py-2 font-bold">Parent / Unit</th><th className="px-3 py-2 font-bold">Head / Role</th><th className="px-3 py-2 font-bold">Type</th><th className="px-3 py-2 font-bold">Actions</th></tr></thead>
            <tbody>{filteredRows.length === 0 ? <tr><td colSpan="5" className="px-3 py-6 text-center text-ink-muted">{rows.length === 0 ? `No ${entities.find((entity) => entity.key === entityKey)?.label.toLowerCase()} yet.` : 'No records match your search.'}</td></tr> : filteredRows.map((row) => <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-sunken/60">{cells(row)}</tr>)}</tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-ink-muted">Showing {filteredRows.length} of {rows.length} {entities.find((entity) => entity.key === entityKey)?.label.toLowerCase()}.</div>
      </div>}
      {showAddAccount && <AddAccountModal onClose={() => setShowAddAccount(false)} />}
      {showCreateEntity && <CreateEntityModal entityKey={entityKey} org={org} onClose={() => setShowCreateEntity(false)} />}
    </div>
  );
}

// Escape-to-close for the popup below — same pattern KpiManagement.jsx's
// own Create KPI popup uses (that page has no shared Modal component to
// pull it from either, so each page that needs one keeps a small local
// copy — see its own comment for the convention).
function useEscapeToClose(onClose) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// "Add an account" — its own popup, opened from the Employees tab's create
// button (see startCreate above) and closed automatically the moment a
// create succeeds; onClose is only ever called after a successful submit,
// or when the person explicitly backs out (✕, backdrop click, Escape), so
// a genuinely-created account never leaves the dialog hanging around
// behind it — same pattern KpiManagement.jsx's own Create KPI popup
// already established. Deliberately just two fields: no role and no unit
// are ever picked here. See routes/org.js's POST /employees for what
// actually happens with them — every account created this way takes the
// same fixed, bare 'default' role; only which unit it's filed under (if
// any) is inferred automatically from who's submitting this form.
function AddAccountModal({ onClose }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  useEscapeToClose(onClose);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api('/org/employees', { method: 'POST', body: { name, email } });
      toast(`"${name}" added. Account: ${result.account.email} (${result.account.note})`);
      await reloadCore();
      onClose();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <div className="w-full max-w-md rounded-xl bg-surface border border-line shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 id="add-account-title" className="font-display font-bold text-[14.5px]">Add an account</h2>
          <button type="button" className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          <Field label="Name"><input required autoFocus className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><input required type="email" placeholder="name@zou.ac.zw" className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <p className="text-[11.5px] text-ink-muted max-w-[48ch]">
            No role or department is chosen here — this account starts out bare and read-only, signing in with
            "Sign in with Microsoft" using this exact email address. Give it a real role from the
            Permissions &amp; Roles page's "Assign Roles to Users" once it exists.
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy || !name.trim() || !email.trim()}>{busy ? 'Adding…' : 'Add account'}</button>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// "Create Programme / Sub-programme / Unit" — the Create tab's popup for
// every entity except Employee (which has its own AddAccountModal just
// above, with different fields entirely). Same pattern: its own local
// state, entirely separate from the Update tab's `draft`/`editingId`, and
// onClose is only ever called after a genuinely successful create, or when
// the person explicitly backs out (✕, backdrop click, Escape) — never left
// open behind a record that was actually created.
//
// Deliberately minimal, name-first fields — no "Head" box anywhere here any
// more: a Programme/Sub-programme/Unit Head is a role appointment now, made
// afterward from the Permissions & Roles page's single "Assign role &
// scope" (see Permissions.jsx), scoped to whatever was just created here —
// never text typed in at creation time. Which fields show up is driven by
// `entityKey`:
//   - Programme: Name only.
//   - Sub-programme: which Programme it falls under, + Name only (no Head,
//     no Unit label picker — unit_label defaults to "Unit" server-side and
//     can still be corrected from the Update tab if a Sub-programme's Units
//     are actually called something else).
//   - Unit/Department/Faculty/Regional Campus: which Sub-programme it falls
//     under, + Name, + a Type dropdown (no free-text Kind box, no Head).
function CreateEntityModal({ entityKey, org, onClose }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  useEscapeToClose(onClose);
  const [name, setName] = useState('');
  const [programmeId, setProgrammeId] = useState(org.programmes[0]?.id || '');
  const [subId, setSubId] = useState(org.subs[0]?.id || '');
  const [kind, setKind] = useState(CREATE_UNIT_TYPES[0]);
  const [busy, setBusy] = useState(false);

  const label = entityKey === 'programme' ? 'Programme' : entityKey === 'sub' ? 'Sub-programme' : 'Unit / Faculty / Department / Regional Campus';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const endpoint = entityKey === 'programme' ? '/org/programmes' : entityKey === 'sub' ? '/org/subs' : '/org/units';
      const body = entityKey === 'programme'
        ? { name }
        : entityKey === 'sub'
          ? { programmeId: Number(programmeId), name }
          : { subId: Number(subId), name, kind };
      await api(endpoint, { method: 'POST', body });
      toast(`${name} created.`);
      await reloadCore();
      onClose();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="create-entity-title">
      <div className="w-full max-w-md rounded-xl bg-surface border border-line shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 id="create-entity-title" className="font-display font-bold text-[14.5px]">Create {label}</h2>
          <button type="button" className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          {entityKey === 'sub' && (
            <Field label="Programme">
              <select required className="field-input" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
                {org.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          {entityKey === 'unit' && (
            <Field label="Sub-programme it falls under">
              <select required className="field-input" value={subId} onChange={(e) => setSubId(e.target.value)}>
                {org.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {entityKey === 'unit' && (
            <Field label="Type">
              <select className="field-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                {CREATE_UNIT_TYPES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
          )}
          <Field label="Name"><input required autoFocus className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <p className="text-[11.5px] text-ink-muted max-w-[48ch]">
            No Head is chosen here — appoint one afterward from the Permissions &amp; Roles page's "Assign role &amp;
            scope", scoped to this {label.toLowerCase()} once it exists.
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy || !name.trim() || (entityKey === 'sub' && !programmeId) || (entityKey === 'unit' && !subId)}>{busy ? 'Creating…' : `Create ${label}`}</button>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// The exact four Types this request asks for on the Unit creation popup's
// dropdown — a subset/ordering distinct from UNIT_KINDS below (which also
// includes plain "Region" and feeds the Update tab's own Kind picker and
// the legacy standalone forms further down this file); kept as its own
// constant so this specific dropdown matches what was asked for without
// reshaping the taxonomy used anywhere else.
const CREATE_UNIT_TYPES = ['Unit', 'Faculty', 'Department', 'Regional Campus'];

// Same active/inactive visual language as the sidebar nav itself
// (components/Layout.jsx) — reused here on purpose so this in-page
// navigation reads as an extension of the app's own nav, not a new pattern.
function NavRow({ sub, children }) {
  return <div className={`flex gap-1.5 flex-wrap ${sub ? 'mb-5' : 'mb-3'}`}>{children}</div>;
}
function NavButton({ active, sub, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 rounded-lg font-semibold text-left transition-colors
        ${sub ? 'py-1.5 text-[12.5px]' : 'py-2 text-[13.5px]'}
        ${active ? 'bg-accent-50 text-accent-600' : 'text-ink-secondary bg-sunken hover:bg-line/60'}`}
    >
      {children}
    </button>
  );
}

// NOTE: this used to also carry six standalone Create/Update form
// components for Programme/Sub-programme/Unit (CreateProgrammeForm,
// UpdateProgrammeForm, CreateSubForm, UpdateSubForm, CreateUnitForm,
// UpdateUnitForm) plus their own UNIT_KINDS list. They were already dead
// code — superseded by CreateEntityModal above and the Update tab's
// edit-in-place row (see OrganisationTable's cells()) — and every one of
// them still required a "Head" field, so removing them here rather than
// reworking them keeps this file free of any lingering head-requiring path.
//
// NOTE: employee creation no longer has a standalone form component here
// — it's its own popup now (see AddAccountModal above, and `canAddEmployee`
// in the main component). There is deliberately no own-scope restriction on
// it any more either: since no Employee is ever
// assigned a unit/department by default (see POST /employees), there is no unit
// left to scope the picker against, so add_employee now behaves the same
// everywhere it's granted rather than needing a narrower own-scope variant.

// Every call site below wraps exactly one real input/select, so this can
// generate one stable id per Field instance (useId) and wire it onto both
// the <label>'s htmlFor and the child's id automatically, rather than
// needing every call site edited by hand. Falls back to an unassociated
// (but still visually identical) label if a caller ever passes something
// Field can't safely clone a prop onto, instead of crashing.
function Field({ label, children, full }) {
  const generatedId = useId();
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const child = only && typeof only === 'object' && only.type ? only : null;
  const inputId = child ? (child.props.id || generatedId) : undefined;
  return (
    <div className={`space-y-1 ${full ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={inputId} className="field-label">{label}</label>
      {child ? cloneElement(child, { id: inputId }) : children}
    </div>
  );
}
