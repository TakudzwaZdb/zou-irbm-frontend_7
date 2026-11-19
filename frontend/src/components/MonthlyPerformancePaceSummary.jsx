import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { GLOBAL_REPORT_ROLES, MONTHS } from '../lib/scope.js';

function percentage(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

export default function MonthlyPerformancePaceSummary({ period, orgNode }) {
  const { user, hasPerm, kpis } = useApp();
  const allowed = !GLOBAL_REPORT_ROLES.includes(user.role) || hasPerm('view_institutional_performance');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const nodeKey = orgNode ? `${orgNode.kind}:${orgNode.id}` : 'all';

  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    const params = new URLSearchParams({
      cycleYear: String(period.year),
      periodType: 'monthly',
      periodIndex: String(period.month),
    });
    if (nodeKey !== 'all') params.set('orgNode', nodeKey);
    setData(null);
    setError(null);
    api(`/kpis/performance-target?${params}`)
      .then((result) => { if (active) setData(result); })
      .catch((requestError) => { if (active) setError(requestError.message || 'Monthly expected pace could not be loaded.'); });
    return () => { active = false; };
  }, [allowed, period.year, period.month, nodeKey, kpis]);

  if (!allowed) return null;
  const summary = data?.summary;
  const variance = summary?.averagePaceVariancePct;
  const configured = Number(summary?.paceKpiCount || 0);
  const hasVariance = Number.isFinite(variance);
  const status = hasVariance
    ? summary.isBehindPace ? 'Overall behind expected pace' : variance < 0 ? 'Overall ahead of expected pace' : 'Overall on expected pace'
    : configured === 0 && Number(summary?.notConfiguredPaceCount || 0) > 0
      ? 'No KPI reporting milestones configured'
      : 'No approved performance comparison available';
  const statusColor = hasVariance && summary.isBehindPace ? 'text-warning' : 'text-good';

  return (
    <section className="card mb-5 border-l-4 border-l-accent-500" aria-labelledby="monthly-performance-pace-title" aria-busy={!data && !error}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-accent-700">Performance · Monthly</p>
          <h2 id="monthly-performance-pace-title" className="mt-0.5 font-display text-[16px] font-bold">
            KPI milestone expected pace · {MONTHS[period.month]} {period.year}
          </h2>
        </div>
        <span className={`text-[12px] font-bold ${statusColor}`} aria-live="polite">
          {!data && !error ? 'Loading monthly pace…' : status}
        </span>
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[12px] text-warning">{error}</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PaceMetric label="Expected pace" value={percentage(summary?.expectedPacePct)} />
          <PaceMetric label="Approved actual performance" value={percentage(summary?.averagePacePerformancePct)} />
          <PaceMetric
            label="Expected pace − actual"
            value={hasVariance ? `${variance > 0 ? '+' : ''}${variance.toFixed(1)} pts` : '—'}
            emphasis={hasVariance && variance > 0}
          />
          <PaceMetric label="KPIs compared" value={configured} detail={`${summary?.behindPaceCount || 0} behind pace`} />
        </div>
      )}
      {!error && summary?.notConfiguredPaceCount > 0 && (
        <p className="mt-2 text-[11px] text-ink-muted">
          {summary.notConfiguredPaceCount} KPI{summary.notConfiguredPaceCount === 1 ? '' : 's'} without a monthly milestone for this period.
        </p>
      )}
    </section>
  );
}

function PaceMetric({ label, value, detail, emphasis = false }) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
      <div className="text-[9.5px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 font-display text-[17px] font-extrabold tabular-nums ${emphasis ? 'text-warning' : 'text-ink'}`}>{value}</div>
      {detail && <div className="mt-0.5 text-[10px] text-ink-muted">{detail}</div>}
    </div>
  );
}
