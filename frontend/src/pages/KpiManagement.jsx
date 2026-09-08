import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { inJurisdiction, byId } from '../lib/scope.js';

// Everything to do with the KPI catalogue itself — creating a new KPI,
// managing the "for individuals" template pool, and editing or deleting an
// existing KPI's definition/targets — used to live inside Framework.jsx
// alongside org-structure and individual management. Split out into its
// own admin page so "manage the KPI catalogue" and "manage who's in the
// org chart" are two distinct places, not one long scroll of unrelated
// forms. See OrgStructure.jsx (Organisation Maintenance) for the other one.
export default function KpiManagement() {
  const { user, org, kpis, hasPerm } = useApp();
  const canKpi = hasPerm('create_kpi');
  const canTargets = hasPerm('edit_targets');

  if (!canKpi && !canTargets) {
    return (
      <div>
        <div className="mb-5">
          <h1 className="text-xl font-bold mb-0.5">KPI Management</h1>
          <p className="text-[13px] text-ink-secondary">Create, edit, and remove KPIs across the catalogue.</p>
        </div>
        <div className="card text-center text-ink-muted py-10">
          You don't hold a permission that lets you manage KPIs. Ask an ICT System Administrator for "Create new KPIs"
          or "Edit KPI baselines &amp; targets" if you need access here.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">KPI Management</h1>
        <p className="text-[13px] text-ink-secondary">Create, edit, and remove KPIs across the catalogue.</p>
      </div>

      {canKpi && <AddKpiForm />}
      {canKpi && <KpiTemplatesSection />}
      {(canKpi || canTargets) && <EditKpiForm user={user} kpis={kpis} org={org} canFullEdit={canKpi} />}
      {canKpi && <RecentlyRemoved />}
    </div>
  );
}

// The other half of every "nothing is deleted, it's recoverable" claim made
// on this page: a live list of everything currently soft-removed from the
// KPI catalogue — both individual KPIs (routes/kpis.js's GET /removed) and
// templates from the "for individuals" pool (routes/kpiTemplates.js's GET
// /removed) — each with a one-click Restore, same collapsible-and-closed-
// by-default pattern as Organisation Maintenance's own Recently Removed panel.
// This used to have no frontend at all even though both backend routes
// already existed — "recoverable" was true in the database but not actually
// reachable by anyone without calling the API directly.
function RecentlyRemoved() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [removedKpis, setRemovedKpis] = useState([]);
  const [removedTemplates, setRemovedTemplates] = useState([]);
  const [busyKey, setBusyKey] = useState(null);
  const { reloadCore, reloadTemplates } = useApp();

  async function load() {
    try {
      const [k, t] = await Promise.all([api('/kpis/removed'), api('/kpi-templates/removed')]);
      setRemovedKpis(k.kpis || []);
      setRemovedTemplates(t.templates || []);
    } catch (err) { toast(err.message, 'err'); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function restoreKpi(k) {
    setBusyKey(`k${k.id}`);
    try {
      await api(`/kpis/${k.id}/restore`, { method: 'POST' });
      toast(`"${k.name}" restored.`);
      await Promise.all([load(), reloadCore()]);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }
  async function restoreTemplate(t) {
    setBusyKey(`t${t.id}`);
    try {
      await api(`/kpi-templates/${t.id}/restore`, { method: 'POST' });
      toast(`"${t.name}" restored to ${t.unit_name}'s pool.`);
      await Promise.all([load(), reloadTemplates()]);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyKey(null); }
  }

  const total = removedKpis.length + removedTemplates.length;

  return (
    <div className="card mt-4">
      <button className="w-full flex items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
        <span className="font-display font-bold text-[14px] flex items-center gap-2">
          Recently Removed
          <span className={`chip ${total ? 'chip-rag-amber' : ''}`}>{total}</span>
        </span>
        <span className="text-ink-muted text-[12px]">{open ? 'Hide ▲' : 'Show ▼'}</span>
      </button>
      <p className="text-[12px] text-ink-muted mt-1">
        Every KPI and template removed from this catalogue — nothing here is deleted; restoring puts it straight
        back into active use with its recorded values, submissions, and history intact.
      </p>
      {open && (
        total === 0 ? (
          <p className="text-[12px] text-ink-muted mt-3">Nothing removed right now.</p>
        ) : (
          <div className="mt-3 space-y-3 text-[12.5px]">
            {removedKpis.length > 0 && (
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">KPIs</h4>
                <div className="space-y-1">
                  {removedKpis.map((k) => (
                    <div key={`k${k.id}`} className="flex items-center justify-between gap-2 bg-sunken rounded-lg px-2.5 py-1.5">
                      <span className="text-ink-muted">{k.name} ({k.owner_type} #{k.owner_id})</span>
                      <button className="btn btn-sm btn-primary" disabled={busyKey === `k${k.id}`} onClick={() => restoreKpi(k)}>
                        {busyKey === `k${k.id}` ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {removedTemplates.length > 0 && (
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">Templates</h4>
                <div className="space-y-1">
                  {removedTemplates.map((t) => (
                    <div key={`t${t.id}`} className="flex items-center justify-between gap-2 bg-sunken rounded-lg px-2.5 py-1.5">
                      <span className="text-ink-muted">{t.name} — {t.unit_name}'s pool</span>
                      <button className="btn btn-sm btn-primary" disabled={busyKey === `t${t.id}`} onClick={() => restoreTemplate(t)}>
                        {busyKey === `t${t.id}` ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

// Owner type "Individual" no longer means "pick one named person" — it
// means "pick the Unit these individuals fall under", so the KPI is
// created ONCE and everyone in that unit can pick it up as their own (see
// KpiTemplatesSection below and routes/kpiTemplates.js). Creating a real,
// single-owner individual KPI directly (the old behavior) is still exactly
// what EditKpiForm's catalog edits, so nothing that already exists this way
// breaks — this form just no longer creates NEW ones that way, since a
// Unit-scoped pool is strictly more useful (one definition, any number of
// people in that unit can adopt it) for the same intent.
function AddKpiForm() {
  const { org, reloadCore } = useApp();
  const toast = useToast();
  const [ownerType, setOwnerType] = useState('sub');
  const [ownerId, setOwnerId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [measure, setMeasure] = useState('');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [busy, setBusy] = useState(false);

  // Individual-type KPIs are scoped by Unit now (a template pool), so they
  // share the Unit picker with owner_type='unit' KPIs — the two just create
  // different things on submit.
  const options = ownerType === 'sub' ? org.subs : org.units;
  // Only meaningful once a Unit owner is actually picked — the same rule
  // the backend enforces (custodians only ever apply to a Unit-owned KPI).
  const unitIndividuals = ownerType === 'unit' && ownerId
    ? org.individuals.filter((i) => i.unit_id === Number(ownerId))
    : [];

  function toggleAssignee(id) {
    setAssigneeIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const chosenId = Number(ownerId || options[0]?.id);
      if (ownerType === 'individual') {
        await api('/kpi-templates', { method: 'POST', body: { unitId: chosenId, name, type, measure, baseline: Number(baseline), target: Number(target) } });
        toast('KPI created for individuals in this unit — each one can now pick it up as their own from My Data Entry.');
      } else {
        await api('/kpis', {
          method: 'POST',
          body: {
            ownerType, ownerId: chosenId, name, type, measure,
            baseline: Number(baseline), target: Number(target),
            assigneeIds: ownerType === 'unit' ? assigneeIds : undefined,
          },
        });
        toast(assigneeIds.length ? `KPI created and assigned to ${assigneeIds.length} custodian(s).` : 'KPI created.');
      }
      setName(''); setType(''); setMeasure(''); setBaseline(''); setTarget(''); setAssigneeIds([]);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4 mt-3">
      <h3 className="font-display font-bold text-[14px] mb-3">Create a KPI</h3>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Owner type">
            <select className="field-input" value={ownerType} onChange={(e) => { setOwnerType(e.target.value); setOwnerId(''); setAssigneeIds([]); }}>
              <option value="sub">Sub-programme</option>
              <option value="unit">Unit</option>
              <option value="individual">Individuals (under a unit)</option>
            </select>
          </Field>
          <Field label={ownerType === 'individual' ? 'Unit their individuals fall under' : 'Owner'}>
            <select className="field-input" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setAssigneeIds([]); }}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Type"><input required placeholder="Efficiency / Growth / Compliance…" className="field-input" value={type} onChange={(e) => setType(e.target.value)} /></Field>
          <Field label="Measure (unit)"><input required placeholder="%, count, days…" className="field-input" value={measure} onChange={(e) => setMeasure(e.target.value)} /></Field>
          <Field label="Baseline"><input required type="number" step="any" className="field-input" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Field>
          <Field label="Target"><input required type="number" step="any" className="field-input" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        </div>
        {ownerType === 'individual' && (
          <p className="text-[11.5px] text-ink-muted max-w-[65ch]">
            This creates the KPI once, scoped to the unit you picked — nobody owns it yet. Anyone in that unit sees it
            in their own My Data Entry as something they can add as their own personal KPI (each person who picks it
            up gets their own independent figure to enter, not a number shared with the rest of the unit).
          </p>
        )}
        {ownerType === 'unit' && ownerId && (
          <div>
            <label className="field-label block mb-1.5">
              Assign custodians (optional) — everyone selected files their own figure toward this KPI; their Unit
              Head reviews and approves each one, and approved figures are summed automatically into the KPI's own
              value, instead of creating a separate KPI per person.
            </label>
            {unitIndividuals.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {unitIndividuals.map((i) => (
                  <label key={i.id} className={`chip cursor-pointer select-none ${assigneeIds.includes(i.id) ? 'bg-accent-50 text-accent-600' : 'bg-sunken text-ink-secondary border border-line'}`}>
                    <input type="checkbox" className="sr-only" checked={assigneeIds.includes(i.id)} onChange={() => toggleAssignee(i.id)} />
                    {i.name} — {i.role_title}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-ink-muted">No individuals in this unit yet — add one from People &amp; Roles first.</p>
            )}
          </div>
        )}
        <div><button className="btn btn-primary btn-sm" disabled={busy}>Create KPI</button></div>
      </form>
    </div>
  );
}

// Management view of the Individual-KPI pool created above — what exists,
// which unit it's scoped to, and real adoption (how many people in that
// unit have actually picked it up so far), plus removal for one that was
// created by mistake or is no longer needed (removing it never touches
// anyone's already-picked personal KPI — see db.js's kpi_templates note).
function KpiTemplatesSection() {
  const { org, templates, reloadTemplates } = useApp();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { reloadTemplates(); }, [reloadTemplates]);

  async function remove(t) {
    if (!window.confirm(`Remove the "${t.name}" KPI template from ${t.unit_name}'s pool? Anyone who already picked it up keeps their own copy — this only takes it out of the pool for anyone who hasn't yet, and it's recoverable from Recently Removed below.`)) return;
    setBusyId(t.id);
    try {
      await api(`/kpi-templates/${t.id}`, { method: 'DELETE' });
      toast('Template removed.');
      await reloadTemplates();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  if (templates.length === 0) return null;

  return (
    <div className="mt-3">
      <h3 className="font-display font-bold text-[14px] mb-2">KPIs for individuals — by unit</h3>
      <p className="text-[11.8px] text-ink-muted mb-2.5 max-w-[65ch]">
        Every KPI created above for a unit's individuals, and how many people in that unit have picked it up so far.
      </p>
      <div className="space-y-2">
        {templates.map((t) => {
          const eligible = org.individuals.filter((i) => i.unit_id === t.unit_id).length;
          return (
            <div key={t.id} className="card flex justify-between gap-3 items-center flex-wrap py-2.5">
              <div>
                <p className="font-bold text-[13.4px]">{t.name}</p>
                <span className="text-[11.5px] text-ink-muted">{t.unit_name} · baseline {t.baseline} → target {t.target} {t.measure}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="chip chip-tag">{t.picked_count} of {eligible} picked up</span>
                <button className="btn btn-sm btn-danger" disabled={busyId === t.id} onClick={() => remove(t)}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One form covering both edit permissions the backend recognizes (see
// routes/kpis.js): `canFullEdit` (create_kpi — PUT /kpis/:id, the KPI's
// actual definition: name/type/measure, plus baseline/target, plus
// deleting it outright) is the broader tier; anyone with only the narrower
// `edit_targets` still gets baseline/target via the unchanged PATCH
// endpoint, same as before — just without the name/type/measure fields or
// the Delete button, since redefining or removing a KPI outright is a
// bigger authority than adjusting its numbers.
function EditKpiForm({ user, kpis, org, canFullEdit }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  const eligible = kpis.filter((k) => inJurisdiction(org, user, k));
  const [kpiId, setKpiId] = useState(eligible[0]?.id || '');
  const k = byId(kpis, Number(kpiId));
  const [name, setName] = useState(k?.name ?? '');
  const [type, setType] = useState(k?.type ?? '');
  const [measure, setMeasure] = useState(k?.measure ?? '');
  const [baseline, setBaseline] = useState(k?.baseline ?? '');
  const [target, setTarget] = useState(k?.target ?? '');
  const [busy, setBusy] = useState(false);

  function onSelect(id) {
    setKpiId(id);
    const found = byId(kpis, Number(id));
    setName(found?.name ?? ''); setType(found?.type ?? ''); setMeasure(found?.measure ?? '');
    setBaseline(found?.baseline ?? ''); setTarget(found?.target ?? '');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (canFullEdit) {
        await api(`/kpis/${kpiId}`, { method: 'PUT', body: { name, type, measure, baseline: Number(baseline), target: Number(target) } });
      } else {
        await api(`/kpis/${kpiId}/targets`, { method: 'PATCH', body: { baseline: Number(baseline), target: Number(target) } });
      }
      toast('KPI updated.');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!k) return;
    if (!window.confirm(`Remove "${k.name}"? Its recorded values, submissions, assignments, and contributions are kept, not deleted — it's recoverable from Recently Removed below.`)) return;
    setBusy(true);
    try {
      await api(`/kpis/${kpiId}`, { method: 'DELETE' });
      toast(`"${k.name}" deleted.`);
      setKpiId('');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  if (eligible.length === 0) {
    return (
      <div className="card text-[12.5px] text-ink-muted mt-3">
        No KPIs currently fall within your scope to edit.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4 mt-3">
      <h3 className="font-display font-bold text-[14px] mb-3">{canFullEdit ? 'Edit or delete a KPI' : 'Edit KPI targets'}</h3>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="KPI">
            <select className="field-input" value={kpiId} onChange={(e) => onSelect(e.target.value)}>
              {eligible.map((k2) => <option key={k2.id} value={k2.id}>{k2.name}</option>)}
            </select>
          </Field>
          {canFullEdit && (
            <>
              <Field label="Name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Type"><input required className="field-input" value={type} onChange={(e) => setType(e.target.value)} /></Field>
              <Field label="Measure"><input required className="field-input" value={measure} onChange={(e) => setMeasure(e.target.value)} /></Field>
            </>
          )}
          <Field label="Baseline"><input required type="number" step="any" className="field-input" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Field>
          <Field label="Target"><input required type="number" step="any" className="field-input" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm" disabled={busy || !kpiId}>Save changes</button>
          {canFullEdit && (
            <button type="button" className="btn btn-sm btn-danger" disabled={busy || !kpiId} onClick={remove}>Delete KPI</button>
          )}
        </div>
      </form>
    </div>
  );
}

// Label always sits directly above its input, full-width within whatever
// grid cell this Field lands in — every field in a row is the same width
// as its neighbours (a text input, a number input, and a select all render
// through the same `field-input` class and this same wrapper), so the
// input boxes themselves line up into clean columns instead of drifting to
// whatever width their own content happened to need.
function Field({ label, children }) {
  return (
    <div className="space-y-1 w-full">
      <label className="field-label block">{label}</label>
      {children}
    </div>
  );
}
