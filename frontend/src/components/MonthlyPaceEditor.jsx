import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { MONTHS } from '../lib/scope.js';
import { monthlyMilestoneDraft, withMonthlyMilestones } from '../lib/reportingPeriods.js';

export default function MonthlyPaceEditor({ kpi, onClose }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  const [values, setValues] = useState(() => {
    try {
      return { milestones: monthlyMilestoneDraft(kpi.reporting_periods), error: null };
    } catch (error) {
      return { milestones: Array(12).fill(''), error: error.message };
    }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function save(event) {
    event.preventDefault();
    if (values.error) return;
    setBusy(true);
    try {
      const reportingPeriods = withMonthlyMilestones(kpi.reporting_periods, values.milestones);
      await api(`/kpis/${kpi.id}/reporting-periods`, {
        method: 'PATCH',
        body: { reportingPeriods },
      });
      await reloadCore();
      toast(`Monthly expected pace milestones saved for "${kpi.name}".`);
      onClose();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => { if (!busy) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="monthly-pace-editor-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-line bg-surface shadow-lg" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-none items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 id="monthly-pace-editor-title" className="font-display text-[14.5px] font-bold">Monthly expected pace</h2>
            <p className="mt-0.5 text-[11px] text-ink-secondary">{kpi.name}</p>
          </div>
          <button type="button" className="text-ink-muted hover:text-ink" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        <form onSubmit={save} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <p className="text-[12px] leading-relaxed text-ink-secondary">
            Enter the expected KPI value for each reporting month. Leave a month blank when no milestone is configured;
            blank months are not treated as zero. Other reporting schedules are preserved.
          </p>
          {values.error && <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-[12px] text-critical">{values.error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MONTHS.slice(1).map((month, index) => {
              const id = `monthly-pace-${kpi.id}-${index + 1}`;
              return (
                <label key={month} htmlFor={id} className="text-[11.5px] font-semibold text-ink-secondary">
                  {month}
                  <input
                    id={id}
                    type="number"
                    step="any"
                    className="field-input mt-1"
                    value={values.milestones[index]}
                    onChange={(event) => setValues((current) => ({
                      ...current,
                      milestones: current.milestones.map((value, valueIndex) => valueIndex === index ? event.target.value : value),
                    }))}
                    aria-label={`${month} expected KPI value`}
                  />
                </label>
              );
            })}
          </div>
          <div className="flex gap-2 border-t border-line pt-3">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || Boolean(values.error)}>
              {busy ? 'Saving…' : 'Save monthly milestones'}
            </button>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
