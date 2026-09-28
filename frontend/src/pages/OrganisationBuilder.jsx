import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { byId } from '../lib/scope.js';

// Organisation Setup — the one place creation AND updating of the org
// structure happens: Programmes, Sub-programmes, Units/Departments/
// Faculties/Regions, and adding Individuals. Split out of what used to be
// Organisation Maintenance's own bottom half (four bare creation forms with
// no way to correct a typo afterward short of deleting and recreating the
// whole thing) into its own dedicated page, deliberately distinct from:
//   - Framework — read-only org chart, everyone can see it
//   - Organisation Maintenance — the OTHER half of admin: removing something
//     (and, since the soft-delete rollout, restoring it from "Recently
//     Removed"), plus editing/role-changing an existing Individual
// so "build the structure" and "maintain/retire it" are two clearly
// separated concerns instead of one long scroll of unrelated forms.
//
// Deliberately simple navigation, not a wall of forms: a top-level
// Create/Update switch, then a second row picking which kind of entity —
// Programme, Sub-programme, Unit, or (Create only) Individual — with
// exactly ONE form visible at a time. Each option only appears at all if
// the caller actually holds a permission it would succeed against (see the
// three real, independently-grantable permissions below), so nobody is
// ever shown a switch that would just 403.
//
// Real, independently-grantable permissions behind the two switches (see
// utils/permissions.js on the backend for the full rationale) — each is a
// narrower sibling of the broad manage_org_units, so ICT admin can hand
// someone exactly one slice of control instead of all of it:
//   - create_org_units — Create tab's Programme/Sub-programme/Unit forms
//   - edit_org_units   — the entire Update tab
//   - add_individual   — Create tab's Individual form: name + the email
//                         they'll sign in with via Microsoft, no unit/
//                         department (none is ever assigned) and no
//                         own-scope restriction any more, since there's no
//                         unit left to scope against — see routes/org.js's
//                         POST /individuals.
// manage_org_units alone still covers all of the above, same as before. An
// Individual is delete-only once created — there is no Edit form for one,
// anywhere in this app (see Organisation Maintenance too).
export default function OrganisationBuilder() {
  const { user, org, hasPerm } = useApp();
  const canManage = hasPerm('manage_org_units');
  const canCreateUnits = canManage || hasPerm('create_org_units') || hasPerm('create_programmes') || hasPerm('create_subprogrammes') || hasPerm('create_units');
  const canEditUnits = canManage || hasPerm('edit_org_units') || hasPerm('edit_programmes') || hasPerm('edit_subprogrammes') || hasPerm('edit_units');
  const canAddIndividual = canManage || hasPerm('add_individual') || hasPerm('create_individuals');
  const canEditIndividual = canManage || hasPerm('add_individual') || hasPerm('edit_individuals');
  const canDeleteAny = canManage || hasPerm('delete_programmes') || hasPerm('delete_subprogrammes') || hasPerm('delete_units') || hasPerm('delete_individuals');

  const createEntities = [
    canCreateUnits && { key: 'programme', label: 'Programme' },
    canCreateUnits && { key: 'sub', label: 'Sub-programme' },
    canCreateUnits && { key: 'unit', label: 'Unit / Department / Faculty / Region' },
    canAddIndividual && { key: 'individual', label: 'Individual' },
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
  // "Individual" selected after flipping to Update (which has no Individual
  // option) would otherwise show nothing at all.
  useEffect(() => {
    if (mode && !mode.entities.some((e) => e.key === entityKey)) setEntityKey(mode.entities[0]?.key);
  }, [modeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (modes.length === 0 && !canDeleteAny) {
    return (
      <div>
        <div className="mb-5">
          <h1 className="text-xl font-bold mb-0.5">Organisation Setup</h1>
          <p className="text-[13px] text-ink-secondary">Create and update Programmes, Sub-programmes, Units, and add Individuals.</p>
        </div>
        <div className="card text-center text-ink-muted py-10">
          You don't hold a permission that manages this. Ask an ICT System Administrator for "Create Programmes /
          Sub-programmes / Units", "Update existing Programmes / Sub-programmes / Units", or "Add an Individual" if
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
          Pick Create or Update, then what you're working on. An Individual, once added, can only be removed — not
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
        canAddIndividual={canAddIndividual}
        canEditIndividual={canEditIndividual}
        hasPerm={hasPerm}
      />
    </div>
  );
}

function OrganisationTable({ org, user, canManage, canCreateUnits, canEditUnits, canAddIndividual, canEditIndividual, hasPerm }) {
  const toast = useToast();
  const { reloadCore } = useApp();
  const entities = [
    canCreateUnits || canEditUnits || canManage ? { key: 'programme', label: 'Programmes' } : null,
    canCreateUnits || canEditUnits || canManage ? { key: 'sub', label: 'Sub-programmes' } : null,
    canCreateUnits || canEditUnits || canManage ? { key: 'unit', label: 'Units/Departments/Faculties/Regions' } : null,
    canAddIndividual || canManage ? { key: 'individual', label: 'Individuals' } : null,
  ].filter(Boolean);
  const [entityKey, setEntityKey] = useState(entities[0]?.key);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const canCreate = entityKey === 'individual' ? canAddIndividual : entityKey === 'programme' ? canManage || hasPerm('create_programmes') || hasPerm('create_org_units') : entityKey === 'sub' ? canManage || hasPerm('create_subprogrammes') || hasPerm('create_org_units') : canManage || hasPerm('create_units') || hasPerm('create_org_units');
  // An Individual is delete-only, always — there is no PATCH /org/
  // individuals/:id route any more (see routes/org.js's big comment above
  // POST /individuals), regardless of what edit_individuals/add_individual
  // grants say. canEditIndividual is accepted as a prop for backward
  // compatibility with callers but deliberately never drives this.
  const canEdit = entityKey === 'individual' ? false : entityKey === 'programme' ? canManage || hasPerm('edit_programmes') || hasPerm('edit_org_units') : entityKey === 'sub' ? canManage || hasPerm('edit_subprogrammes') || hasPerm('edit_org_units') : canManage || hasPerm('edit_units') || hasPerm('edit_org_units');
  const canDelete = entityKey === 'programme' ? canManage || hasPerm('delete_programmes') : entityKey === 'sub' ? canManage || hasPerm('delete_subprogrammes') : entityKey === 'unit' ? canManage || hasPerm('delete_units') : canManage || hasPerm('delete_individuals');
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
    if (entityKey === 'individual') return byId(org.units, row.unit_id)?.name || '—';
    return '—';
  }

  function emptyDraft() {
    if (entityKey === 'programme') return { name: '', head: '' };
    if (entityKey === 'sub') return { programmeId: org.programmes[0]?.id || '', name: '', head: '', unitLabel: 'Unit' };
    if (entityKey === 'unit') return { subId: org.subs[0]?.id || '', name: '', kind: 'Unit', head: '' };
    // Individual: name + the email they'll sign in with via Microsoft —
    // deliberately no unit/department (none is ever assigned) and no role
    // title (every Individual created here gets the fixed 'default',
    // read-only role — see routes/org.js's POST /individuals).
    return { name: '', email: '' };
  }

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setCreating(true);
  }

  // Individuals are delete-only (see canEdit above) — this never actually
  // runs for entityKey === 'individual' since no Edit control is rendered
  // for one, but the guard makes that explicit rather than implicit.
  function startEdit(row) {
    if (!canEdit || entityKey === 'individual') return;
    if (entityKey === 'programme') setDraft({ name: row.name, head: row.head });
    if (entityKey === 'sub') setDraft({ programmeId: row.programme_id, name: row.name, head: row.head, unitLabel: row.unit_label || 'Unit' });
    if (entityKey === 'unit') setDraft({ subId: row.sub_id, name: row.name, kind: row.kind || 'Unit', head: row.head });
    setCreating(false);
    setEditingId(row.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setCreating(false);
  }

  async function save(row) {
    setBusyId(row?.id || 'new');
    try {
      const endpoint = entityKey === 'programme' ? '/org/programmes'
        : entityKey === 'sub' ? '/org/subs'
          : entityKey === 'unit' ? '/org/units' : '/org/individuals';
      const body = entityKey === 'individual'
        ? { name: draft.name, email: draft.email }
        : entityKey === 'unit'
          ? { subId: Number(draft.subId), name: draft.name, kind: draft.kind, head: draft.head }
          : entityKey === 'sub'
            ? { programmeId: Number(draft.programmeId), name: draft.name, head: draft.head, unitLabel: draft.unitLabel }
            : { name: draft.name, head: draft.head };
      const result = await api(row ? `${endpoint}/${row.id}` : endpoint, { method: row ? 'PATCH' : 'POST', body });
      const account = result.headAccount || result.repAccount || result.account;
      toast(row ? `"${draft.name}" updated.` : `${draft.name} created${account ? `. Account: ${account.email} (${account.note})` : '.'}`);
      cancelEdit();
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function remove(row) {
    if (!canDelete) return;
    if (!window.confirm(`Remove "${row.name}"? This is recoverable from Recently Removed.`)) return;
    setBusyId(row.id);
    try {
      await api(`/org/${entityKey === 'sub' ? 'subs' : `${entityKey}s`}/${row.id}`, { method: 'DELETE' });
      toast(`"${row.name}" removed.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  function updateDraft(key, value) { setDraft((current) => ({ ...current, [key]: value })); }

  function input(key, type = 'text') {
    return <input required className="field-input min-w-32" type={type} value={draft[key] ?? ''} onChange={(e) => updateDraft(key, e.target.value)} />;
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
        <td className="px-3 py-2.5">{isEditing ? input('head') : (values.head || values.role_title || '—')}</td>
        <td className="px-3 py-2.5">{isEditing && entityKey === 'unit' ? input('kind') : (row.kind || '—')}</td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {isEditing ? (
            <span className="flex gap-1"><button className="btn btn-sm btn-primary" disabled={busyId === row.id} onClick={() => save(row)}>Save</button><button className="btn btn-sm" onClick={cancelEdit}>Cancel</button></span>
          ) : (
            <span className="flex gap-1">
              {/* An Individual is delete-only — no Edit control at all, not
                  just a disabled one, for any Individual account regardless
                  of how it was created (see routes/org.js). */}
              {entityKey !== 'individual' && <button className="btn btn-sm" disabled={!canEdit} onClick={() => startEdit(row)}>Edit</button>}
              {canDelete && <button className="btn btn-sm btn-danger" disabled={busyId === row.id} onClick={() => remove(row)}>Delete</button>}
            </span>
          )}
        </td>
      </>
    );
  }

  const createCells = draft && (
    <tr className="border-b border-line bg-sunken">
      {entityKey === 'individual' ? (
        <>
          <td className="px-3 py-2.5 font-semibold">{input('name')}</td>
          <td className="px-3 py-2.5 text-ink-muted">No department</td>
          <td className="px-3 py-2.5">{input('email', 'email')}</td>
          <td className="px-3 py-2.5 text-ink-muted">Default (read-only)</td>
          <td className="px-3 py-2.5 whitespace-nowrap"><span className="flex gap-1"><button className="btn btn-sm btn-primary" disabled={busyId === 'new'} onClick={() => save()}>Create</button><button className="btn btn-sm" onClick={cancelEdit}>Cancel</button></span></td>
        </>
      ) : (
        <>
          <td className="px-3 py-2.5 font-semibold">{input('name')}</td>
          <td className="px-3 py-2.5">{entityKey === 'programme' ? '—' : entityKey === 'sub' ? select('programmeId', org.programmes) : select('subId', org.subs)}</td>
          <td className="px-3 py-2.5">{input('head')}</td>
          <td className="px-3 py-2.5">{entityKey === 'sub' ? select('unitLabel', UNIT_KINDS.map((name) => ({ id: name, name }))) : entityKey === 'unit' ? input('kind') : '—'}</td>
          <td className="px-3 py-2.5 whitespace-nowrap"><span className="flex gap-1"><button className="btn btn-sm btn-primary" disabled={busyId === 'new'} onClick={() => save()}>Create</button><button className="btn btn-sm" onClick={cancelEdit}>Cancel</button></span></td>
        </>
      )}
    </tr>
  );

  return (
    <div className="card mt-4">
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => { setOpen((value) => !value); if (open) { cancelEdit(); setSearch(''); } }} aria-expanded={open}>
        <span className="font-display font-bold text-[14px]">Organisation structure <span className="chip">{rows.length}</span></span>
        <span className="text-ink-muted text-[12px]">{open ? 'Hide ▲' : 'Click to view ▼'}</span>
      </button>
      <p className="text-[12px] text-ink-muted mt-1">The organisation table is hidden by default. Click to view and manage records.</p>
      {open && <div className="mt-3">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
          <div className="flex gap-1.5 flex-wrap">{entities.map((entity) => <NavButton key={entity.key} active={entity.key === entityKey} onClick={() => { cancelEdit(); setEntityKey(entity.key); }}>{entity.label}</NavButton>)}</div>
          {canCreate && <button className="btn btn-primary btn-sm" onClick={startCreate}>Create {entities.find((entity) => entity.key === entityKey)?.label.slice(0, -1)}</button>}
        </div>
        <div className="mb-3">
          <label className="field-label block mb-1">Search organisation records</label>
          <input type="search" className="field-input w-full" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, parent, head, role or type…" aria-label="Search organisation records" />
        </div>
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-sunken border-b border-line sticky top-0 z-10"><tr><th className="px-3 py-2 font-bold">Name</th><th className="px-3 py-2 font-bold">Parent / Unit</th><th className="px-3 py-2 font-bold">Head / Role</th><th className="px-3 py-2 font-bold">Type</th><th className="px-3 py-2 font-bold">Actions</th></tr></thead>
            <tbody>{creating && createCells}{filteredRows.length === 0 && !creating ? <tr><td colSpan="5" className="px-3 py-6 text-center text-ink-muted">{rows.length === 0 ? `No ${entities.find((entity) => entity.key === entityKey)?.label.toLowerCase()} yet.` : 'No records match your search.'}</td></tr> : filteredRows.map((row) => <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-sunken/60">{cells(row)}</tr>)}</tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-ink-muted">Showing {filteredRows.length} of {rows.length} {entities.find((entity) => entity.key === entityKey)?.label.toLowerCase()}.</div>
      </div>}
    </div>
  );
}

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

function CreateProgrammeForm() {
  const { reloadCore } = useApp();
  const toast = useToast();
  const [name, setName] = useState('');
  const [head, setHead] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/org/programmes', { method: 'POST', body: { name, head } });
      toast(`Programme created. Head account: ${r.headAccount.email} (${r.headAccount.note})`);
      setName(''); setHead('');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4">
      <h3 className="font-display font-bold text-[14px] mb-3">Create a Programme</h3>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Head (full name)"><input required className="field-input" value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={busy}>Create Programme</button></div>
      </form>
    </div>
  );
}

// Corrects an existing Programme's name/head without deleting and
// recreating it (which would also cascade-remove everything beneath it —
// see routes/org.js's PATCH /programmes/:id, which keeps the linked Head
// account's own name/title in sync automatically). Re-syncs its fields
// whenever the dropdown selection changes, but never on an unrelated data
// refresh, so it doesn't clobber an edit in progress.
function UpdateProgrammeForm() {
  const { org, reloadCore } = useApp();
  const toast = useToast();
  const [progId, setProgId] = useState(org.programmes[0]?.id || '');
  const [name, setName] = useState('');
  const [head, setHead] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org.programmes.some((p) => p.id === Number(progId))) setProgId(org.programmes[0]?.id || '');
  }, [org.programmes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = byId(org.programmes, Number(progId));
    if (p) { setName(p.name); setHead(p.head); }
  }, [progId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    const selected = byId(org.programmes, Number(progId));
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/org/programmes/${selected.id}`, { method: 'PATCH', body: { name, head } });
      toast(`"${name}" updated.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  if (org.programmes.length === 0) {
    return (
      <div className="rounded-xl bg-sunken border border-line p-4">
        <h3 className="font-display font-bold text-[14px] mb-2">Update a Programme</h3>
        <p className="text-[11.8px] text-ink-muted">No Programmes yet — create one first.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4">
      <h3 className="font-display font-bold text-[14px] mb-3">Update a Programme</h3>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Programme">
          <select className="field-input" value={progId} onChange={(e) => setProgId(e.target.value)}>
            {org.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div />
        <Field label="Name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Head (full name)"><input required className="field-input" value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={busy}>Save changes</button></div>
      </form>
    </div>
  );
}

function CreateSubForm() {
  const { org, reloadCore } = useApp();
  const toast = useToast();
  const [programmeId, setProgrammeId] = useState(org.programmes[0]?.id || '');
  const [name, setName] = useState('');
  const [head, setHead] = useState('');
  const [unitLabel, setUnitLabel] = useState('Unit');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/org/subs', { method: 'POST', body: { programmeId: Number(programmeId), name, head, unitLabel } });
      toast(`Sub-programme created. Rep account: ${r.repAccount.email} (${r.repAccount.note})`);
      setName(''); setHead(''); setUnitLabel('Unit');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  if (org.programmes.length === 0) {
    return (
      <div className="rounded-xl bg-sunken border border-line p-4">
        <h3 className="font-display font-bold text-[14px] mb-2">Create a Sub-programme</h3>
        <p className="text-[11.8px] text-ink-muted">Create a Programme first.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4">
      <h3 className="font-display font-bold text-[14px] mb-3">Create a Sub-programme</h3>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Under Programme">
          <select className="field-input" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
            {org.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="What its Units are called">
          <select className="field-input" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)}>
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Head (full name)"><input required className="field-input" value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={busy || !programmeId}>Create Sub-programme</button></div>
      </form>
    </div>
  );
}

function UpdateSubForm() {
  const { org, reloadCore } = useApp();
  const toast = useToast();
  const [subId, setSubId] = useState(org.subs[0]?.id || '');
  const [name, setName] = useState('');
  const [head, setHead] = useState('');
  const [unitLabel, setUnitLabel] = useState('Unit');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org.subs.some((s) => s.id === Number(subId))) setSubId(org.subs[0]?.id || '');
  }, [org.subs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = byId(org.subs, Number(subId));
    if (s) { setName(s.name); setHead(s.head); setUnitLabel(s.unit_label || 'Unit'); }
  }, [subId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    const selected = byId(org.subs, Number(subId));
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/org/subs/${selected.id}`, { method: 'PATCH', body: { name, head, unitLabel } });
      toast(`"${name}" updated.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  if (org.subs.length === 0) {
    return (
      <div className="rounded-xl bg-sunken border border-line p-4">
        <h3 className="font-display font-bold text-[14px] mb-2">Update a Sub-programme</h3>
        <p className="text-[11.8px] text-ink-muted">No Sub-programmes yet — create one first.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4">
      <h3 className="font-display font-bold text-[14px] mb-3">Update a Sub-programme</h3>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Sub-programme">
          <select className="field-input" value={subId} onChange={(e) => setSubId(e.target.value)}>
            {org.subs.map((s) => {
              const p = byId(org.programmes, s.programme_id);
              return <option key={s.id} value={s.id}>{p ? `${p.name} — ${s.name}` : s.name}</option>;
            })}
          </select>
        </Field>
        <Field label="What its Units are called">
          <select className="field-input" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)}>
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Head (full name)"><input required className="field-input" value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={busy}>Save changes</button></div>
      </form>
    </div>
  );
}

// The four kinds this level of the structure is documented as throughout
// the app ("Unit/Department/Faculty/Region" — see README, seed.js's
// unit_label per sub-programme) as real, explicit choices rather than a
// blank free-text box defaulting to "Unit" — so creating a Faculty (for a
// Teaching & Learning-style sub-programme) or a Region/Regional Campus is
// exactly as direct as creating a plain Unit, right from this same form,
// not something you have to know to type in yourself. "Other" still opens
// a free-text field for anything this list doesn't cover.
const UNIT_KINDS = ['Unit', 'Department', 'Faculty', 'Region', 'Regional Campus'];

function CreateUnitForm() {
  const { org, reloadCore } = useApp();
  const toast = useToast();
  const [sub, setSub] = useState(org.subs[0]?.id || '');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('Unit');
  const [customKind, setCustomKind] = useState('');
  const [head, setHead] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const finalKind = kind === 'Other' ? (customKind.trim() || 'Unit') : kind;
      const r = await api('/org/units', { method: 'POST', body: { subId: Number(sub), name, kind: finalKind, head } });
      toast(`${finalKind} created. Head account: ${r.headAccount.email} (${r.headAccount.note})`);
      setName(''); setHead(''); setCustomKind('');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  if (org.subs.length === 0) {
    return (
      <div className="rounded-xl bg-sunken border border-line p-4">
        <h3 className="font-display font-bold text-[14px] mb-2">Create a Unit / Department / Faculty / Region</h3>
        <p className="text-[11.8px] text-ink-muted">Create a Sub-programme first.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4">
      <h3 className="font-display font-bold text-[14px] mb-3">Create a Unit / Department / Faculty / Region</h3>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Under Sub-programme">
          <select className="field-input" value={sub} onChange={(e) => setSub(e.target.value)}>
            {org.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Kind">
          <select className="field-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            <option value="Other">Other…</option>
          </select>
        </Field>
        <Field label="Name" full={kind !== 'Other'}>
          <input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Faculty of Arts & Education, Mashonaland Region…" />
        </Field>
        {kind === 'Other' && (
          <Field label="Custom kind"><input required className="field-input" value={customKind} onChange={(e) => setCustomKind(e.target.value)} /></Field>
        )}
        <Field label="Head (full name)" full><input required className="field-input" value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={busy}>Create {kind === 'Other' ? (customKind.trim() || 'unit') : kind.toLowerCase()}</button></div>
      </form>
    </div>
  );
}

function UpdateUnitForm() {
  const { org, reloadCore } = useApp();
  const toast = useToast();
  const [unitId, setUnitId] = useState(org.units[0]?.id || '');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('Unit');
  const [customKind, setCustomKind] = useState('');
  const [head, setHead] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org.units.some((u) => u.id === Number(unitId))) setUnitId(org.units[0]?.id || '');
  }, [org.units]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const u = byId(org.units, Number(unitId));
    if (u) {
      setName(u.name); setHead(u.head);
      if (UNIT_KINDS.includes(u.kind)) { setKind(u.kind); setCustomKind(''); }
      else { setKind('Other'); setCustomKind(u.kind || ''); }
    }
  }, [unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    const selected = byId(org.units, Number(unitId));
    if (!selected) return;
    setBusy(true);
    try {
      const finalKind = kind === 'Other' ? (customKind.trim() || 'Unit') : kind;
      await api(`/org/units/${selected.id}`, { method: 'PATCH', body: { name, head, kind: finalKind } });
      toast(`"${name}" updated.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  if (org.units.length === 0) {
    return (
      <div className="rounded-xl bg-sunken border border-line p-4">
        <h3 className="font-display font-bold text-[14px] mb-2">Update a Unit / Department / Faculty / Region</h3>
        <p className="text-[11.8px] text-ink-muted">No Units yet — create one first.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4">
      <h3 className="font-display font-bold text-[14px] mb-3">Update a Unit / Department / Faculty / Region</h3>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Unit / Department / Faculty / Region">
          <select className="field-input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {org.units.map((u) => {
              const s = byId(org.subs, u.sub_id);
              return <option key={u.id} value={u.id}>{s ? `${s.name} — ${u.name}` : u.name} ({u.kind})</option>;
            })}
          </select>
        </Field>
        <Field label="Kind">
          <select className="field-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            <option value="Other">Other…</option>
          </select>
        </Field>
        <Field label="Name" full={kind !== 'Other'}>
          <input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {kind === 'Other' && (
          <Field label="Custom kind"><input required className="field-input" value={customKind} onChange={(e) => setCustomKind(e.target.value)} /></Field>
        )}
        <Field label="Head (full name)" full><input required className="field-input" value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={busy}>Save changes</button></div>
      </form>
    </div>
  );
}

// NOTE: individual creation no longer has a standalone form component here
// — it went through the same Create/table flow as Programmes/Subs/Units
// (see `createCells`'s entityKey === 'individual' branch above, and
// `canAddIndividual` in the main component). There is deliberately no
// own-scope restriction on it any more either: since no Individual is ever
// assigned a unit/department (see POST /individuals), there is no unit
// left to scope the picker against, so add_individual now behaves the same
// everywhere it's granted rather than needing a narrower own-scope variant.

function Field({ label, children, full }) {
  return (
    <div className={`space-y-1 ${full ? 'sm:col-span-2' : ''}`}>
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
