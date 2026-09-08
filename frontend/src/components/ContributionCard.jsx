import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { ownerName, valueStatus, computeRag } from '../lib/scope.js';
import { readDraft, writeDraft, clearDraft, draftDiffersFrom, debounce } from '../lib/autosave.js';
import Fig from './Fig.jsx';
import MonthlyPaceBar from './MonthlyPaceBar.jsx';

const STATUS_LABEL = { none: 'Not started', draft: 'Draft', returned: 'Returned', submitted: 'Submitted', approved: 'Approved' };

// An Individual's own figure toward a shared Unit-owned KPI (see
// backend/src/routes/kpis.js's kpi_contributions) — deliberately a sibling
// of KpiCard, not a mode on it: this never touches the KPI's own value, it
// submits into kpi_contributions for the Unit Head to review, who then
// approves it (folding it into the KPI's real, automated total alongside
// everyone else assigned to it) or returns it with feedback, same shape as
// every other submission in this app just one level down.
export default function ContributionCard({ kpi, contributionRow }) {
  const { user, org, values, settings, period, reloadContributions } = useApp();
  const toast = useToast();
  const status = valueStatus(contributionRow);
  const current = contributionRow?.value ?? null;

  // The shared KPI's own overall figures — not this person's own submitted
  // value, which is just one input into it. A contributor never owned this
  // number before (see KpiCard, where an owner sees exactly this), but they
  // should be able to see the same Baseline/Target/automated score their
  // Unit Head sees, right where they're submitting toward it — otherwise
  // "submit your figure" would be asking them to work blind.
  const kpiValueRow = values[`${kpi.id}-${period.year}-${period.month}`];
  const kpiCurrent = kpiValueRow ? (kpiValueRow.override_value != null ? kpiValueRow.override_value : kpiValueRow.value) : null;
  const rag = computeRag(kpi, kpiValueRow, settings);

  // Same local-only safety net as KpiCard (see lib/autosave.js) — a power
  // cut or crashed tab mid-typing, before Save was ever clicked, doesn't
  // lose the figure someone was in the middle of entering.
  const valueDraftKey = `u${user.id}-kpi${kpi.id}-${period.year}-${period.month}-contrib-value`;
  const noteDraftKey = `u${user.id}-kpi${kpi.id}-${period.year}-${period.month}-contrib-note`;
  const savedValueDraft = readDraft(valueDraftKey);
  const savedNoteDraft = readDraft(noteDraftKey);
  const restoredValue = draftDiffersFrom(savedValueDraft, current);
  const restoredNote = draftDiffersFrom(savedNoteDraft, contributionRow?.explanation);

  const [entryValue, setEntryValue] = useState(restoredValue ? savedValueDraft : (current != null ? String(current) : ''));
  const [explanation, setExplanation] = useState(restoredNote ? savedNoteDraft : (contributionRow?.explanation || ''));
  const [busy, setBusy] = useState(false);

  // Debounced (see lib/autosave.js and KpiCard's identical comment) — the
  // input updates instantly via React state regardless; only the local
  // recovery mirror waits for typing to actually pause.
  const writeValueDraft = useMemo(() => debounce(writeDraft), []);
  const writeNoteDraft = useMemo(() => debounce(writeDraft), []);
  function onEntryValueChange(v) { setEntryValue(v); writeValueDraft(valueDraftKey, v); }
  function onExplanationChange(v) { setExplanation(v); writeNoteDraft(noteDraftKey, v); }

  async function run(fn, okMsg, onOk) {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg); if (onOk) onOk(); await reloadContributions(); }
    catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  const locked = contributionRow && contributionRow.status === 'submitted';
  const canSubmit = contributionRow && contributionRow.value != null && contributionRow.status === 'draft';

  return (
    <div className="card mb-3.5">
      <div className="flex justify-between gap-3 items-start flex-wrap">
        <div>
          <p className="font-bold text-[15px] leading-snug mb-1.5">{kpi.name}</p>
          <div className="flex gap-1.5 flex-wrap items-center mb-1">
            <span className="chip chip-tag">{ownerName(org, kpi)} — your contribution</span>
            <span className="chip chip-tag">{kpi.type}</span>
            <span className={`chip chip-st-${status}`}>{STATUS_LABEL[status]}</span>
          </div>
          {(contributionRow?.submitted_at || contributionRow?.approved_at) && (
            <div className="text-[11.5px] text-ink-muted flex gap-3 flex-wrap">
              {contributionRow.submitted_at && <span>Submitted {contributionRow.submitted_at} UTC</span>}
              {contributionRow.approved_at && <span>Approved {contributionRow.approved_at} UTC</span>}
            </div>
          )}
        </div>
        <span className={`chip text-[13px] px-2.5 py-1 ${rag.cls}`} title="The Unit's automated score for this KPI — the live sum of everyone's approved contributions against its target">{rag.label}</span>
      </div>

      <div className="mt-3 rounded-xl bg-sunken/60 p-3.5">
        <p className="text-[12px] text-ink-secondary leading-relaxed mb-3">
          Enter what you contributed THIS period only — not a running total. Once your Unit Head approves it, it's
          summed with everyone else's approved figure for the period and added automatically to the Unit's previous
          total, to become its new cumulative {kpi.measure} count.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
          <Fig k="Baseline" v={kpi.baseline} />
          <Fig k="Target" v={kpi.target} />
          <Fig k="Unit's current (cumulative)" v={kpiCurrent != null ? kpiCurrent : '—'} />
          <Fig k="Automated score" v={rag.label} />
        </div>

        {rag.cls === 'chip-rag-red' && (
          <div className="mt-3 rounded-lg bg-critical-soft text-critical text-[12.5px] px-3 py-2.5 font-semibold">
            ⚠ This KPI is currently off track against its target ({rag.label}) — your figure matters to bringing it back on pace.
          </div>
        )}

        <MonthlyPaceBar kpi={kpi} valueRow={kpiValueRow} period={period} />
      </div>

      {contributionRow?.return_comment && status === 'returned' && (
        <div className="mt-2.5 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5">
          <b>Feedback from your Unit Head:</b> {contributionRow.return_comment}
          <span className="block mt-0.5 font-semibold">Update the value below and resubmit when ready.</span>
        </div>
      )}

      {restoredValue && (
        <div className="mt-3 rounded-lg bg-accent-50 text-accent-600 text-[11.5px] px-3 py-2">
          Restored an unsaved value from before — it hadn't been saved yet. Save it below, or overwrite it.
        </div>
      )}
      <div className="flex gap-2 flex-wrap items-end mt-3">
        <div className="space-y-1">
          <label className="field-label">Your value ({kpi.measure})</label>
          <input type="number" step="any" disabled={locked} value={entryValue}
            onChange={(e) => onEntryValueChange(e.target.value)}
            placeholder={kpi.measure ? `e.g. 12 (${kpi.measure})` : undefined}
            className="field-input w-36 py-1.5" />
        </div>
        <button className="btn btn-sm" disabled={locked || busy}
          onClick={() => run(() => api(`/kpis/${kpi.id}/contribution`, { method: 'PUT', body: { year: period.year, month: period.month, value: entryValue === '' ? null : Number(entryValue) } }), 'Value saved.', () => clearDraft(valueDraftKey))}>
          Save value
        </button>
        <button className="btn btn-sm btn-primary" disabled={!canSubmit || busy}
          onClick={() => run(() => api(`/kpis/${kpi.id}/contribution/submit`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Submitted to your Unit Head.', () => clearDraft(valueDraftKey))}>
          Submit
        </button>
      </div>
      {restoredNote && (
        <div className="mt-2.5 rounded-lg bg-accent-50 text-accent-600 text-[11.5px] px-3 py-2">
          Restored an unsaved note from before — it hadn't been saved yet.
        </div>
      )}
      <div className="mt-2.5 space-y-1">
        <label className="field-label">Explanation / notes</label>
        <textarea rows={2} className="field-input" placeholder="Optional context for your Unit Head"
          value={explanation} onChange={(e) => onExplanationChange(e.target.value)} />
      </div>
      <button className="btn btn-sm btn-ghost mt-1.5" disabled={busy}
        onClick={() => run(() => api(`/kpis/${kpi.id}/contribution/explanation`, { method: 'PUT', body: { year: period.year, month: period.month, text: explanation } }), 'Note saved.', () => clearDraft(noteDraftKey))}>
        Save note
      </button>
    </div>
  );
}
