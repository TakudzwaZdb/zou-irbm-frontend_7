import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { byId } from '../lib/scope.js';
import { ROLES, ROLE_LABEL } from './Users.jsx';

// Organisation Maintenance — the MAINTAIN/RETIRE half of admin org
// management: removing a Programme/Sub-programme/Unit (and restoring one
// from "Recently Removed"), plus editing, removing, or role-changing an
// existing Individual. The other half — CREATING a Programme/Sub-programme/
// Unit, UPDATING an existing one's own name/head, and ADDING a new
// Individual — lives on its own dedicated page, `OrganisationBuilder.jsx`
// ("Organisation Setup" in the nav): those used to be four bare forms bolted onto the
// bottom of this same page, with no way to correct a typo afterward short
// of deleting and recreating the whole thing. Splitting "build it" from
// "maintain/retire it" onto two pages — rather than one long scroll mixing
// create, update, remove, and restore for four different entity types —
// is what makes each page readable at a glance instead of a wall of forms.
// This page is options only: `ManageOptions` below is a set of
// pick-from-a-dropdown-and-act panels (Remove a Programme / Sub-programme /
// Unit, Manage individuals, Recently Removed) with no tree rendering at
// all — go look at the org chart on Framework, come back here to act on
// it. The add_individual-only case (`OwnScopeTeam`) already worked this
// way — scoped to just the caller's own unit(s), never the whole org — so
// it's unchanged.
//
// Removing a Programme/Sub-programme/Unit here cascades: it takes
// everything nested beneath it, every KPI any of it owns, and every login
// account that only exists because of it out of every active view at once
// (see routes/org.js's cascadeSoftDeleteProgramme/Sub/Unit). But nothing is
// actually destroyed — every row is stamped, not deleted, so it's a real,
// reversible change: the confirmation dialogs below say so, and the
// "Recently Removed" panel further down lists everything that's been
// removed with a one-click Restore, for exactly this reason.
export default function OrgStructure() {
  const { user, org, hasPerm } = useApp();
  const canUnits = hasPerm('manage_org_units');
  const canAddIndividual = canUnits || hasPerm('add_individual');
  const isIctAdmin = user.role === 'ictadmin';

  if (!canUnits && !canAddIndividual) {
    return (
      <div>
        <div className="mb-5">
          <h1 className="text-xl font-bold mb-0.5">Organisation Maintenance</h1>
          <p className="text-[13px] text-ink-secondary">Create, edit, and remove Programmes, Sub-programmes, Units, and the people within them.</p>
        </div>
        <div className="card text-center text-ink-muted py-10">
          You don't hold a permission that manages this. Ask an ICT System Administrator for "Create Units /
          Departments / Faculties / Regions" or "Add an Individual" if you need access here.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Organisation Maintenance</h1>
        <p className="text-[13px] text-ink-secondary max-w-[70ch]">
          {canUnits
            ? `Remove a Programme, Sub-programme, or Unit/Department/Faculty/Region, and edit, remove${isIctAdmin ? ', or role-change' : ''} ` +
              `the individuals within them. Removing ` +
              `anything below takes everything nested beneath it — and every login account that only exists ` +
              `because of it — out of view, but nothing is ever actually deleted: it's fully recoverable from ` +
              `"Recently Removed" below. To create a new Programme/Sub-programme/Unit or add an Individual, go to ` +
              `Organisation Setup.`
            : 'Edit individuals within your own unit/sub-programme. To add a new one, go to Organisation Setup. Role changes and account removal are an ICT System Administrator action.'}
        </p>
      </div>

      {canUnits ? <ManageOptions org={org} isIctAdmin={isIctAdmin} /> : <OwnScopeTeam org={org} user={user} />}
    </div>
  );
}

// Options only — no tree. Four independent panels, each a "pick from a
// dropdown, then act" control: Remove a Programme / Sub-programme / Unit,
// and Manage individuals (pick a Unit, then edit/remove/role-change
// whoever's in it). The full Programme -> Sub -> Unit -> Individual
// hierarchy, browsable and read-only, lives on Framework.jsx alone — this
// page never renders it, so there's exactly one place in the app that
// looks like an org chart.
function ManageOptions({ org, isIctAdmin }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  const [busyKey, setBusyKey] = useState(null);

  const [progId, setProgId] = useState(org.programmes[0]?.id || '');
  const [subId, setSubId] = useState(org.subs[0]?.id || '');
  const [unitId, setUnitId] = useState(org.units[0]?.id || '');
  const [peopleUnitId, setPeopleUnitId] = useState(org.units[0]?.id || '');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: '', roleTitle: '' });
  const [roleDraft, setRoleDraft] = useState({});

  // "Recently Removed" — the live, restorable list backing every "This
  // isn't deleted, it's recoverable" claim made throughout this page (see
  // routes/org.js's GET /removed). Loaded on mount and refreshed after
  // every remove/restore so it never shows stale state.
  const [removed, setRemoved] = useState(null);
  const [removedOpen, setRemovedOpen] = useState(false);
  async function reloadRemoved() {
    try { setRemoved(await api('/org/removed')); } catch (err) { toast(err.message, 'err'); }
  }
  useEffect(() => { reloadRemoved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function restoreEntity(kind, id, label) {
    setBusyKey(`restore-${kind}-${id}`);
    try {
      await api(`/org/${kind}/${id}/restore`, { method: 'POST' });
      toast(`${label} restored.`);
      await reloadCore();
      await reloadRemoved();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  // Keeps each dropdown pointed at something that still exists — after a
  // delete (or on first load with fresh data) a selection that's gone
  // falls back to whatever's first in the current list, rather than
  // silently keeping a stale, now-nonexistent id selected.
  useEffect(() => { if (!org.programmes.some((p) => p.id === Number(progId))) setProgId(org.programmes[0]?.id || ''); }, [org.programmes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!org.subs.some((s) => s.id === Number(subId))) setSubId(org.subs[0]?.id || ''); }, [org.subs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!org.units.some((u) => u.id === Number(unitId))) setUnitId(org.units[0]?.id || ''); }, [org.units]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!org.units.some((u) => u.id === Number(peopleUnitId))) setPeopleUnitId(org.units[0]?.id || ''); }, [org.units]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeProgramme() {
    const p = byId(org.programmes, Number(progId));
    if (!p) return;
    const subCount = org.subs.filter((s) => s.programme_id === p.id).length;
    if (!window.confirm(
      `Remove Programme "${p.name}"? This takes ${subCount} Sub-programme(s), every Unit and ` +
      `Individual beneath them, every KPI any of them own, and every login account created for them out of active ` +
      `use — nothing is deleted, and it's all restorable together from "Recently Removed" below.`
    )) return;
    setBusyKey('prog');
    try {
      const r = await api(`/org/programmes/${p.id}`, { method: 'DELETE' });
      toast(`"${p.name}" removed (${r.removed.subs} sub-programme(s), ${r.removed.units} unit(s), ${r.removed.individuals} individual(s), ${r.removed.kpis} KPI(s), ${r.removed.accounts} account(s) — all recoverable).`);
      await reloadCore();
      await reloadRemoved();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  async function removeSub() {
    const s = byId(org.subs, Number(subId));
    if (!s) return;
    const unitCount = org.units.filter((u) => u.sub_id === s.id).length;
    if (!window.confirm(
      `Remove Sub-programme "${s.name}"? This takes ${unitCount} Unit(s), every Individual within ` +
      `them, every KPI any of them own, and every login account created for them out of active use — nothing is ` +
      `deleted, and it's all restorable together from "Recently Removed" below.`
    )) return;
    setBusyKey('sub');
    try {
      const r = await api(`/org/subs/${s.id}`, { method: 'DELETE' });
      toast(`"${s.name}" removed (${r.removed.units} unit(s), ${r.removed.individuals} individual(s), ${r.removed.kpis} KPI(s), ${r.removed.accounts} account(s) — all recoverable).`);
      await reloadCore();
      await reloadRemoved();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  async function removeUnit() {
    const u = byId(org.units, Number(unitId));
    if (!u) return;
    const indCount = org.individuals.filter((i) => i.unit_id === u.id).length;
    if (!window.confirm(
      `Remove "${u.name}"? This takes ${indCount} individual(s) in it, every KPI any of them (or the ` +
      `unit itself) own, and every login account created for them out of active use — nothing is deleted, and ` +
      `it's all restorable together from "Recently Removed" below.`
    )) return;
    setBusyKey('unit');
    try {
      const r = await api(`/org/units/${u.id}`, { method: 'DELETE' });
      toast(`"${u.name}" removed (${r.removed.individuals} individual(s), ${r.removed.kpis} KPI(s), ${r.removed.accounts} account(s) — all recoverable).`);
      await reloadCore();
      await reloadRemoved();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  function startEdit(ind) {
    setEditingId(ind.id);
    setDraft({ name: ind.name, roleTitle: ind.role_title });
  }

  async function saveEdit(ind) {
    setBusyKey(`i${ind.id}`);
    try {
      await api(`/org/individuals/${ind.id}`, { method: 'PATCH', body: { name: draft.name, roleTitle: draft.roleTitle } });
      toast(`${draft.name} updated.`);
      setEditingId(null);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  async function removeIndividual(ind) {
    if (!window.confirm(`Remove ${ind.name} and deactivate their account? Nothing is deleted — they, their KPIs, and their history stay intact and restorable from "Recently Removed" below.`)) return;
    setBusyKey(`i${ind.id}`);
    try {
      await api(`/org/individuals/${ind.id}`, { method: 'DELETE' });
      toast(`${ind.name} removed — recoverable from Recently Removed.`);
      await reloadCore();
      await reloadRemoved();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  async function changeRole(ind) {
    if (!ind.user_id) return;
    const role = roleDraft[ind.id];
    if (!role) return;
    if (!window.confirm(`Change ${ind.name}'s account role to "${ROLE_LABEL[role]}"? Their existing permission grants are left as-is — review them from Permissions & User Directory afterwards.`)) return;
    setBusyKey(`i${ind.id}`);
    try {
      await api(`/users/${ind.user_id}/role`, { method: 'PATCH', body: { role } });
      toast(`${ind.name}'s role changed to ${ROLE_LABEL[role]}.`);
      setRoleDraft((d) => { const n = { ...d }; delete n[ind.id]; return n; });
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  const peopleUnit = byId(org.units, Number(peopleUnitId));
  const peopleInds = peopleUnit ? org.individuals.filter((i) => i.unit_id === peopleUnit.id) : [];

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 mb-4">
      <div className="card">
        <h3 className="font-display font-bold text-[14px] mb-2.5">Remove a Programme</h3>
        {org.programmes.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No Programmes yet.</p>
        ) : (
          <div className="flex gap-2 flex-wrap items-end">
            <Field label="Programme">
              <select className="field-input" value={progId} onChange={(e) => setProgId(e.target.value)}>
                {org.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <button className="btn btn-sm btn-danger" disabled={busyKey === 'prog'} onClick={removeProgramme}>Delete programme</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="font-display font-bold text-[14px] mb-2.5">Remove a Sub-programme</h3>
        {org.subs.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No Sub-programmes yet.</p>
        ) : (
          <div className="flex gap-2 flex-wrap items-end">
            <Field label="Sub-programme">
              <select className="field-input" value={subId} onChange={(e) => setSubId(e.target.value)}>
                {org.subs.map((s) => {
                  const p = byId(org.programmes, s.programme_id);
                  return <option key={s.id} value={s.id}>{p ? `${p.name} — ${s.name}` : s.name}</option>;
                })}
              </select>
            </Field>
            <button className="btn btn-sm btn-danger" disabled={busyKey === 'sub'} onClick={removeSub}>Delete sub-programme</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="font-display font-bold text-[14px] mb-2.5">Remove a Unit</h3>
        {org.units.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No Units yet.</p>
        ) : (
          <div className="flex gap-2 flex-wrap items-end">
            <Field label="Unit / Department / Faculty / Region">
              <select className="field-input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {org.units.map((u) => {
                  const s = byId(org.subs, u.sub_id);
                  return <option key={u.id} value={u.id}>{s ? `${s.name} — ${u.name}` : u.name} ({u.kind})</option>;
                })}
              </select>
            </Field>
            <button className="btn btn-sm btn-danger" disabled={busyKey === 'unit'} onClick={removeUnit}>Delete unit</button>
          </div>
        )}
      </div>

      <div className="card sm:col-span-2">
        <h3 className="font-display font-bold text-[14px] mb-2.5">Manage individuals</h3>
        {org.units.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No Units yet — create one below first.</p>
        ) : (
          <>
            <Field label="Unit / Department / Faculty / Region">
              <select className="field-input max-w-md" value={peopleUnitId} onChange={(e) => { setPeopleUnitId(e.target.value); setEditingId(null); }}>
                {org.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.kind})</option>)}
              </select>
            </Field>
            <div className="mt-3 space-y-1.5">
              {peopleInds.map((i) => (
                <div key={i.id} className="text-[12.5px]">
                  {editingId === i.id ? (
                    <div className="flex gap-2 flex-wrap items-center bg-sunken rounded-lg px-2.5 py-2 max-w-xl">
                      <input className="field-input py-1.5 flex-1 min-w-[120px]" value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
                      <input className="field-input py-1.5 flex-1 min-w-[120px]" value={draft.roleTitle}
                        onChange={(e) => setDraft((d) => ({ ...d, roleTitle: e.target.value }))} placeholder="Role / job title" />
                      <button className="btn btn-sm btn-primary" disabled={busyKey === `i${i.id}` || !draft.name.trim() || !draft.roleTitle.trim()} onClick={() => saveEdit(i)}>Save</button>
                      <button className="btn btn-sm" disabled={busyKey === `i${i.id}`} onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap text-ink-muted">
                      <span>• {i.name} — {i.role_title || ''}</span>
                      <button onClick={() => startEdit(i)} className="text-accent-600 hover:underline">edit</button>
                      <button onClick={() => removeIndividual(i)} disabled={busyKey === `i${i.id}`} className="text-critical hover:underline disabled:opacity-40">remove</button>
                      {isIctAdmin && i.user_id && (
                        <span className="flex items-center gap-1.5">
                          <select
                            className="field-input py-0.5 text-[11px] w-auto"
                            value={roleDraft[i.id] ?? 'individual'}
                            disabled={busyKey === `i${i.id}`}
                            onChange={(e) => setRoleDraft((d) => ({ ...d, [i.id]: e.target.value }))}
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                          <button
                            className="text-accent-600 hover:underline disabled:opacity-40"
                            disabled={busyKey === `i${i.id}` || !roleDraft[i.id] || roleDraft[i.id] === 'individual'}
                            onClick={() => changeRole(i)}
                          >
                            update role
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {peopleInds.length === 0 && <p className="text-ink-muted text-[11.5px]">No individuals in this unit yet.</p>}
            </div>
          </>
        )}
      </div>

      <RecentlyRemoved
        org={org}
        removed={removed}
        removedOpen={removedOpen}
        setRemovedOpen={setRemovedOpen}
        busyKey={busyKey}
        onRestore={restoreEntity}
      />
    </div>
  );
}

// The other half of every "nothing is deleted, it's recoverable" claim made
// above: a live list of everything currently soft-removed (see routes/
// org.js's GET /removed), each with a one-click Restore. Collapsible and
// closed by default — most days there's nothing here — but always shows a
// real count so it's obvious at a glance whether anything is sitting
// removed. Programme/Sub/Unit names for a removed row are looked up from
// whichever of the active or removed lists still has them, since a Unit
// removed on its own still has an active parent Sub, but one removed as
// part of a whole Programme cascade only has its name in the removed list.
function RecentlyRemoved({ org, removed, removedOpen, setRemovedOpen, busyKey, onRestore }) {
  if (!removed) return null;
  const { programmes = [], subs = [], units = [], individuals = [] } = removed;
  const total = programmes.length + subs.length + units.length + individuals.length;

  const programmeName = (id) => byId(org.programmes, id)?.name || byId(programmes, id)?.name || `Programme #${id}`;
  const subName = (id) => byId(org.subs, id)?.name || byId(subs, id)?.name || `Sub-programme #${id}`;
  const unitName = (id) => byId(org.units, id)?.name || byId(units, id)?.name || `Unit #${id}`;

  return (
    <div className="card mb-4">
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={() => setRemovedOpen((v) => !v)}
      >
        <span className="font-display font-bold text-[14px] flex items-center gap-2">
          Recently Removed
          <span className={`chip ${total ? 'chip-rag-amber' : ''}`}>{total}</span>
        </span>
        <span className="text-ink-muted text-[12px]">{removedOpen ? 'Hide ▲' : 'Show ▼'}</span>
      </button>
      <p className="text-[12px] text-ink-muted mt-1">
        Everything removed from Organisation Maintenance — nothing here is deleted; restoring puts it straight back
        into active use with its history intact.
      </p>
      {removedOpen && (
        total === 0 ? (
          <p className="text-[12px] text-ink-muted mt-3">Nothing removed right now.</p>
        ) : (
          <div className="mt-3 space-y-3 text-[12.5px]">
            {programmes.length > 0 && (
              <RemovedGroup title="Programmes">
                {programmes.map((p) => (
                  <RemovedRow key={`p${p.id}`} label={p.name} busy={busyKey === `restore-programmes-${p.id}`}
                    onRestore={() => onRestore('programmes', p.id, `Programme "${p.name}"`)} />
                ))}
              </RemovedGroup>
            )}
            {subs.length > 0 && (
              <RemovedGroup title="Sub-programmes">
                {subs.map((s) => (
                  <RemovedRow key={`s${s.id}`} label={`${programmeName(s.programme_id)} — ${s.name}`} busy={busyKey === `restore-subs-${s.id}`}
                    onRestore={() => onRestore('subs', s.id, `Sub-programme "${s.name}"`)} />
                ))}
              </RemovedGroup>
            )}
            {units.length > 0 && (
              <RemovedGroup title="Units / Departments / Faculties / Regions">
                {units.map((u) => (
                  <RemovedRow key={`u${u.id}`} label={`${subName(u.sub_id)} — ${u.name} (${u.kind})`} busy={busyKey === `restore-units-${u.id}`}
                    onRestore={() => onRestore('units', u.id, `"${u.name}"`)} />
                ))}
              </RemovedGroup>
            )}
            {individuals.length > 0 && (
              <RemovedGroup title="Individuals">
                {individuals.map((i) => (
                  <RemovedRow key={`i${i.id}`} label={`${unitName(i.unit_id)} — ${i.name} (${i.role_title || ''})`} busy={busyKey === `restore-individuals-${i.id}`}
                    onRestore={() => onRestore('individuals', i.id, i.name)} />
                ))}
              </RemovedGroup>
            )}
          </div>
        )
      )}
    </div>
  );
}

function RemovedGroup({ title, children }) {
  return (
    <div>
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function RemovedRow({ label, busy, onRestore }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-sunken rounded-lg px-2.5 py-1.5">
      <span className="text-ink-muted">{label}</span>
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={onRestore}>
        {busy ? 'Restoring…' : 'Restore'}
      </button>
    </div>
  );
}

// The scoped view for a Unit Head / Sub Rep who only holds add_individual
// (not manage_org_units): they can't create/delete Programmes/Subs/Units
// and can't change anyone's role, so showing them the ENTIRE org tree again
// (they already see it, read-only, on Framework) would just repeat it.
// Instead: their own unit(s) only, with the same inline edit the full tree
// offers (the backend allows this — see routes/org.js's PATCH /individuals/
// :id own-scope check) but no remove/role controls, since the server
// would reject those from this permission level anyway.
function OwnScopeTeam({ org, user }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: '', roleTitle: '' });
  const [busyId, setBusyId] = useState(null);

  const ownUnits = user.role === 'unithead'
    ? org.units.filter((u) => u.id === user.scope_id)
    : user.role === 'rep'
      ? org.units.filter((u) => u.sub_id === user.scope_id)
      : [];

  function startEdit(ind) {
    setEditingId(ind.id);
    setDraft({ name: ind.name, roleTitle: ind.role_title });
  }

  async function saveEdit(ind) {
    setBusyId(ind.id);
    try {
      await api(`/org/individuals/${ind.id}`, { method: 'PATCH', body: { name: draft.name, roleTitle: draft.roleTitle } });
      toast(`${draft.name} updated.`);
      setEditingId(null);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  if (ownUnits.length === 0) {
    return <div className="card text-center text-ink-muted py-8">No unit/sub-programme of your own yet.</div>;
  }

  return (
    <div className="space-y-3">
      {ownUnits.map((u) => {
        const inds = org.individuals.filter((i) => i.unit_id === u.id);
        return (
          <div key={u.id} className="card">
            <div><b>{u.name}</b> <span className="text-ink-muted text-[12px]">({u.kind} · Head: {u.head})</span></div>
            <div className="mt-1.5 space-y-1">
              {inds.map((i) => (
                <div key={i.id} className="text-[12.5px]">
                  {editingId === i.id ? (
                    <div className="flex gap-2 flex-wrap items-center bg-sunken rounded-lg px-2.5 py-2 max-w-xl">
                      <input className="field-input py-1 flex-1 min-w-[120px]" value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
                      <input className="field-input py-1 flex-1 min-w-[120px]" value={draft.roleTitle}
                        onChange={(e) => setDraft((d) => ({ ...d, roleTitle: e.target.value }))} placeholder="Role / job title" />
                      <button className="btn btn-sm btn-primary" disabled={busyId === i.id || !draft.name.trim() || !draft.roleTitle.trim()} onClick={() => saveEdit(i)}>Save</button>
                      <button className="btn btn-sm" disabled={busyId === i.id} onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap text-ink-muted">
                      <span>• {i.name} — {i.role_title || ''}</span>
                      <button onClick={() => startEdit(i)} className="text-accent-600 hover:underline">edit</button>
                    </div>
                  )}
                </div>
              ))}
              {inds.length === 0 && <div className="text-ink-muted text-[11.5px]">No individuals yet.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
