import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import {
  byId, computeRag, computeVariance, ownerName, valueStatus,
} from '../lib/scope.js';
import { readDraft, writeDraft, clearDraft, draftDiffersFrom, debounce } from '../lib/autosave.js';
import { AssignmentManager } from './KpiCard.jsx';

const STATUS_LABEL = {
  none: 'Not started', draft: 'Draft', returned: 'Returned', submitted: 'Submitted', approved: 'Approved',
};

// Live "X% of target" readout under the actual-value input — real-time
// feedback tied to the KPI's own baseline/target, not just a bare number
// box, so someone typing "45" can see right away whether that's on track
// without waiting for Save to recompute the Score/Pace columns. Only shown
// once there's both a usable target to divide by and a value typed —
// division-by-zero and empty-input cases just render nothing.
function pctOfTargetLabel(kpi, rawValue) {
  const val = Number(rawValue);
  if (rawValue === '' || rawValue == null || Number.isNaN(val)) return null;
  const target = Number(kpi.target);
  if (!target) return null;
  const baseline = Number(kpi.baseline) || 0;
  const span = target - baseline;
  const pct = span !== 0 ? Math.round(((val - baseline) / span) * 100) : Math.round((val / target) * 100);
  return `${pct}% of target${pct < 0 ? ' (below baseline)' : pct > 100 ? ' (above target)' : ''}`;
}

