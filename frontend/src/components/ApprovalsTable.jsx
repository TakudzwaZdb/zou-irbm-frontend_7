import { Fragment, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { byId, computeRag, computeVariance, ownerName, valueStatus } from '../lib/scope.js';
import { ContributorsBreakdown } from './KpiCard.jsx';

const STATUS_LABEL = {
  none: 'Not started', draft: 'Draft', returned: 'Returned', submitted: 'Submitted', approved: 'Approved',
};

// Table-based replacement for Approvals Queue's old one-KpiCard-per-KPI
// layout (mirrors DataEntryTable's pattern on My Data Entry). Every figure
// a reviewer used to have to scroll a tall card to find — baseline,
// target, current, what was actually submitted, score, and now also a
// dedicated pace-vs-target column — is a column here instead, so the
// whole queue reads as one scannable table. Approve/Return/team-review/
// override stay real actions, just reached via a "Review" toggle that
// expands a detail row rather than always being on screen, to keep the
// table itself readable at a glance.
export default function ApprovalsTable({ kpis, interactive }) {
  const { user, org, values, settings, period, hasPerm, assignments, contributions, reloadValues } = useApp();
  const toast = useToast();
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [returnDraft, setReturnDraft] = useState({});
  const [overrideDraft, setOverrideDraft] = useState({});

  function rowFor(kpi) {
    const valueRow = values[`${kpi.id}-${period.year}-${period.month}`];
    const status = valueStatus(valueRow);
    const isPreview = !!(valueRow && valueRow.value == null && valueRow.preview_value != null);
    const effectiveRow = isPreview ? { ...valueRow, value: valueRow.preview_value } : valueRow;
    const rag = computeRag(kpi, effectiveRow, settings);
    // The pace/variance shown here must be about THIS submission, for the
    // exact period being reviewed (effectiveRow — the same row rag is
    // computed from, preview value and all) — not a separate, unrelated
    // "performance lens" period (the old `perfValues[kpi.id]`, which tracks
    // Overview/Reports' own independently-set period and could easily be a
    // completely different month than the one actually being approved
    // here). That mismatch is what let this column show a stale or
    // unrelated "On pace" regardless of whether the submission on screen
    // was actually on pace.
    const variance = computeVariance(kpi, effectiveRow, settings);
    const current = effectiveRow ? (effectiveRow.override_value != null ? effectiveRow.override_value : effectiveRow.value) : null;
    const assignees = kpi.owner_type === 'unit'
      ? assignments.filter((a) => a.kpi_id === kpi.id).map((a) => byId(org.individuals, a.individual_id)).filter(Boolean)
      : [];
    const isShared = kpi.owner_type === 'unit' && assignees.length > 0;
    const kpiContributions = isShared ? contributions.filter((c) => c.kpi_id === kpi.id) : [];
    const submitted = isShared ? current : valueRow?.entered_value;
    return { valueRow, status, rag, variance, current, isShared, assignees, kpiContributions, submitted, isPreview };
  }

  async function run(kpi, fn, okMsg) {
    setBusyId(kpi.id);
    try { await fn(); toast(okMsg); await reloadValues(); }
    catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  function toggleExpand(id) { setExpandedId((cur) => (cur === id ? null : id)); }

  if (kpis.length === 0) return null;

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-[12.3px] border-collapse">
        <thead>
          <tr className="border-b border-line text-left text-ink-muted text-[10.8px] uppercase tracking-wide">
            <th className="px-3 py-2.5 min-w-[220px]">KPI</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5 text-right">Baseline</th>
            <th className="px-3 py-2.5 text-right">Target</th>
            <th className="px-3 py-2.5 text-right">Current</th>
            <th className="px-3 py-2.5 text-right min-w-[110px]">Submitted</th>
            <th className="px-3 py-2.5">Score</th>
            <th className="px-3 py-2.5">Pace</th>
            <th className="px-3 py-2.5 min-w-[140px] max-w-[200px]">Note</th>
            {interactive && (
              <th className="px-3 py-2.5 min-w-[190px] sticky right-0 bg-surface border-l border-line z-10">Decision</th>
            )}
          </tr>
        </thead>
        <tbody>
          {kpis.map((kpi) => {
            const r = rowFor(kpi);
            const isOpen = expandedId === kpi.id;
            const canOverride = !!kpi.is_automated && hasPerm('apply_override');
            const hasExpandable = r.isShared || canOverride || (r.valueRow?.explanation && r.valueRow.explanation.length > 60);
            return (
              <Fragment key={kpi.id}>
                <tr className="border-b border-line last:border-b-0 align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-[12.8px] leading-snug">{kpi.name}</div>
                    <div className="flex gap-1 flex-wrap mt-1 items-center">
                      <span className="chip chip-tag text-[10px] px-1.5 py-0.5">{ownerName(org, kpi)}</span>
                      <span className="chip chip-tag text-[10px] px-1.5 py-0.5">{kpi.type}</span>
                      {!!kpi.is_automated && <span className="chip chip-tag text-[10px] px-1.5 py-0.5">Automated</span>}
                      {r.isShared && <span className="chip bg-accent-50 text-accent-600 text-[10px] px-1.5 py-0.5">Team ({r.assignees.length})</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`chip chip-st-${r.status} text-[10.8px] px-2 py-0.5`}>{STATUS_LABEL[r.status]}</span>
                    {r.valueRow?.late && ['submitted', 'approved'].includes(r.status) && (
                      <span className="chip bg-warning-soft text-warning text-[10px] px-1.5 py-0.5 ml-1" title="Submitted after month-end, inside the late-submission grace window">
                        Late
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.baseline}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.target} <span className="text-ink-muted">{kpi.measure}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums" title={r.isPreview ? 'Projected total if approved as-is' : undefined}>
                    {r.current != null ? r.current : '—'}{r.isPreview && <span className="text-ink-muted text-[10.5px]"> (if approved)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.submitted != null ? `${r.submitted} ${kpi.measure}` : '—'}</td>
                  <td className="px-3 py-2.5"><span className={`chip text-[11px] px-2 py-0.5 ${r.rag.cls}`}>{r.rag.label}</span></td>
                  <td className="px-3 py-2.5">
                    {r.variance.flag === 'attention' && <span className="chip bg-critical text-white text-[10.5px] px-1.5 py-0.5" title={`${r.variance.actualPct}% actual vs ${r.variance.expectedPct}% expected pace`}>⚠ {r.variance.variance}pts behind</span>}
                    {r.variance.flag === 'ahead' && <span className="chip chip-rag-green text-[10.5px] px-1.5 py-0.5">+{r.variance.variance}pts ahead</span>}
                    {r.variance.flag === 'on-pace' && <span className="text-ink-muted text-[11px]" title={`${r.variance.actualPct}% actual vs ${r.variance.expectedPct}% expected pace`}>On pace</span>}
                    {r.variance.flag === 'none' && <span className="text-ink-muted text-[11px]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-secondary text-[11.8px] max-w-[200px] truncate" title={r.valueRow?.explanation || ''}>
                    {r.valueRow?.explanation || '—'}
                  </td>
                  {interactive && (
                    <td className="px-3 py-2.5 sticky right-0 bg-surface border-l border-line">
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <button className="btn btn-sm btn-primary" disabled={busyId === kpi.id}
                          onClick={() => run(kpi, () => api(`/kpis/${kpi.id}/approve`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Approved.')}>
                          Approve
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => toggleExpand(kpi.id)}>
                          {isOpen ? 'Close' : 'Return…'}
                        </button>
                        {hasExpandable && !isOpen && (
                          <button className="text-[11px] text-accent-600 hover:underline" onClick={() => toggleExpand(kpi.id)}>Review ▾</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                {isOpen && interactive && (
                  <tr className="border-b border-line bg-sunken/30">
                    <td colSpan={10} className="px-3 py-3">
                      <div className="space-y-3">
                        {r.valueRow?.explanation && (
                          <p className="text-[12.3px] text-ink-secondary">“{r.valueRow.explanation}” — submitter's note</p>
                        )}
                        <div className="space-y-1.5 max-w-lg">
                          <label className="field-label">Reason for returning this submission</label>
                          <textarea rows={2} className="field-input" placeholder="Required to return"
                            value={returnDraft[kpi.id] || ''} onChange={(e) => setReturnDraft((d) => ({ ...d, [kpi.id]: e.target.value }))} />
                          <button className="btn btn-sm btn-danger" disabled={busyId === kpi.id}
                            onClick={() => {
                              const comment = (returnDraft[kpi.id] || '').trim();
                              if (!comment) { toast('A reason is required to return a submission.', 'err'); return; }
                              run(kpi, () => api(`/kpis/${kpi.id}/return`, { method: 'POST', body: { year: period.year, month: period.month, comment } }), 'Returned to submitter.')
                                .then(() => { setReturnDraft((d) => ({ ...d, [kpi.id]: '' })); setExpandedId(null); });
                            }}>
                            Confirm return
                          </button>
                        </div>
                        {canOverride && (
                          <div className="flex gap-2 flex-wrap items-center pt-2 border-t border-line">
                            <label className="field-label mr-1">Manual override</label>
                            <input type="number" step="any" placeholder={kpi.measure ? `Value (${kpi.measure})` : 'Value'} className="field-input w-32 py-1.5"
                              value={overrideDraft[kpi.id]?.value || ''} onChange={(e) => setOverrideDraft((d) => ({ ...d, [kpi.id]: { ...d[kpi.id], value: e.target.value } }))} />
                            <input type="text" placeholder="Reason" className="field-input w-44 py-1.5"
                              value={overrideDraft[kpi.id]?.note || ''} onChange={(e) => setOverrideDraft((d) => ({ ...d, [kpi.id]: { ...d[kpi.id], note: e.target.value } }))} />
                            <button className="btn btn-sm" disabled={busyId === kpi.id}
                              onClick={() => {
                                const v = overrideDraft[kpi.id]?.value;
                                const note = (overrideDraft[kpi.id]?.note || '').trim();
                                if (v === undefined || v === '' || !note) { toast('An override value and reason are both required.', 'err'); return; }
                                run(kpi, () => api(`/kpis/${kpi.id}/override`, { method: 'POST', body: { year: period.year, month: period.month, value: Number(v), note } }), 'Override applied.');
                              }}>
                              Apply override
                            </button>
                            {r.valueRow?.override_value != null && (
                              <button className="btn btn-sm btn-ghost" disabled={busyId === kpi.id}
                                onClick={() => {
                                  if (!window.confirm(`Clear this override (${r.valueRow.override_value}, "${r.valueRow.override_note}")? Nothing is deleted — it stays recoverable with a "Restore override" button here until a new one is applied over it.`)) return;
                                  run(kpi, () => api(`/kpis/${kpi.id}/override`, { method: 'DELETE', body: { year: period.year, month: period.month } }), 'Override cleared.');
                                }}>
                                Clear override
                              </button>
                            )}
                            {r.valueRow?.override_value == null && r.valueRow?.override_cleared_at != null && (
                              <button className="btn btn-sm btn-ghost" disabled={busyId === kpi.id}
                                onClick={() => run(kpi, () => api(`/kpis/${kpi.id}/override/restore`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Override restored.')}>
                                Restore override ({r.valueRow.override_cleared_value})
                              </button>
                            )}
                          </div>
                        )}
                        {r.isShared && (
                          <div className="pt-2 border-t border-line">
                            <ContributorsBreakdown kpi={kpi} assignees={r.assignees} contributions={r.kpiContributions} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The Unit Head's own team-contributions queue — a different shape from
// the table above (there's no top-level Approve/Return for the KPI itself
// here, only per-contributor decisions), so it gets its own compact table
// with an expandable "Review team" row reusing the same ContributorsBreakdown
// used above.
export function TeamApprovalsTable({ kpis }) {
  const { org, settings, values, period, assignments, contributions } = useApp();
  const [expandedId, setExpandedId] = useState(null);

  if (kpis.length === 0) return null;

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-[12.3px] border-collapse">
        <thead>
          <tr className="border-b border-line text-left text-ink-muted text-[10.8px] uppercase tracking-wide">
            <th className="px-3 py-2.5 min-w-[220px]">KPI</th>
            <th className="px-3 py-2.5 text-right">Current</th>
            <th className="px-3 py-2.5">Score</th>
            <th className="px-3 py-2.5">Pace</th>
            <th className="px-3 py-2.5">Team submissions</th>
            <th className="px-3 py-2.5 min-w-[110px] sticky right-0 bg-surface border-l border-line z-10" />
          </tr>
        </thead>
        <tbody>
          {kpis.map((kpi) => {
            const valueRow = values[`${kpi.id}-${period.year}-${period.month}`];
            const rag = computeRag(kpi, valueRow, settings);
            // Same fix as the table above: pace for THIS KPI's actual
            // current period row, not an unrelated "performance lens" period.
            const variance = computeVariance(kpi, valueRow, settings);
            const assignees = assignments.filter((a) => a.kpi_id === kpi.id).map((a) => byId(org.individuals, a.individual_id)).filter(Boolean);
            const kpiContributions = contributions.filter((c) => c.kpi_id === kpi.id);
            const submittedCount = kpiContributions.filter((c) => c.status === 'submitted').length;
            const approvedCount = kpiContributions.filter((c) => c.status === 'approved').length;
            const isOpen = expandedId === kpi.id;
            return (
              <Fragment key={kpi.id}>
                <tr className="border-b border-line last:border-b-0 align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-[12.8px] leading-snug">{kpi.name}</div>
                    <span className="chip chip-tag text-[10px] px-1.5 py-0.5 mt-1 inline-block">{kpi.type}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{valueRow?.value != null ? valueRow.value : '—'}</td>
                  <td className="px-3 py-2.5"><span className={`chip text-[11px] px-2 py-0.5 ${rag.cls}`}>{rag.label}</span></td>
                  <td className="px-3 py-2.5">
                    {variance.flag === 'attention' && <span className="chip bg-critical text-white text-[10.5px] px-1.5 py-0.5">⚠ {variance.variance}pts behind</span>}
                    {variance.flag === 'ahead' && <span className="chip chip-rag-green text-[10.5px] px-1.5 py-0.5">+{variance.variance}pts ahead</span>}
                    {variance.flag === 'on-pace' && <span className="text-ink-muted text-[11px]" title={`${variance.actualPct}% actual vs ${variance.expectedPct}% expected pace`}>On pace</span>}
                    {variance.flag === 'none' && <span className="text-ink-muted text-[11px]">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="chip chip-tag text-[10.8px] px-2 py-0.5">{approvedCount} of {assignees.length} approved</span>
                    {submittedCount > 0 && <span className="text-accent-600 font-semibold text-[11.5px] ml-1.5">· {submittedCount} awaiting review</span>}
                  </td>
                  <td className="px-3 py-2.5 sticky right-0 bg-surface border-l border-line">
                    <button className="text-[11px] text-accent-600 hover:underline" onClick={() => setExpandedId(isOpen ? null : kpi.id)}>
                      {isOpen ? 'Hide team ▴' : 'Review team ▾'}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line bg-sunken/30">
                    <td colSpan={6} className="px-3 py-3">
                      <ContributorsBreakdown kpi={kpi} assignees={assignees} contributions={kpiContributions} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A dedicated, collapsible table for return feedback — pulled OUT of each
// KPI's own row (where it used to sit as an inline colored box) so the main
// approvals table above stays scannable, while the actual feedback text is
// still one click away rather than gone. Hidden by default: most reviewers
// only need this when they're specifically checking what they told someone
// last time, not on every visit to the queue.
export function FeedbackTable({ kpis }) {
  const { org, values, period } = useApp();
  const [visible, setVisible] = useState(false);

  // return_comment lives on a row whose RAW status is still 'draft' — it's
  // only ever "Returned" as a DERIVED status (see lib/scope.js's
  // valueStatus: draft + a return_comment present = returned; the raw
  // 'draft' is what lets the submitter edit and resubmit it). Checking
  // valueRow.status directly here would miss every real returned item.
  const withFeedback = kpis
    .map((kpi) => ({ kpi, valueRow: values[`${kpi.id}-${period.year}-${period.month}`] }))
    .filter(({ valueRow }) => valueStatus(valueRow) === 'returned' && valueRow?.return_comment);

  if (withFeedback.length === 0) return null;

  return (
    <div className="mt-4">
      <button className="text-[12.3px] font-semibold text-accent-600 hover:underline flex items-center gap-1.5" onClick={() => setVisible((v) => !v)}>
        {visible ? '▾' : '▸'} Return feedback ({withFeedback.length}) {visible ? '— hide' : '— show'}
      </button>
      {visible && (
        <div className="card p-0 overflow-x-auto mt-2">
          <table className="w-full text-[12.3px] border-collapse">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted text-[10.8px] uppercase tracking-wide">
                <th className="px-3 py-2.5 min-w-[180px]">KPI</th>
                <th className="px-3 py-2.5 min-w-[140px]">Owner</th>
                <th className="px-3 py-2.5 min-w-[280px]">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {withFeedback.map(({ kpi, valueRow }) => (
                <tr key={kpi.id} className="border-b border-line last:border-b-0 align-top">
                  <td className="px-3 py-2.5 font-semibold">{kpi.name}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{ownerName(org, kpi)}</td>
                  <td className="px-3 py-2.5 text-ink-secondary">“{valueRow.return_comment}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
