import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import {
  byId, computeRag, computeVariance, ownerName, valueStatus,
  canEnterData, canContribute,
} from '../lib/scope.js';
import { readDraft, writeDraft, clearDraft, draftDiffersFrom, debounce } from '../lib/autosave.js';
import Fig from './Fig.jsx';
import MonthlyPaceBar from './MonthlyPaceBar.jsx';

const STATUS_LABEL = {
  none: 'Not started', draft: 'Draft', returned: 'Returned', submitted: 'Submitted', approved: 'Approved',
};

// `context` keeps the two review surfaces that share this same card from
// bleeding into each other: 'entry' (My Data Entry — the default) is a
// Unit Head's own data-entry view of a shared KPI they own, so it stops at
// the "Submit total to Sub-programme Rep" action and never shows their
// team's individual contributions needing a decision; 'approvals'
// (Approvals Queue only) is the one place that decision actually belongs,
// so ContributorsBreakdown's Approve/Return buttons render only there. The
// KPI list itself was already correctly scoped per role before this —
// canEnterData/isOwner in lib/scope.js mean an Individual only ever sees
// their own KPIs, a Unit Head only their own unit's, a Sub-programme Rep
// only their own sub's — this only removes the duplicate approval actions
// that used to also render inside My Data Entry.
//
// `allowHide` opts a card into the personal "not relevant to me" toggle
// (see AppContext's hiddenKpiIds/hideKpi/unhideKpi) — only Overview's
// exploratory drill-down passes it. It's still refused for a KPI that's
// actually this person's own duty (canEnterData/canContribute), computed
// below regardless of the caller, so hiding can never be used to dodge a
// real accountability item even if a future caller passed it by mistake.
export default function KpiCard({ kpi, mode = 'readOnly', context = 'entry', allowHide = false }) {
  const { user, org, settings, values, period, reloadValues, hasPerm, assignments, contributions, perfPeriod, perfValues, hiddenKpiIds, hideKpi, unhideKpi } = useApp();
  const toast = useToast();
  const isMyOwnDuty = canEnterData(user, kpi) || canContribute(user, kpi, assignments);
  const canToggleHide = allowHide && !isMyOwnDuty;
  const isHidden = hiddenKpiIds.has(kpi.id);
  // Who (if anyone) has been delegated this Unit-owned KPI as one of their
  // duties — shown as context in every mode, and only editable by the Unit
  // Head who owns it (see AssignmentManager below).
  const assignees = kpi.owner_type === 'unit'
    ? assignments.filter((a) => a.kpi_id === kpi.id).map((a) => byId(org.individuals, a.individual_id)).filter(Boolean)
    : [];
  // A shared KPI (has assignees at all) is entered a whole different way:
  // each assignee submits their own figure (see ContributionCard) which
  // their Unit Head reviews right here, and this KPI's own value becomes an
  // automated sum the Unit Head can no longer type into directly.
  const isShared = kpi.owner_type === 'unit' && assignees.length > 0;
  const kpiContributions = isShared ? contributions.filter((c) => c.kpi_id === kpi.id) : [];
  const valueRow = values[`${kpi.id}-${period.year}-${period.month}`];
  const status = valueStatus(valueRow);
  // A submitted-but-not-yet-approved row's real `value` is deliberately
  // still null (see below) — so without this, whoever is about to approve
  // or return it would see a blank "Current" figure and a "No data" score,
  // with nothing to actually judge the submission against. The backend now
  // attaches a read-only `preview_value` to exactly these rows (see
  // routes/kpis.js's attachPreview) — previousOfficialValue + entered_value,
  // the identical math final approval itself uses — and this builds a
  // synthetic row with that preview standing in for `value`, used ONLY for
  // display (score chip, Current figure, the pace bar): every write action
  // (Save/Submit/Approve/Return) still reads and writes the real valueRow,
  // never this one.
  const isPreview = !!(valueRow && valueRow.value == null && valueRow.preview_value != null);
  const effectiveRow = isPreview ? { ...valueRow, value: valueRow.preview_value } : valueRow;
  const rag = computeRag(kpi, effectiveRow, settings);
  // Variance vs. the pace expected by the currently-selected performance
  // period (Monthly/Quarterly/Bi-annual/Annual — see LiveIndicator's sibling
  // PeriodTypePicker on Overview/Reports) — the same real number driving the
  // charts and alert list there, surfaced right on the card it's about.
  // Only shown when it's actually notable (10+ points either side); an
  // on-pace KPI doesn't need a fifth badge repeating "it's fine".
  const variance = computeVariance(kpi, perfValues[kpi.id], settings);
  // "Current" is the KPI's OFFICIAL running total — real performance to
  // date, only ever updated at the moment a period is approved (see
  // backend's previousOfficialValue / POST :id/approve). What's typed into
  // the box below is a completely different number: THIS period's own
  // entry on its own, never a running total the submitter has to work out
  // by hand — the server adds it to the previous period's official total
  // automatically, the moment this one is approved.
  const current = effectiveRow ? (effectiveRow.override_value != null ? effectiveRow.override_value : effectiveRow.value) : null;
  const enteredValue = valueRow ? valueRow.entered_value : null;

  // A local-only safety net against an interruption mid-typing — a power
  // cut, a crashed tab — before either field's own Save button was ever
  // clicked (see lib/autosave.js). Each key is scoped to this user, this
  // KPI, and this period, so it can never bleed into a different KPI or a
  // different person sharing the same browser. A draft only ever wins over
  // the loaded server value when it actually disagrees with it — if they
  // match, there's nothing unsaved to recover.
  const valueDraftKey = `u${user.id}-kpi${kpi.id}-${period.year}-${period.month}-value`;
  const noteDraftKey = `u${user.id}-kpi${kpi.id}-${period.year}-${period.month}-note`;
  const savedValueDraft = readDraft(valueDraftKey);
  const savedNoteDraft = readDraft(noteDraftKey);
  const restoredValue = draftDiffersFrom(savedValueDraft, enteredValue);
  const restoredNote = draftDiffersFrom(savedNoteDraft, valueRow?.explanation);

  const [entryValue, setEntryValue] = useState(restoredValue ? savedValueDraft : (enteredValue != null ? String(enteredValue) : ''));
  const [explanation, setExplanation] = useState(restoredNote ? savedNoteDraft : (valueRow?.explanation || ''));
  const [showReturn, setShowReturn] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Debounced (see lib/autosave.js) rather than writing to localStorage on
  // every keystroke — the input above updates instantly either way via
  // entryValue/explanation's own React state; only the local recovery
  // mirror waits for typing to actually pause. useMemo (not useRef) so it's
  // still one stable debounced function per field for this card's whole
  // lifetime, not recreated — and its pending timer reset — on every
  // render.
  const writeValueDraft = useMemo(() => debounce(writeDraft), []);
  const writeNoteDraft = useMemo(() => debounce(writeDraft), []);
  function onEntryValueChange(v) { setEntryValue(v); writeValueDraft(valueDraftKey, v); }
  function onExplanationChange(v) { setExplanation(v); writeNoteDraft(noteDraftKey, v); }

  async function run(fn, okMsg, onOk) {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg); if (onOk) onOk(); await reloadValues(); }
    catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  // Locked for editing while pending review — the submitter can't touch it
  // again until either its one real approval or a return resets it back to
  // 'draft'.
  const locked = valueRow && valueRow.status === 'submitted';
  // A shared/automated KPI's own row is gated on `value` (recomputeUnitTotal
  // already fills it from approved contributions); every directly-entered
  // KPI is gated on `entered_value` — the number PUT /:id/value actually
  // writes to now (see above).
  const canSubmit = valueRow && valueRow.status === 'draft' && (isShared ? valueRow.value != null : valueRow.entered_value != null);

  return (
    <div className="card mb-3.5">
      <div className="flex justify-between gap-3 items-start flex-wrap">
        <div>
          <p className="font-bold text-[15px] leading-snug mb-1.5">{kpi.name}</p>
          <div className="flex gap-1.5 flex-wrap items-center mb-1">
            <span className="chip chip-tag">{ownerName(org, kpi)}</span>
            <span className="chip chip-tag">{kpi.type}</span>
            <span className={`chip chip-st-${status}`}>{STATUS_LABEL[status]}</span>
            {kpi.is_automated ? <span className="chip chip-tag">Automated</span> : null}
            {assignees.length > 0 && (
              <span className="chip bg-accent-50 text-accent-600">
                Assigned: {assignees.map((i) => i.name).join(', ')}
              </span>
            )}
            {variance.flag === 'attention' && (
              <span className="chip bg-critical text-white" title={`${variance.actualPct}% actual vs ${variance.expectedPct}% expected pace`}>
                ⚠ {variance.variance}pts behind pace
              </span>
            )}
            {variance.flag === 'ahead' && (
              <span className="chip chip-rag-green" title={`${variance.actualPct}% actual vs ${variance.expectedPct}% expected pace`}>
                +{variance.variance}pts ahead of pace
              </span>
            )}
          </div>
          {(valueRow?.submitted_at || valueRow?.approved_at) && (
            <div className="text-[11.5px] text-ink-muted flex gap-3 flex-wrap">
              {valueRow.submitted_at && <span>Submitted {valueRow.submitted_at} UTC</span>}
              {valueRow.approved_at && <span>Approved {valueRow.approved_at} UTC</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`chip text-[13px] px-2.5 py-1 ${rag.cls}`}>{rag.label}</span>
          {canToggleHide && (
            <button
              className="text-[11px] text-ink-muted hover:text-accent-500 underline decoration-dotted"
              onClick={() => (isHidden ? unhideKpi(kpi.id) : hideKpi(kpi.id))}
              title={isHidden ? 'Show this KPI in your view again' : 'Not relevant to you — hide it from your own view (no one else is affected)'}
            >
              {isHidden ? 'Unhide' : 'Not relevant — hide'}
            </button>
          )}
        </div>
      </div>

      <div className={`mt-3 rounded-xl bg-sunken/60 p-3.5 ${isHidden ? 'opacity-50' : ''}`}>
        <div className="flex gap-x-8 gap-y-2 flex-wrap">
          <Fig k="Baseline" v={kpi.baseline} />
          <Fig k="Target" v={kpi.target} />
          {/* The raw submitted figure itself — entered_value — separate from
              the cumulative total below. Without this, a reviewer had no way
              to see what was actually typed in before deciding whether to
              approve it. Shown for anyone reviewing or looking back at a
              period that's actually had something entered. */}
          {valueRow?.entered_value != null && ['submitted', 'approved'].includes(status) && (
            <Fig k="Submitted this period" v={`${valueRow.entered_value} ${kpi.measure}`} />
          )}
          <Fig
            k={isPreview ? 'Projected total if approved' : 'Current (cumulative)'}
            v={current != null ? current : '—'}
          />
        </div>
        {isPreview && (
          <p className="text-[11px] text-ink-muted mt-2 italic">
            Not yet official — this is what the cumulative total and score above would become if this submission is approved as-is.
          </p>
        )}

        <MonthlyPaceBar kpi={kpi} valueRow={effectiveRow} period={period} isPreview={isPreview} />
      </div>

      {valueRow?.override_value != null && (
        <div className="mt-2.5 rounded-lg bg-sunken border border-line text-[12px] text-ink-secondary px-3.5 py-2.5">
          <b>Manual override active</b> — the system-calculated value is retained alongside it:
          {' '}<span className="tabular-nums font-semibold">{valueRow.value != null ? valueRow.value : '—'}</span> (system)
          {' → '}<span className="tabular-nums font-semibold text-warning">{valueRow.override_value}</span> (override)
          {valueRow.override_note && <span className="block mt-0.5 italic">“{valueRow.override_note}” — see Audit Log for who and when.</span>}
        </div>
      )}

      {valueRow?.return_comment && status === 'returned' && (
        <div className="mt-2.5 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5">
          <b>Feedback from reviewer:</b> {valueRow.return_comment}
          {mode === 'owner' && <span className="block mt-0.5 font-semibold">Update the value below and resubmit when ready.</span>}
        </div>
      )}

      {mode === 'owner' && isShared && context === 'approvals' && (
        <ContributorsBreakdown kpi={kpi} assignees={assignees} contributions={kpiContributions} />
      )}
      {mode === 'owner' && isShared && context === 'entry' && (
        <ContributorsSummary kpi={kpi} assignees={assignees} contributions={kpiContributions} />
      )}

      {mode === 'owner' && !isShared && (
        <>
          {restoredValue && (
            <div className="mt-3 rounded-lg bg-accent-50 text-accent-600 text-[11.5px] px-3 py-2">
              Restored an unsaved value from before — it hadn't been saved yet. Save it below, or overwrite it.
            </div>
          )}
          <p className="text-[11.5px] text-ink-muted mt-3 max-w-[60ch]">
            Enter this period's own figure only — not a running total. The moment it's approved, it's added
            automatically to {current != null ? <>the current cumulative total ({current})</> : "the KPI's baseline"} to become the new "Current" figure above.
          </p>
          <div className="flex gap-2 flex-wrap items-end mt-2">
            <div className="space-y-1">
              <label className="field-label">This period's entry ({kpi.measure})</label>
              <input type="number" step="any" disabled={locked} value={entryValue}
                onChange={(e) => onEntryValueChange(e.target.value)}
                className="field-input w-36" />
            </div>
            <button className="btn btn-sm" disabled={locked || busy}
              onClick={() => run(() => api(`/kpis/${kpi.id}/value`, { method: 'PUT', body: { year: period.year, month: period.month, value: entryValue === '' ? null : Number(entryValue) } }), 'Value saved.', () => clearDraft(valueDraftKey))}>
              Save value
            </button>
            <button className="btn btn-sm btn-primary" disabled={!canSubmit || busy}
              onClick={() => run(() => api(`/kpis/${kpi.id}/submit`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Submitted for review.', () => clearDraft(valueDraftKey))}>
              Submit
            </button>
          </div>
        </>
      )}

      {mode === 'owner' && (
        <>
          {isShared && (
            <div className="flex gap-2 flex-wrap items-center mt-3">
              <button className="btn btn-sm btn-primary" disabled={!canSubmit || busy}
                onClick={() => run(() => api(`/kpis/${kpi.id}/submit`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Submitted for review.')}>
                Submit total to Sub-programme Rep
              </button>
              <span className="text-[11.5px] text-ink-muted">The "Current" figure above is computed automatically: the previous period's total, plus your team's approved contributions this period.</span>
            </div>
          )}
          {restoredNote && (
            <div className="mt-2.5 rounded-lg bg-accent-50 text-accent-600 text-[11.5px] px-3 py-2">
              Restored an unsaved note from before — it hadn't been saved yet.
            </div>
          )}
          <div className="mt-2.5 space-y-1">
            <label className="field-label">Explanation / notes</label>
            <textarea rows={2} className="field-input" placeholder="Optional context for reviewers"
              value={explanation} onChange={(e) => onExplanationChange(e.target.value)} />
          </div>
          <button className="btn btn-sm btn-ghost mt-1.5" disabled={busy}
            onClick={() => run(() => api(`/kpis/${kpi.id}/explanation`, { method: 'PUT', body: { year: period.year, month: period.month, text: explanation } }), 'Note saved.', () => clearDraft(noteDraftKey))}>
            Save note
          </button>
          {user.role === 'unithead' && kpi.owner_type === 'unit' && (
            <AssignmentManager kpi={kpi} assignees={assignees} />
          )}
        </>
      )}

      {mode === 'approver' && (
        <>
          {/* Restates exactly what's being decided on, right next to the
              decision itself — the entered figure, what it projects to once
              approved, and the score that projection scores as — so the
              approver never has to approve blind or hunt for it further up
              the card. explanation is the submitter's own note, if any. */}
          <div className="mt-3 rounded-lg border border-line bg-sunken/60 px-3.5 py-3 text-[12.6px]">
            <p className="font-semibold text-ink mb-1">
              {isShared ? (
                <>
                  Team total submitted: <span className="tabular-nums">{current != null ? `${current} ${kpi.measure}` : '—'}</span>
                  {current != null && <span className="text-ink-muted font-normal"> ({rag.label})</span>}
                </>
              ) : (
                <>
                  Submitted: <span className="tabular-nums">{valueRow?.entered_value != null ? `${valueRow.entered_value} ${kpi.measure}` : '—'}</span>
                  {isPreview && current != null ? (
                    <>
                      <span className="text-ink-muted font-normal"> → if approved, new total </span>
                      <span className="tabular-nums">{current} {kpi.measure}</span>
                      <span className="text-ink-muted font-normal"> ({rag.label})</span>
                    </>
                  ) : current != null && (
                    <span className="text-ink-muted font-normal"> ({rag.label})</span>
                  )}
                </>
              )}
            </p>
            {valueRow?.explanation && <p className="text-ink-secondary">“{valueRow.explanation}” — submitter's note</p>}
          </div>
          <div className="flex gap-2 flex-wrap mt-3">
            <button className="btn btn-sm btn-primary" disabled={busy}
              onClick={() => run(() => api(`/kpis/${kpi.id}/approve`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Approved.')}>
              Approve
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setShowReturn((v) => !v)}>Return…</button>
          </div>
          {showReturn && (
            <div className="mt-2 space-y-1.5">
              <textarea rows={2} className="field-input" placeholder="Reason for returning this submission"
                value={returnComment} onChange={(e) => setReturnComment(e.target.value)} />
              <button className="btn btn-sm btn-danger" disabled={busy}
                onClick={() => {
                  if (!returnComment.trim()) { toast('A reason is required to return a submission.', 'err'); return; }
                  run(() => api(`/kpis/${kpi.id}/return`, { method: 'POST', body: { year: period.year, month: period.month, comment: returnComment.trim() } }), 'Returned to submitter.');
                }}>
                Confirm return
              </button>
            </div>
          )}
          {/* !! coerces is_automated (a raw SQLite 0/1 integer, not a real
              boolean) — otherwise a non-automated KPI (is_automated === 0)
              renders the literal digit "0" here instead of nothing, since
              `0 && x` evaluates to `0`, not `false`. */}
          {!!kpi.is_automated && hasPerm('apply_override') && (
            <div className="flex gap-2 flex-wrap items-center mt-3">
              <input type="number" step="any" placeholder="Override value" className="field-input w-32"
                value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} />
              <input type="text" placeholder="Reason" className="field-input w-44"
                value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} />
              <button className="btn btn-sm" disabled={busy}
                onClick={() => {
                  if (overrideValue === '' || !overrideNote.trim()) { toast('An override value and reason are both required.', 'err'); return; }
                  run(() => api(`/kpis/${kpi.id}/override`, { method: 'POST', body: { year: period.year, month: period.month, value: Number(overrideValue), note: overrideNote.trim() } }), 'Override applied.');
                }}>
                Apply override
              </button>
              {valueRow?.override_value != null && (
                <button className="btn btn-sm btn-ghost" disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Clear this override (${valueRow.override_value}, "${valueRow.override_note}")? Nothing is deleted — it stays recoverable with a "Restore override" button here until a new one is applied over it.`)) return;
                    run(() => api(`/kpis/${kpi.id}/override`, { method: 'DELETE', body: { year: period.year, month: period.month } }), 'Override cleared.');
                  }}>
                  Clear override
                </button>
              )}
              {valueRow?.override_value == null && valueRow?.override_cleared_at != null && (
                <button className="btn btn-sm btn-ghost" disabled={busy}
                  onClick={() => run(() => api(`/kpis/${kpi.id}/override/restore`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Override restored.')}>
                  Restore override ({valueRow.override_cleared_value})
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Lets the Unit Head who owns this KPI delegate entering & submitting its
// monthly value to a specific person in their unit — real, persisted (see
// kpi_assignments / POST|DELETE /kpis/:id/assign on the backend), not a
// display-only label. The KPI stays owned by the unit either way: approval
// still goes to the Sub-programme Rep exactly as if the Unit Head had
// entered it themselves. Exported — DataEntryTable's "Manage team" row
// reuses this exact component rather than duplicating the assign/unassign
// logic a second time.
export function AssignmentManager({ kpi, assignees }) {
  const { org, reloadAssignments } = useApp();
  const toast = useToast();
  const [pickId, setPickId] = useState('');
  const [busy, setBusy] = useState(false);
  const unitIndividuals = org.individuals.filter((i) => i.unit_id === kpi.owner_id);
  const available = unitIndividuals.filter((i) => !assignees.some((a) => a.id === i.id));

  async function assign() {
    if (!pickId) return;
    setBusy(true);
    try {
      await api(`/kpis/${kpi.id}/assign`, { method: 'POST', body: { individualId: Number(pickId) } });
      toast('Assigned.');
      setPickId('');
      await reloadAssignments();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }
  async function unassign(individualId) {
    const person = unitIndividuals.find((i) => i.id === individualId);
    if (!window.confirm(`Unassign ${person ? person.name : 'this person'} from "${kpi.name}"? Nothing is deleted — re-assigning them restores this exact assignment.`)) return;
    setBusy(true);
    try {
      await api(`/kpis/${kpi.id}/assign/${individualId}`, { method: 'DELETE' });
      toast('Unassigned.');
      await reloadAssignments();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-3 pt-3 border-t border-line">
      <label className="field-label block mb-1.5">Assign to a team member</label>
      {assignees.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {assignees.map((i) => (
            <span key={i.id} className="chip bg-accent-50 text-accent-600 flex items-center gap-1.5">
              {i.name}
              <button className="text-accent-600/60 hover:text-critical font-bold leading-none" disabled={busy} onClick={() => unassign(i.id)} aria-label={`Unassign ${i.name}`}>✕</button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 ? (
        <div className="flex gap-2 flex-wrap items-center">
          <select className="field-input py-1.5 w-auto" aria-label="Assign an individual" value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">Select a person…</option>
            {available.map((i) => <option key={i.id} value={i.id}>{i.name} — {i.role_title}</option>)}
          </select>
          <button className="btn btn-sm" disabled={!pickId || busy} onClick={assign}>Assign</button>
        </div>
      ) : unitIndividuals.length === 0 ? (
        <p className="text-[11.5px] text-ink-muted">No individuals in this unit yet — add one from Framework.</p>
      ) : null}
      <p className="text-[11px] text-ink-muted mt-1.5">
        Each person you assign submits their own figure to you for approval — approved figures are summed
        automatically into this KPI's overall value, which you then submit to your Sub-programme Rep.
      </p>
    </div>
  );
}

// My Data Entry's read-only sibling of ContributorsBreakdown below — a
// glance at where the team stands (how many have submitted, how many are
// still pending) with NO Approve/Return actions here: reviewing and
// deciding a contribution is Approvals Queue's job alone, so a Unit Head
// doesn't see the same decision twice in two different places. The count
// itself is real — the same `contributions` rows Approvals Queue reads —
// just presented for awareness, not action.
function ContributorsSummary({ kpi, assignees, contributions }) {
  const submitted = contributions.filter((c) => c.status === 'submitted').length;
  const approved = contributions.filter((c) => c.status === 'approved').length;
  return (
    <div className="mt-3.5 pt-3.5 border-t border-line-strong">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <span className="field-label">Your team's contributions</span>
        <span className="text-[12px] text-ink-secondary">
          {approved} of {assignees.length} approved
          {submitted > 0 && <span className="text-accent-600 font-semibold"> · {submitted} awaiting your review in Approvals Queue</span>}
        </span>
      </div>
    </div>
  );
}

// The Unit Head's review queue for a shared KPI — one row per assignee,
// their own submitted-or-not figure, and an Approve/Return action exactly
// like KpiCard's own "approver" mode, just one tier down. Approving a row
// is what triggers the automated resum on the backend (recomputeUnitTotal)
// — nothing here computes a total itself, it only ever shows what the
// server already has. Approvals Queue only — see ContributorsSummary above
// for My Data Entry's read-only equivalent. Exported — ApprovalsTable's
// expandable "Team" row reuses this exact component rather than
// duplicating the per-contributor approve/return logic a second time.
export function ContributorsBreakdown({ kpi, assignees, contributions }) {
  return (
    <div className="mt-3 pt-3 border-t border-line">
      <label className="field-label block mb-1.5">Contributions from your team</label>
      <div className="flex flex-col gap-2">
        {assignees.map((individual) => {
          const row = contributions.find((c) => c.individual_id === individual.id) || null;
          return <ContributorRow key={individual.id} kpi={kpi} individual={individual} row={row} />;
        })}
      </div>
    </div>
  );
}

function ContributorRow({ kpi, individual, row }) {
  const { period, reloadContributions } = useApp();
  const toast = useToast();
  const status = valueStatus(row);
  const [showReturn, setShowReturn] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn, okMsg) {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg); await reloadContributions(); }
    catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-line bg-sunken/40 px-3 py-2.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="font-semibold text-[12.6px]">{individual.name}</span>
        <span className={`chip chip-st-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="ml-auto font-display font-bold tabular-nums text-[13px]">
          {row?.value != null ? `${row.value} ${kpi.measure}` : '—'}
        </span>
        {status === 'submitted' && (
          <div className="flex gap-1.5 flex-none">
            <button className="btn btn-sm btn-primary" disabled={busy}
              onClick={() => run(() => api(`/kpis/${kpi.id}/contribution/${individual.id}/approve`, { method: 'POST', body: { year: period.year, month: period.month } }), 'Contribution approved.')}>
              Approve
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setShowReturn((v) => !v)}>Return…</button>
          </div>
        )}
      </div>
      {row?.return_comment && status === 'returned' && (
        <div className="mt-2 rounded-lg bg-warning-soft text-warning text-[11.8px] px-3 py-2">
          <b>You returned this:</b> {row.return_comment}
        </div>
      )}
      {showReturn && (
        <div className="mt-2 space-y-1.5">
          <textarea rows={2} className="field-input" placeholder="Reason for returning this contribution"
            value={returnComment} onChange={(e) => setReturnComment(e.target.value)} />
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => {
              if (!returnComment.trim()) { toast('A reason is required to return a contribution.', 'err'); return; }
              run(() => api(`/kpis/${kpi.id}/contribution/${individual.id}/return`, { method: 'POST', body: { year: period.year, month: period.month, comment: returnComment.trim() } }), 'Returned to them.')
                .then(() => { setShowReturn(false); setReturnComment(''); });
            }}>
            Confirm return
          </button>
        </div>
      )}
    </div>
  );
}
