import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { inJurisdiction, byId } from '../lib/scope.js';

export default function Framework() {
  const { user, org, kpis, hasPerm } = useApp();
  const canUnits = hasPerm('manage_org_units');
  // add_individual is the narrower sibling of manage_org_units — see
  // backend/src/routes/org.js — real but scope-restricted to the holder's
  // own unit (Unit Head) or sub-programme (Sub Rep) when granted on its own.
  const canAddIndividual = canUnits || hasPerm('add_individual');
  const canKpi = hasPerm('create_kpi');
  const canTargets = hasPerm('edit_targets');
  const canPropose = hasPerm('manage_framework');

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Framework</h1>
        <p className="text-[13px] text-ink-secondary">Organisational structure and KPI catalogue.</p>
      </div>

      <OrgTree org={org} canManage={canUnits} />
      {canUnits && <AddUnitForm />}
      {canAddIndividual && <AddIndividualForm restrictToOwnScope={!canUnits} />}
      {canKpi && <AddKpiForm />}
      {canKpi && <KpiTemplatesSection />}
      {(canKpi || canTargets) && <EditKpiForm user={user} kpis={kpis} org={org} canFullEdit={canKpi} />}
      <ProposalsSection canPropose={canPropose} />
    </div>
  );
}

// A real, persisted queue of structural-change proposals — distinct from the
// direct unit/KPI creation above, which takes effect immediately. Nothing
// currently auto-actions an entry here (no approval workflow is wired to
// it); it's a durable record for CPU/exec to review, e.g. "split this
// Sub-programme into two" ahead of a planning checkpoint.
function ProposalsSection({ canPropose }) {
  const toast = useToast();
  const [proposals, setProposals] = useState(null);
  const [scope, setScope] = useState('sub');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const r = await api('/org/proposals'); setProposals(r.proposals); } catch (_) { setProposals([]); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api('/org/proposals', { method: 'POST', body: { scope, text: text.trim() } });
      toast('Proposal recorded.');
      setText('');
      await load();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6">
      <h2 className="font-display font-bold text-[14.5px] mb-2.5">Propose a structural change</h2>
      {canPropose ? (
        <form onSubmit={submit} className="rounded-xl bg-sunken border border-line p-4 mb-3 space-y-3">
          <Field label="Scope">
            <select className="field-input" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="sub">Sub-programme / Unit-level (ZOU's own checkpoint)</option>
              <option value="programme">Programme-level (needs Ministry / PM&amp;E sign-off)</option>
            </select>
          </Field>
          <Field label="Proposal">
            <textarea rows={2} required className="field-input" placeholder="e.g. Split Innovation & Enterprises into two Sub-programmes"
              value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-sm" disabled={busy}>Record proposal</button>
        </form>
      ) : (
        <div className="card text-[12.5px] text-ink-muted mb-3">Only users granted the "Propose structural changes" permission can submit a proposal here.</div>
      )}
      {proposals?.length > 0 && (
        <div className="space-y-2">
          {proposals.map((p) => (
            <div key={p.id} className="card flex items-start gap-2.5 flex-wrap">
              <span className={`chip ${p.scope === 'programme' ? 'chip-rag-red' : 'chip-rag-green'}`}>
                {p.scope === 'programme' ? 'Programme-level — routed to Ministry/PM&E' : 'Sub-programme/Unit-level — ZOU checkpoint'}
              </span>
              <span className="flex-1 text-[12.6px]">{p.text}</span>
              <span className="text-[11px] text-ink-muted whitespace-nowrap">{p.created_by_name || 'System'} · {p.created_at}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrgTree({ org, canManage }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  async function removeIndividual(ind) {
    if (!window.confirm(`Remove ${ind.name} and their account? This cannot be undone.`)) return;
    setBusyId(ind.id);
    try {
      await api(`/org/individuals/${ind.id}`, { method: 'DELETE' });
      toast(`${ind.name} removed.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  return (
    <div className="space-y-3 mb-3">
      {org.programmes.map((p) => {
        const subs = org.subs.filter((s) => s.programme_id === p.id);
        return (
          <div key={p.id} className="card">
            <div><b>{p.name}</b> <span className="text-ink-muted text-[12px]">Head: {p.head}</span></div>
            {subs.map((s) => {
              const units = org.units.filter((u) => u.sub_id === s.id);
              return (
                <div key={s.id} className="pl-2 mt-1.5 text-[12.8px]">
                  ◆ <b>{s.name}</b> <span className="text-ink-muted">(Head: {s.head})</span>
                  {units.map((u) => {
                    const inds = org.individuals.filter((i) => i.unit_id === u.id);
                    return (
                      <div key={u.id} className="pl-5 mt-1 text-[12.8px]">
                        ▸ <b>{u.name}</b> <span className="text-ink-muted">({u.kind} · Head: {u.head})</span>
                        {inds.map((i) => (
                          <div key={i.id} className="pl-8 text-ink-muted text-[12px] flex items-center gap-2">
                            <span>• {i.name} — {i.role_title || ''}</span>
                            {canManage && (
                              <button
                                onClick={() => removeIndividual(i)}
                                disabled={busyId === i.id}
                                className="text-critical hover:underline disabled:opacity-40"
                              >
                                remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// restrictToOwnScope: true when the caller holds only the narrower
// add_individual permission (not manage_org_units) — the unit dropdown is
// then limited to the units they could actually succeed against server-side
// (their own unit if they're a Unit Head, or any unit in their own
// sub-programme if they're a Sub Rep), so the form never offers a choice
// the backend would reject.
function AddIndividualForm({ restrictToOwnScope }) {
  const { user, org, reloadCore } = useApp();
  const toast = useToast();
  const eligibleUnits = !restrictToOwnScope
    ? org.units
    : user.role === 'unithead'
      ? org.units.filter((u) => u.id === user.scope_id)
      : user.role === 'rep'
        ? org.units.filter((u) => u.sub_id === user.scope_id)
        : [];
  const [unitId, setUnitId] = useState(eligibleUnits[0]?.id || '');
  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/org/individuals', { method: 'POST', body: { unitId: Number(unitId), name, roleTitle } });
      toast(`${name} added. Account: ${r.account.email} (${r.account.note})`);
      setName(''); setRoleTitle('');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  if (restrictToOwnScope && eligibleUnits.length === 0) {
    return (
      <div className="card text-[12.5px] text-ink-muted mt-3">
        You have the "Add an Individual" permission, but no unit/sub-programme of your own to add one under.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4 mt-3">
      <h3 className="font-display font-bold text-[14px] mb-3">Add an individual</h3>
      <form onSubmit={submit} className="flex gap-3 flex-wrap items-end">
        <Field label="Under unit">
          <select className="field-input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {eligibleUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Full name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role / job title"><input required className="field-input" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} /></Field>
        <button className="btn btn-primary btn-sm" disabled={busy || !unitId}>Add individual</button>
      </form>
    </div>
  );
}

function AddUnitForm() {
  const { org, reloadCore } = useApp();
  const toast = useToast();
  const [sub, setSub] = useState(org.subs[0]?.id || '');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('Unit');
  const [head, setHead] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/org/units', { method: 'POST', body: { subId: Number(sub), name, kind, head } });
      toast(`Unit created. Head account: ${r.headAccount.email} (${r.headAccount.note})`);
      setName(''); setHead('');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl bg-sunken border border-line p-4 mt-3">
      <h3 className="font-display font-bold text-[14px] mb-3">Add a unit / department / faculty / region</h3>
      <form onSubmit={submit} className="flex gap-3 flex-wrap items-end">
        <Field label="Under sub-programme">
          <select className="field-input" value={sub} onChange={(e) => setSub(e.target.value)}>
            {org.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Name"><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Kind"><input className="field-input" value={kind} onChange={(e) => setKind(e.target.value)} /></Field>
        <Field label="Head (full name)"><input required className="field-input" value={head} onChange={(e) => setHead(e.target.value)} /></Field>
        <button className="btn btn-primary btn-sm" disabled={busy}>Create unit</button>
      </form>
    </div>
  );
}

// Owner type "Individual" no longer means "pick one named person" — it
// means "pick the Unit these individuals fall under", so the KPI is
// created ONCE and everyone in that unit can pick it up as their own (see
// TemplatesSection below and routes/kpiTemplates.js). Creating a real,
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
        <div className="flex gap-3 flex-wrap">
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
        </div>
        <div className="flex gap-3 flex-wrap">
          <Field label="Type"><input required placeholder="Efficiency / Growth / Compliance…" className="field-input" value={type} onChange={(e) => setType(e.target.value)} /></Field>
          <Field label="Measure (unit)"><input required placeholder="%, count, days…" className="field-input" value={measure} onChange={(e) => setMeasure(e.target.value)} /></Field>
          <Field label="Baseline"><input required type="number" step="any" className="field-input w-28" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Field>
          <Field label="Target"><input required type="number" step="any" className="field-input w-28" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
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
              <p className="text-[11.5px] text-ink-muted">No individuals in this unit yet — add one above first.</p>
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
    if (!window.confirm(`Remove the "${t.name}" KPI template from ${t.unit_name}'s pool? Anyone who already picked it up keeps their own copy — this only takes it out of the pool for anyone who hasn't yet.`)) return;
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
    if (!window.confirm(`Delete "${k.name}"? This removes all its recorded values, submissions, assignments, and contributions. This cannot be undone.`)) return;
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
        <div className="flex gap-3 flex-wrap items-end">
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
          <Field label="Baseline"><input required type="number" step="any" className="field-input w-28" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Field>
          <Field label="Target"><input required type="number" step="any" className="field-input w-28" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
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

function Field({ label, children }) {
  return (
    <div className="space-y-1 min-w-[160px] flex-1">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