// One row, one table, one Save and one Submit — replaces what used to be a
// separate card per KPI (each with its own Save/Submit pair) for "My Data
// Entry"'s directly-owned KPI list. Every KPI you own for this period is a
// row here automatically (it maps straight over the live `kpis` list from
// context — a KPI created moments ago by CPU/ICT admin appears the next
// time that list reloads, no separate step to "add" it to this view), every
// column KpiCard used to show scattered across a card is a column here
// instead, and the checkbox column plus the toolbar above let you fill in
// several KPIs' figures and commit them — save, or save-and-submit — in one
// real action instead of one round trip per KPI.
//
// `interactive` false renders the exact same columns read-only, with no
// checkboxes or inputs — used for the "Submitted" / "Approved" sections
// below, where there's genuinely nothing left to type but the same at-a-
// glance columns are still worth having in one table instead of a stack of
// cards.
export default function DataEntryTable({ kpis, interactive = true }) {
  const {
    user, org, settings, values, period, reloadValues,
    assignments, contributions,
  } = useApp();
  const toast = useToast();
  const [selected, setSelected] = useState(() => new Set(interactive ? kpis.map((k) => k.id) : []));
  const [entries, setEntries] = useState({});
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(false);
  // Which row (if any) has its "Manage team" panel open — see the bottom
  // of the table body: a Unit Head delegating one of their Unit's KPIs to
  // specific people used to only be reachable inside the per-KPI card this
  // table replaces (KpiCard's AssignmentManager); it's reused here as an
  // inline expandable row rather than dropped.
  const [expandedTeamId, setExpandedTeamId] = useState(null);

  // Keeps selection in step with the live KPI list: a newly created KPI (or
  // one that just became eligible this period) shows up pre-selected same
  // as every other row — knownIdsRef is what tells "genuinely new id,
  // default it to selected" apart from "an id we've seen before, respect
  // whatever the person set it to (including having unchecked it)" — and
  // one that's no longer in the list (submitted, approved, deleted) simply
  // drops out, since only current `kpis` are ever iterated below.
  const kpiIds = kpis.map((k) => k.id).join(',');
  const knownIdsRef = useRef(new Set());
  useEffect(() => {
    if (!interactive) return;
    setSelected((prev) => {
      const next = new Set();
      kpis.forEach((k) => {
        if (knownIdsRef.current.has(k.id)) { if (prev.has(k.id)) next.add(k.id); }
        else next.add(k.id);
      });
      return next;
    });
    knownIdsRef.current = new Set(kpis.map((k) => k.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiIds, interactive]);

  function rowFor(kpi) {
    const valueRow = values[`${kpi.id}-${period.year}-${period.month}`];
    const status = valueStatus(valueRow);
    const isPreview = !!(valueRow && valueRow.value == null && valueRow.preview_value != null);
    const effectiveRow = isPreview ? { ...valueRow, value: valueRow.preview_value } : valueRow;
    const rag = computeRag(kpi, effectiveRow, settings);
    // Pace for THIS period's own row (effectiveRow — same one rag uses,
    // preview value and all), not the separate Overview/Reports
    // "performance lens" period (the old perfValues[kpi.id]) — that lens is
    // independently set and can easily be a different month than whatever
    // period this table is actually showing, which is what let this column
    // show a pace figure unrelated to the data on screen.
    const variance = computeVariance(kpi, effectiveRow, settings);
    const current = effectiveRow ? (effectiveRow.override_value != null ? effectiveRow.override_value : effectiveRow.value) : null;
    const enteredValue = valueRow ? valueRow.entered_value : null;
    const assignees = kpi.owner_type === 'unit'
      ? assignments.filter((a) => a.kpi_id === kpi.id).map((a) => byId(org.individuals, a.individual_id)).filter(Boolean)
      : [];
    const isShared = kpi.owner_type === 'unit' && assignees.length > 0;
    const kpiContributions = isShared ? contributions.filter((c) => c.kpi_id === kpi.id) : [];
    const contribSubmitted = kpiContributions.filter((c) => c.status === 'submitted').length;
    const locked = valueRow && ['submitted', 'approved'].includes(valueRow.status);
    const canSubmit = valueRow && valueRow.status === 'draft' && (isShared ? valueRow.value != null : valueRow.entered_value != null);
    const canManageTeam = interactive && user.role === 'unithead' && kpi.owner_type === 'unit';
    return { valueRow, status, rag, variance, current, enteredValue, isShared, assignees, contribSubmitted, locked, canSubmit, canManageTeam };
  }

  const valueDraftKey = (kpi) => `u${user.id}-kpi${kpi.id}-${period.year}-${period.month}-value`;
  const noteDraftKey = (kpi) => `u${user.id}-kpi${kpi.id}-${period.year}-${period.month}-note`;

  function entryFor(kpi, r) {
    if (kpi.id in entries) return entries[kpi.id];
    const draft = readDraft(valueDraftKey(kpi));
    if (draftDiffersFrom(draft, r.enteredValue)) return draft;
    return r.enteredValue != null ? String(r.enteredValue) : '';
  }
  function noteFor(kpi, r) {
    if (kpi.id in notes) return notes[kpi.id];
    const draft = readDraft(noteDraftKey(kpi));
    if (draftDiffersFrom(draft, r.valueRow?.explanation)) return draft;
    return r.valueRow?.explanation || '';
  }

  // One debounced draft-writer, reused for every row (see lib/autosave.js
  // and KpiCard's identical pattern) — keyed per call by each row's own
  // valueDraftKey/noteDraftKey, so different rows never share a timer.
  const debouncedWriteDraft = useMemo(() => debounce(writeDraft), []);

  function setEntry(kpi, v) { setEntries((e) => ({ ...e, [kpi.id]: v })); debouncedWriteDraft(valueDraftKey(kpi), v); }
  function setNote(kpi, v) { setNotes((n) => ({ ...n, [kpi.id]: v })); debouncedWriteDraft(noteDraftKey(kpi), v); }

  function toggle(id) {
    setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  const selectableIds = kpis.filter((k) => !rowFor(k).locked).map((k) => k.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  function toggleAll() {
    setSelected((s) => {
      if (allSelected) return new Set();
      return new Set(selectableIds);
    });
  }

  async function saveSelected(alsoSubmit) {
    const rows = kpis.filter((k) => selected.has(k.id) && !rowFor(k).locked);
    if (rows.length === 0) { toast('Select at least one KPI first.', 'err'); return; }

    // Directly-entered rows go through bulk-value; a shared/automated row
    // has nothing to save here (its value comes from team contributions —
    // see recomputeUnitTotal on the backend), it only ever gets submitted.
    const editable = rows.filter((k) => !rowFor(k).isShared);
    const valueEntries = editable
      .map((k) => ({ id: k.id, value: entryFor(k, rowFor(k)) }))
      .map((e) => ({ id: e.id, value: e.value === '' ? null : Number(e.value) }));

    setBusy(true);
    try {
      if (valueEntries.length > 0) {
        await api('/kpis/bulk-value', { method: 'PUT', body: { year: period.year, month: period.month, entries: valueEntries } });
        editable.forEach((k) => clearDraft(valueDraftKey(k)));
      }
      // Notes ride along on the same click — one real request per row that
      // actually has a changed note (no bulk-note endpoint on the backend;
      // this is still one user action, not a separate "save note" trip per
      // KPI the way the old per-card layout required).
      const noteWrites = rows
        .map((k) => ({ kpi: k, text: noteFor(k, rowFor(k)) }))
        .filter(({ kpi, text }) => text !== (rowFor(kpi).valueRow?.explanation || ''));
      await Promise.all(noteWrites.map(({ kpi, text }) =>
        api(`/kpis/${kpi.id}/explanation`, { method: 'PUT', body: { year: period.year, month: period.month, text } })
          .then(() => clearDraft(noteDraftKey(kpi)))
      ));

      if (alsoSubmit) {
        const submittable = rows.filter((k) => {
          const r = rowFor(k);
          // A row just saved this click now has its entered_value in the
          // just-written batch, not yet reflected in this render's stale
          // `values` — so canSubmit here also accepts "we just sent a
          // real, non-empty value for it above", not only the pre-save
          // snapshot's own canSubmit flag.
          const justSaved = valueEntries.find((e) => e.id === k.id);
          return r.canSubmit || (justSaved && justSaved.value != null) || (r.isShared && r.valueRow?.value != null);
        });
        if (submittable.length > 0) {
          await api('/kpis/bulk-submit', { method: 'POST', body: { year: period.year, month: period.month, ids: submittable.map((k) => k.id) } });
        }
      }

      toast(alsoSubmit ? `Saved and submitted ${rows.length} KPI${rows.length > 1 ? 's' : ''}.` : `Saved ${valueEntries.length} KPI${valueEntries.length === 1 ? '' : 's'}.`);
      setEntries({});
      setNotes({});
      await reloadValues();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  if (kpis.length === 0) return null;

  return (
    <div>
      {interactive && (
        <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
          <span className="text-[11.8px] text-ink-secondary">
            {selected.size} of {kpis.length} selected
          </span>
          <button className="btn btn-sm ml-auto" disabled={busy || selected.size === 0} onClick={() => saveSelected(false)}>
            Save selected
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy || selected.size === 0} onClick={() => saveSelected(true)}>
            Save &amp; submit selected
          </button>
        </div>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-[12.3px] border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-ink-muted text-[10.8px] uppercase tracking-wide">
              {interactive && (
                <th className="w-8 px-3 py-2.5">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
              )}
              <th className="px-3 py-2.5 min-w-[220px]">KPI</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Baseline</th>
              <th className="px-3 py-2.5 text-right">Target</th>
              <th className="px-3 py-2.5 text-right">Current</th>
              <th className="px-3 py-2.5 min-w-[130px]">This period's actual</th>
              <th className="px-3 py-2.5">Score</th>
              <th className="px-3 py-2.5">Pace</th>
              <th className="px-3 py-2.5 min-w-[180px]">Notes</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((kpi) => {
              const r = rowFor(kpi);
              const rowInteractive = interactive && !r.locked;
              const teamOpen = expandedTeamId === kpi.id;
              return (
                <Fragment key={kpi.id}>
                <tr className={`border-b border-line last:border-b-0 align-top ${r.locked ? 'bg-sunken/40' : ''}`}>
                  {interactive && (
                    <td className="px-3 py-2.5">
                      <input type="checkbox" disabled={r.locked} checked={selected.has(kpi.id)} onChange={() => toggle(kpi.id)} aria-label={`Select ${kpi.name}`} />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-[12.8px] leading-snug">{kpi.name}</div>
                    <div className="flex gap-1 flex-wrap mt-1 items-center">
                      <span className="chip chip-tag text-[10px] px-1.5 py-0.5">{ownerName(org, kpi)}</span>
                      <span className="chip chip-tag text-[10px] px-1.5 py-0.5">{kpi.type}</span>
                      {r.isShared && (
                        <span className="chip bg-accent-50 text-accent-600 text-[10px] px-1.5 py-0.5" title={`${r.contribSubmitted} team member(s) have submitted this period`}>
                          Team KPI ({r.assignees.length})
                        </span>
                      )}
                      {r.canManageTeam && (
                        <button
                          className="text-[10.5px] text-accent-600 hover:underline"
                          onClick={() => setExpandedTeamId(teamOpen ? null : kpi.id)}
                        >
                          {teamOpen ? 'Hide team ▴' : 'Manage team ▾'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`chip chip-st-${r.status} text-[10.8px] px-2 py-0.5`}>{STATUS_LABEL[r.status]}</span>
                    {r.valueRow?.return_comment && r.status === 'returned' && (
                      <div className="text-[10.8px] text-warning mt-1 max-w-[160px]" title={r.valueRow.return_comment}>
                        “{r.valueRow.return_comment}”
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.baseline}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.target} <span className="text-ink-muted">{kpi.measure}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.current != null ? r.current : '—'}</td>
                  <td className="px-3 py-2.5">
                    {r.isShared ? (
                      <span className="text-ink-muted text-[11.5px]" title="Computed automatically from your team's approved contributions">
                        {r.valueRow?.value != null ? `${r.valueRow.value} ${kpi.measure}` : '— (from team)'}
                      </span>
                    ) : rowInteractive ? (
                      <div>
                        <input
                          type="number" step="any"
                          className="field-input w-full py-1.5"
                          placeholder={kpi.measure ? `Actual (${kpi.measure})` : 'Actual'}
                          value={entryFor(kpi, r)}
                          onChange={(e) => setEntry(kpi, e.target.value)}
                        />
                        {pctOfTargetLabel(kpi, entryFor(kpi, r)) && (
                          <div className="text-[10.5px] text-ink-muted mt-0.5">{pctOfTargetLabel(kpi, entryFor(kpi, r))}</div>
                        )}
                      </div>
                    ) : (
                      <span className="tabular-nums">{r.enteredValue != null ? `${r.enteredValue} ${kpi.measure}` : '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`chip text-[11px] px-2 py-0.5 ${r.rag.cls}`}>{r.rag.label}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.variance.flag === 'attention' && (
                      <span className="chip bg-critical text-white text-[10.5px] px-1.5 py-0.5" title={`${r.variance.actualPct}% actual vs ${r.variance.expectedPct}% expected pace`}>
                        ⚠ {r.variance.variance}pts behind
                      </span>
                    )}
                    {r.variance.flag === 'ahead' && (
                      <span className="chip chip-rag-green text-[10.5px] px-1.5 py-0.5">+{r.variance.variance}pts ahead</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {rowInteractive ? (
                      <input
                        type="text" placeholder="Optional note"
                        className="field-input w-full py-1.5"
                        value={noteFor(kpi, r)}
                        onChange={(e) => setNote(kpi, e.target.value)}
                      />
                    ) : (
                      <span className="text-ink-secondary text-[11.5px]">{r.valueRow?.explanation || '—'}</span>
                    )}
                  </td>
                </tr>
                {teamOpen && (
                  <tr className="border-b border-line bg-sunken/30">
                    <td colSpan={interactive ? 10 : 9} className="px-3 py-3">
                      <AssignmentManager kpi={kpi} assignees={r.assignees} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
