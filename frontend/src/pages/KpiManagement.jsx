import { Children, cloneElement, useEffect, useId, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { api } from '../lib/api.js';
import PaginatedRows from '../components/PaginatedRows.jsx';
import { inJurisdiction, byId, MONTHS } from '../lib/scope.js';
import { withMonthlyMilestones } from '../lib/reportingPeriods.js';
import MonthlyPaceEditor from '../components/MonthlyPaceEditor.jsx';

// Everything to do with the KPI catalogue itself — creating a new KPI,
// managing the "for employees" template pool, and editing or deleting an
// existing KPI's definition/targets — used to live inside Framework.jsx
// alongside org-structure and employee management. Split out into its
// own admin page so "manage the KPI catalogue" and "manage who's in the
// org chart" are two distinct places, not one long scroll of unrelated
// forms. See OrgStructure.jsx (Organisation Maintenance) for the other one.
export default function KpiManagement() {
  const { user, org, kpis, hasPerm } = useApp();
  const canCreateKpi = hasPerm('create_kpi');
  const canEditKpi = canCreateKpi || hasPerm('edit_kpi');
  const canDeleteKpi = canCreateKpi || hasPerm('delete_kpi');
  const canTargets = hasPerm('edit_targets');
  const canManagePace = hasPerm('manage_settings');

  if (!canCreateKpi && !canEditKpi && !canDeleteKpi && !canTargets && !canManagePace) {
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

      {(canEditKpi || canDeleteKpi || canTargets || canManagePace) && <CreatedKpisTable kpis={kpis} canFullEdit={canEditKpi} canEditTargets={canTargets} canCreate={canCreateKpi} canDelete={canDeleteKpi} canManagePace={canManagePace} />}
      {canDeleteKpi && <RecentlyRemoved />}
    </div>
  );
}

// The other half of every "nothing is deleted, it's recoverable" claim made
// on this page: a live list of everything currently soft-removed from the
// KPI catalogue — both employee KPIs (routes/kpis.js's GET /removed) and
// templates from the "for employees" pool (routes/kpiTemplates.js's GET
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
      <button type="button" className="w-full flex items-center justify-between text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="font-display font-bold text-[14px] flex items-center gap-2">
          Recently Removed
          <span className={`chip ${total ? 'chip-rag-amber' : ''}`}>{total}</span>
        </span>
        <span className="text-accent-600 font-semibold text-[12px]">{open ? 'Hide removed items' : 'Review removed KPIs and templates'}</span>
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

// Owner type "Employee" no longer means "pick one named person" — it
// means "pick the Unit these employees fall under", so the KPI is
// created ONCE and everyone in that unit can pick it up as their own (see
// KpiTemplatesSection below and routes/kpiTemplates.js). Creating a real,
// single-owner employee KPI directly (the old behavior) is still exactly
// what EditKpiForm's catalog edits, so nothing that already exists this way
// breaks — this form just no longer creates NEW ones that way, since a
// Unit-scoped pool is strictly more useful (one definition, any number of
// people in that unit can adopt it) for the same intent.
// Escape-to-close for the Create KPI popup below — same pattern Permissions.jsx
// uses for its role-permissions dialog, kept local here since KpiManagement has
// no shared Modal component to pull it from; backdrop clicks are stopped
// locally so interacting with the form doesn't dismiss it.
function useEscapeToClose(onClose) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// Was always rendered inline at the top of the (already-expanded) catalogue
// table, pushing every row down by a full form's height whether or not
// anyone was actually creating something right now. Now opened as a popup
// from its own "Create KPI" button and closed automatically the moment a
// create succeeds — onClose is only ever called after a successful submit,
// or when the person explicitly backs out (✕, backdrop click, Escape), so a
// KPI actually created never leaves the dialog hanging around behind it.
function AddKpiForm({ onClose }) {
  const { org, reloadCore, reloadTemplates } = useApp();
  const toast = useToast();
  useEscapeToClose(onClose);
  const [ownerType, setOwnerType] = useState('sub');
  const [ownerId, setOwnerId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [measure, setMeasure] = useState('');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [measurementDirection, setMeasurementDirection] = useState('higher');
  const [weight, setWeight] = useState('1');
  const [achievementRule, setAchievementRule] = useState('ratio');
  const [reportingMode, setReportingMode] = useState('cumulative');
  const [periodAggregation, setPeriodAggregation] = useState('latest');
  const [monthlyMilestones, setMonthlyMilestones] = useState(Array(12).fill(''));
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [busy, setBusy] = useState(false);

  // Employee-type KPIs are scoped by Unit now (a template pool), so they
  // share the Unit picker with owner_type='unit' KPIs — the two just create
  // different things on submit.
  const options = ownerType === 'sub' ? org.subs : org.units;
  // Only meaningful once a Unit owner is actually picked — the same rule
  // the backend enforces (custodians only ever apply to a Unit-owned KPI).
  const unitEmployees = ownerType === 'unit' && ownerId
    ? org.employees.filter((i) => i.unit_id === Number(ownerId))
    : [];

  function toggleAssignee(id) {
    setAssigneeIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const chosenId = Number(ownerId || options[0]?.id);
      const reportingPeriods = withMonthlyMilestones([], monthlyMilestones);
      if (ownerType === 'employee') {
        await api('/kpi-templates', { method: 'POST', body: { unitId: chosenId, name, type, measure, baseline: Number(baseline), target: Number(target), measurementDirection, weight: Number(weight), achievementRule, reportingMode, periodAggregation, reportingPeriods } });
        toast('KPI created for staff in this unit — each one can now pick it up as their own from My Data Entry.');
      } else {
        await api('/kpis', {
          method: 'POST',
          body: {
            ownerType, ownerId: chosenId, name, type, measure,
            baseline: Number(baseline), target: Number(target),
            measurementDirection, weight: Number(weight),
            achievementRule, reportingMode, periodAggregation,
            reportingPeriods,
            assigneeIds: ownerType === 'unit' ? assigneeIds : undefined,
          },
        });
        toast(assigneeIds.length ? `KPI created and assigned to ${assigneeIds.length} custodian(s).` : 'KPI created.');
      }
      setName(''); setType(''); setMeasure(''); setBaseline(''); setTarget(''); setMeasurementDirection('higher'); setWeight('1'); setAchievementRule('ratio'); setReportingMode('cumulative'); setPeriodAggregation('latest'); setMonthlyMilestones(Array(12).fill('')); setAssigneeIds([]);
      await Promise.all([reloadCore(), ownerType === 'employee' ? reloadTemplates() : Promise.resolve()]);
      onClose();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="create-kpi-title">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-surface border border-line shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-none">
          <h2 id="create-kpi-title" className="font-display font-bold text-[14.5px]">Create a KPI</h2>
          <button type="button" className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 p-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-3">
            <Field label="Owner type" uniform>
              <select className="field-input" value={ownerType} onChange={(e) => { setOwnerType(e.target.value); setOwnerId(''); setAssigneeIds([]); }}>
                <option value="sub">Sub-programme</option>
                <option value="unit">Unit</option>
                <option value="employee">Staff (under a unit)</option>
              </select>
            </Field>
            <Field label={ownerType === 'employee' ? 'Unit their staff fall under' : 'Owner'} uniform>
              <select className="field-input" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setAssigneeIds([]); }}>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Name" uniform><input required className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Type" uniform><input required placeholder="Efficiency / Growth / Compliance…" className="field-input" value={type} onChange={(e) => setType(e.target.value)} /></Field>
            <Field label="Measure (unit)" uniform><input required placeholder="%, count, days…" className="field-input" value={measure} onChange={(e) => setMeasure(e.target.value)} /></Field>
            <Field label="Baseline" uniform><input required type="number" step="any" className="field-input" value={baseline} onChange={(e) => setBaseline(e.target.value)} /></Field>
            <Field label="Target" uniform><input required type="number" step="any" className="field-input" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
            <Field label="Measurement direction" uniform>
              <select className="field-input" value={measurementDirection} onChange={(e) => setMeasurementDirection(e.target.value)}>
                <option value="higher">Higher is better</option>
                <option value="lower">Lower is better</option>
              </select>
            </Field>
            <Field label="KPI weight" uniform><input required min="0.0001" type="number" step="any" className="field-input" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
            <Field label="Achievement rule" uniform>
              <select className="field-input" value={achievementRule} onChange={(e) => setAchievementRule(e.target.value)}>
                <option value="ratio">Positive-target ratio</option>
                <option value="exact_target">Exact target match</option>
                <option value="baseline_progress">Approved baseline progress rule</option>
              </select>
            </Field>
            <Field label="Reporting mode" uniform>
              <select className="field-input" value={reportingMode} onChange={(e) => setReportingMode(e.target.value)}>
                <option value="cumulative">Cumulative snapshot</option>
                <option value="period">Period-specific actual</option>
              </select>
            </Field>
            {reportingMode === 'period' && (
              <Field label="Period aggregation" uniform>
                <select className="field-input" value={periodAggregation} onChange={(e) => setPeriodAggregation(e.target.value)}>
                  <option value="latest">Latest approved actual in range</option>
                  <option value="sum">Sum monthly actuals (additive measures only)</option>
                </select>
              </Field>
            )}
          </div>
          <details className="rounded-lg border border-line px-3 py-2.5">
            <summary className="cursor-pointer text-[12px] font-bold text-ink">
              Monthly expected pace milestones (optional)
            </summary>
            <p className="mb-3 mt-1 text-[11px] text-ink-secondary">
              Enter the expected KPI value for each month. Leave months blank when no milestone is configured.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {MONTHS.slice(1).map((month, index) => (
                <Field key={month} label={month}>
                  <input
                    type="number"
                    step="any"
                    className="field-input"
                    value={monthlyMilestones[index]}
                    onChange={(event) => setMonthlyMilestones((current) => current.map((value, valueIndex) => valueIndex === index ? event.target.value : value))}
                    aria-label={`${month} expected KPI value`}
                  />
                </Field>
              ))}
            </div>
          </details>
          {ownerType === 'employee' && (
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
              {unitEmployees.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {unitEmployees.map((i) => (
                    <label key={i.id} className={`chip cursor-pointer select-none ${assigneeIds.includes(i.id) ? 'bg-accent-50 text-accent-600' : 'bg-sunken text-ink-secondary border border-line'}`}>
                      <input type="checkbox" className="sr-only" checked={assigneeIds.includes(i.id)} onChange={() => toggleAssignee(i.id)} />
                      {i.name} — {i.role_title}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-[11.5px] text-ink-muted">No staff in this unit yet — add one from People &amp; Roles first.</p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Creating…' : 'Create KPI'}</button>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}


// Created KPI catalogue — starts collapsed; a click on the header opens it,
// same as every other collapsible table in the app. A search filter is
// available only while the catalogue is open.
function CreatedKpisTable({ kpis, canFullEdit, canEditTargets, canCreate, canDelete, canManagePace }) {
  const { org, reloadCore, user } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPace, setEditingPace] = useState(null);

  const activeKpis = (kpis || []).filter((k) => !k.deleted_at && !k.removed_at);

  const filtered = activeKpis.filter((k) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;

    return [
      k.name,
      k.type,
      k.measure,
      k.owner_type,
      k.owner_name,
      k.unit_name,
      k.subprogramme_name,
      k.subprogram_name,
      k.programme_name,
      ownerName(k),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });

  function ownerName(k) {
    if (k.owner_name || k.subprogramme_name || k.subprogram_name || k.unit_name) {
      return k.owner_name || k.subprogramme_name || k.subprogram_name || k.unit_name;
    }
    const owners = {
      sub: org.subs,
      unit: org.units,
      employee: org.employees,
    };
    return owners[k.owner_type]?.find((owner) => owner.id === k.owner_id)?.name;
  }

  function startEdit(k) {
    setEditingId(k.id);
    setDraft({
      name: k.name || '', type: k.type || '', measure: k.measure || '',
      baseline: k.baseline ?? '', target: k.target ?? '',
      measurementDirection: k.measurement_direction || 'higher', weight: k.weight ?? 1,
    });
  }

  async function saveEdit(k) {
    setBusyId(k.id);
    try {
      await api(`/kpis/${k.id}${canFullEdit ? '' : '/targets'}`, {
        method: canFullEdit ? 'PUT' : 'PATCH',
        body: canFullEdit
          ? { ...draft, baseline: Number(draft.baseline), target: Number(draft.target), weight: Number(draft.weight) }
          : { baseline: Number(draft.baseline), target: Number(draft.target) },
      });
      setEditingId(null);
      setDraft(null);
      toast('KPI updated.');
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function remove(k) {
    if (!(await confirm({
      title: `Remove "${k.name}"?`,
      message: 'Its recorded values and history are kept and it can be restored later.',
      confirmLabel: 'Remove',
      tone: 'danger',
    }))) return;
    setBusyId(k.id);
    try {
      await api(`/kpis/${k.id}`, { method: 'DELETE' });
      toast(`"${k.name}" deleted.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function submitConfiguration(k) {
    setBusyId(k.id);
    try {
      await api(`/kpis/${k.id}/submit-configuration`, { method: 'POST' });
      toast(`"${k.name}" submitted for approval.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function approveConfiguration(k) {
    setBusyId(k.id);
    try {
      await api(`/kpis/${k.id}/approve-configuration`, { method: 'POST' });
      toast(`"${k.name}" approved and active.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  function ownerLabel(k) {
    const name = ownerName(k);
    if (name) return name;
    if (k.owner_type === 'sub') return 'Sub-programme';
    if (k.owner_type === 'unit') return 'Unit';
    if (k.owner_type === 'employee') return 'Staff';
    return '—';
  }

  return (
    <div className="card mt-4">
      <button
        type="button"
        className="w-full flex items-center justify-between text-left"
        onClick={() => {
          setOpen((v) => !v);
          if (open) setSearch('');
        }}
        aria-expanded={open}
        aria-controls="created-kpi-catalogue"
      >
        <span className="font-display font-bold text-[14px] flex items-center gap-2">
          Created KPIs
          <span className="chip">{activeKpis.length}</span>
        </span>
        <span className="text-accent-600 font-semibold text-[12px]">
          {open ? 'Hide catalogue' : 'Browse KPI catalogue'}
        </span>
      </button>

      <p className="text-[12px] text-ink-muted mt-1">
        Search and review active KPIs in the catalogue.
      </p>

      {open && (
        <div id="created-kpi-catalogue" className="mt-3">
          {canCreate && (
            <div className="mb-3">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                + Create KPI
              </button>
            </div>
          )}
          {showCreate && <AddKpiForm onClose={() => setShowCreate(false)} />}
          <div className="mb-3">
            <label className="field-label block mb-1">Search created KPIs</label>
            <input
              type="search"
              className="field-input w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by KPI name, type, measure, owner or programme…"
              aria-label="Search created KPIs"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg bg-sunken border border-line px-3 py-5 text-center text-[12px] text-ink-muted">
              {activeKpis.length === 0
                ? 'No created KPIs are currently available.'
                : 'No KPIs match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-sunken border-b border-line sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">KPI</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Type</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Measure</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Owner</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Baseline</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Target</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Direction</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Weight</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Status</th>
                    <th className="px-3 py-2 font-bold whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <PaginatedRows items={filtered} colSpan={10} emptyMessage="No KPIs match your search." renderRow={(k) => (
                    <tr key={k.id} className="border-b border-line last:border-b-0 hover:bg-sunken/60">
                      <td className="px-3 py-2.5 font-semibold">{editingId === k.id && canFullEdit ? <input className="field-input min-w-32" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /> : (k.name || '—')}</td>
                      <td className="px-3 py-2.5">{editingId === k.id && canFullEdit ? <input className="field-input min-w-28" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} /> : (k.type || '—')}</td>
                      <td className="px-3 py-2.5">{editingId === k.id && canFullEdit ? <input className="field-input min-w-28" value={draft.measure} onChange={(e) => setDraft({ ...draft, measure: e.target.value })} /> : (k.measure || '—')}</td>
                      <td className="px-3 py-2.5">{ownerLabel(k)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{editingId === k.id ? <input type="number" step="any" className="field-input w-24" value={draft.baseline} onChange={(e) => setDraft({ ...draft, baseline: e.target.value })} /> : (k.baseline ?? '—')}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{editingId === k.id ? <input type="number" step="any" className="field-input w-24" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} /> : (k.target ?? '—')}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {editingId === k.id && canFullEdit
                          ? <select className="field-input" value={draft.measurementDirection} onChange={(e) => setDraft({ ...draft, measurementDirection: e.target.value })}><option value="higher">Higher</option><option value="lower">Lower</option></select>
                          : k.measurement_direction === 'lower' ? 'Lower is better' : 'Higher is better'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {editingId === k.id && canFullEdit
                          ? <input min="0.0001" type="number" step="any" className="field-input w-24" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: e.target.value })} />
                          : (k.weight ?? 1)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="chip">{k.lifecycle_status || 'active'}</span>
                        {k.rejection_reason && <div className="text-[10px] text-red-700 max-w-40">{k.rejection_reason}</div>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {editingId === k.id ? (
                          <span className="flex gap-1">
                            <button className="btn btn-sm btn-primary" disabled={busyId === k.id} onClick={() => saveEdit(k)}>Save</button>
                            <button className="btn btn-sm" disabled={busyId === k.id} onClick={() => { setEditingId(null); setDraft(null); }}>Cancel</button>
                          </span>
                        ) : (
                          <span className="flex gap-1">
                            {(canFullEdit || canEditTargets) && <button className="btn btn-sm" onClick={() => startEdit(k)}>Edit</button>}
                            {(canFullEdit || canManagePace) && <button className="btn btn-sm" onClick={() => setEditingPace(k)}>Pace</button>}
                            {canCreate && ['draft', 'rejected'].includes(k.lifecycle_status) && (
                              <button className="btn btn-sm" disabled={busyId === k.id} onClick={() => submitConfiguration(k)}>Submit</button>
                            )}
                            {user?.role === 'cpu' && k.lifecycle_status === 'submitted' && (
                              <button className="btn btn-sm btn-primary" disabled={busyId === k.id} onClick={() => approveConfiguration(k)}>Approve</button>
                            )}
                            {canDelete && <button className="btn btn-sm btn-danger" disabled={busyId === k.id} onClick={() => remove(k)}>Delete</button>}
                          </span>
                        )}
                      </td>
                    </tr>
                  )} />
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2 text-[11px] text-ink-muted">
            Showing {filtered.length} of {activeKpis.length} created KPI{activeKpis.length === 1 ? '' : 's'}.
          </div>
        </div>
      )}
      {editingPace && <MonthlyPaceEditor kpi={editingPace} onClose={() => setEditingPace(null)} />}
    </div>
  );
}

// Management view of the Employee-KPI pool created above — what exists,
// which unit it's scoped to, and real adoption (how many people in that
// unit have actually picked it up so far), plus removal for one that was
// created by mistake or is no longer needed (removing it never touches
// anyone's already-picked personal KPI — see db.js's kpi_templates note).
function KpiTemplatesSection() {
  const { org, templates, reloadTemplates } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { reloadTemplates(); }, [reloadTemplates]);

  async function remove(t) {
    if (!(await confirm({
      title: `Remove the "${t.name}" KPI template?`,
      message: `This takes it out of ${t.unit_name}'s pool for anyone who hasn't yet picked it up — anyone who already did keeps their own copy. Recoverable from Recently Removed below.`,
      confirmLabel: 'Remove template',
      tone: 'danger',
    }))) return;
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
      <h3 className="font-display font-bold text-[14px] mb-2">KPIs for staff — by unit</h3>
      <p className="text-[11.8px] text-ink-muted mb-2.5 max-w-[65ch]">
        Every KPI created above for a unit's staff, and how many people in that unit have picked it up so far.
      </p>
      <div className="space-y-2">
        {templates.map((t) => {
          const eligible = org.employees.filter((i) => i.unit_id === t.unit_id).length;
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
  const confirm = useConfirm();
  const eligible = kpis.filter((k) => inJurisdiction(org, user, k));
  const [kpiId, setKpiId] = useState(eligible[0]?.id || '');
  const k = byId(kpis, Number(kpiId));
  const [name, setName] = useState(k?.name ?? '');
  const [type, setType] = useState(k?.type ?? '');
  const [measure, setMeasure] = useState(k?.measure ?? '');
  const [baseline, setBaseline] = useState(k?.baseline ?? '');
  const [target, setTarget] = useState(k?.target ?? '');
  const [measurementDirection, setMeasurementDirection] = useState(k?.measurement_direction || 'higher');
  const [weight, setWeight] = useState(k?.weight ?? 1);
  const [busy, setBusy] = useState(false);

  function onSelect(id) {
    setKpiId(id);
    const found = byId(kpis, Number(id));
    setName(found?.name ?? ''); setType(found?.type ?? ''); setMeasure(found?.measure ?? '');
    setBaseline(found?.baseline ?? ''); setTarget(found?.target ?? '');
    setMeasurementDirection(found?.measurement_direction || 'higher'); setWeight(found?.weight ?? 1);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (canFullEdit) {
        await api(`/kpis/${kpiId}`, { method: 'PUT', body: { name, type, measure, baseline: Number(baseline), target: Number(target), measurementDirection, weight: Number(weight) } });
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
    if (!(await confirm({
      title: `Remove "${k.name}"?`,
      message: 'Its recorded values, submissions, assignments, and contributions are kept, not deleted — it’s recoverable from Recently Removed below.',
      confirmLabel: 'Remove',
      tone: 'danger',
    }))) return;
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
          {canFullEdit && (
            <>
              <Field label="Measurement direction">
                <select className="field-input" value={measurementDirection} onChange={(e) => setMeasurementDirection(e.target.value)}>
                  <option value="higher">Higher is better</option>
                  <option value="lower">Lower is better</option>
                </select>
              </Field>
              <Field label="KPI weight"><input required min="0.0001" type="number" step="any" className="field-input" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
            </>
          )}
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
// Every call site below wraps exactly one real input/select/textarea, so
// this can generate one stable id per Field instance (useId — unique even
// across many Fields rendered from a map, e.g. one per KPI row) and wire
// it onto both the <label>'s htmlFor and the child's id automatically,
// rather than needing every one of Field's ~15 call sites in this file
// edited by hand. Falls back to an unassociated (but still visually
// identical) label if a caller ever passes something Field can't safely
// clone a prop onto, instead of crashing.
function Field({ label, children, uniform = false }) {
  const generatedId = useId();
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const child = only && typeof only === 'object' && only.type ? only : null;
  const inputId = child ? (child.props.id || generatedId) : undefined;
  const controlClass = child?.props.className || '';
  return (
    <div className={uniform ? 'flex h-full w-full flex-col gap-1' : 'space-y-1 w-full'}>
      <label htmlFor={inputId} className={`field-label block${uniform ? ' min-h-[2.5rem] leading-5' : ''}`}>{label}</label>
      {child ? cloneElement(child, {
        id: inputId,
        ...(uniform ? { className: `${controlClass} h-11` } : {}),
      }) : children}
    </div>
  );
}
