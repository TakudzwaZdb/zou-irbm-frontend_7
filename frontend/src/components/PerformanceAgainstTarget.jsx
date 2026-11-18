import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { GLOBAL_REPORT_ROLES, MONTHS } from '../lib/scope.js';
import { PERIOD_TYPES, PERIOD_TYPE_LABEL } from '../lib/period.js';
import RagBarChart from './RagBarChart.jsx';
import RagPieChart from './RagPieChart.jsx';
import VarianceChart from './VarianceChart.jsx';
import PaginatedRows from './PaginatedRows.jsx';

const TARGET_RAG_LABELS = {
  green: 'On track',
  amber: 'At risk',
  red: 'Off track',
  none: 'Missing / not calculable',
};
const STATUS = {
  achieved: { label: 'On track', className: 'chip-rag-green', color: 'var(--color-good)' },
  approaching: { label: 'At risk', className: 'chip-rag-amber', color: 'var(--color-warning)' },
  'below-target': { label: 'Off track', className: 'chip-rag-red', color: 'var(--color-critical)' },
  missing: { label: 'No reported actuals', className: 'chip-rag-none', color: 'var(--color-ink-muted)' },
  pending: { label: 'Awaiting approval', className: 'chip-rag-none', color: 'var(--color-ink-muted)' },
  returned: { label: 'Returned for correction', className: 'chip-rag-none', color: 'var(--color-ink-muted)' },
  'not-calculable': { label: 'Not calculable — review KPI rule', className: 'chip-rag-none', color: 'var(--color-ink-muted)' },
  'no-kpis': { label: 'No assigned KPIs', className: 'chip-rag-none', color: 'var(--color-ink-muted)' },
};

function periodCount(type) {
  if (type === 'monthly') return 12;
  if (type === 'quarterly') return 4;
  if (type === 'biannual') return 2;
  return 1;
}

function periodOption(type, index) {
  if (type === 'monthly') return MONTHS[index];
  if (type === 'quarterly') return `Q${index}`;
  if (type === 'biannual') return `H${index}`;
  return 'Full year';
}

function FilterIcon({ name, size = 17 }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  let shape;
  if (name === 'cycle') {
    shape = <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>;
  } else if (name === 'reporting') {
    shape = <><path d="M4 7h12a4 4 0 0 1 0 8H8" /><path d="m8 11-4 4 4 4" /><path d="m16 3 4 4-4 4" /></>;
  } else if (name === 'period') {
    shape = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
  } else if (name === 'tier') {
    shape = <><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" /><path d="M2 20h20" /></>;
  } else if (name === 'scope') {
    shape = <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></>;
  } else if (name === 'filter') {
    shape = <><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" /></>;
  } else if (name === 'reset') {
    shape = <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 1-2-5l3 5" /></>;
  } else {
    shape = <path d="m7 10 5 5 5-5" />;
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...common}>{shape}</svg>;
}

function FilterField({ icon, label, children }) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <span className="flex h-[60px] items-center overflow-hidden rounded-lg border border-line-strong bg-surface transition-colors focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/30">
        <span className="flex h-full w-10 flex-none items-center justify-center border-r border-line text-ink-muted">
          <FilterIcon name={icon} />
        </span>
        <span className="min-w-0 flex-1 px-2">
          <span aria-hidden="true" className="block text-[10px] font-semibold leading-4 text-ink-muted">{label}</span>
          {children}
        </span>
        <span className="flex-none pr-2.5 text-ink-muted"><FilterIcon name="chevron" size={15} /></span>
      </span>
    </label>
  );
}

function StatusCard({ label, value, description, color, className }) {
  return (
    <div
      role="group"
      aria-label={`${label}: ${value} KPIs`}
      className={`rounded-xl border bg-surface px-4 py-3 ${className}`}
      style={{
        borderColor: `color-mix(in srgb, ${color} 44%, transparent)`,
        boxShadow: `0 0 16px color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <div className="text-[12px] font-bold text-ink-secondary">{label}</div>
      <div className="font-display font-extrabold text-[30px] leading-tight tabular-nums">{value}</div>
      <p className="text-[11.5px] text-ink-muted">{description}</p>
    </div>
  );
}

function PerformanceGauge({ value, status }) {
  const hasValue = value != null && Number.isFinite(Number(value));
  const numericValue = hasValue ? Number(value) : 0;
  const progress = Math.max(0, Math.min(100, numericValue));
  const color = STATUS[status]?.color || STATUS.missing.color;
  const label = hasValue ? STATUS[status]?.label || 'Calculated' : 'Not available';
  const needleAngle = Math.PI + (progress / 100) * Math.PI;
  const needleX = 120 + 68 * Math.cos(needleAngle);
  const needleY = 135 + 68 * Math.sin(needleAngle);

  return (
    <div
      role="group"
      aria-label={`Average performance against target: ${hasValue ? `${numericValue}%` : 'not available'}, ${label}`}
      className="flex min-w-0 flex-col items-center justify-center rounded-xl border bg-surface px-4 py-3"
      style={{
        borderColor: `color-mix(in srgb, ${color} 52%, transparent)`,
        boxShadow: `0 0 22px color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      <p className="text-center text-[11px] font-bold uppercase tracking-wide text-ink-muted">Average performance against target</p>
      <div className="font-display text-[42px] font-extrabold leading-tight tabular-nums text-ink">
        {hasValue ? `${numericValue.toFixed(1)}%` : '—'}
      </div>
      <svg className="h-[150px] w-full max-w-[340px]" viewBox="0 0 240 170" aria-hidden="true">
        <path d="M30 135 A90 90 0 0 1 210 135" fill="none" stroke="var(--color-line-strong)" strokeWidth="17" strokeLinecap="round" pathLength="100" />
        <path
          d="M30 135 A90 90 0 0 1 210 135"
          fill="none"
          stroke={color}
          strokeWidth="17"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${hasValue ? progress : 0} 100`}
          style={{ filter: `drop-shadow(0 0 5px ${color}80)` }}
        />
        {hasValue && <line x1="120" y1="135" x2={needleX} y2={needleY} stroke="var(--color-ink-muted)" strokeWidth="5" strokeLinecap="round" />}
        {hasValue && <circle cx="120" cy="135" r="7" fill="var(--color-ink-secondary)" />}
        <text x="50" y="122" textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="10">Off track</text>
        <text x="50" y="136" textAnchor="middle" fill="var(--color-ink-muted)" fontSize="9">&lt;80%</text>
        <text x="120" y="67" textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="10">At risk</text>
        <text x="120" y="81" textAnchor="middle" fill="var(--color-ink-muted)" fontSize="9">80–&lt;100%</text>
        <text x="190" y="122" textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="10">On track</text>
        <text x="190" y="136" textAnchor="middle" fill="var(--color-ink-muted)" fontSize="9">≥100%</text>
      </svg>
      <span className={`chip ${hasValue ? STATUS[status]?.className || 'chip-rag-none' : 'chip-rag-none'} -mt-1`}>
        {label}
      </span>
    </div>
  );
}

function CoverageGauge({ value }) {
  const hasValue = value != null && Number.isFinite(Number(value));
  const progress = hasValue ? Math.max(0, Math.min(100, Number(value))) : 0;
  return (
    <svg
      className="h-10 w-[72px] flex-none"
      viewBox="0 0 120 68"
      role="img"
      aria-label={`Approved submission coverage: ${hasValue ? `${Number(value)}%` : 'not available'}`}
    >
      <path d="M12 58 A48 48 0 0 1 108 58" fill="none" stroke="var(--color-line-strong)" strokeWidth="10" strokeLinecap="round" pathLength="100" />
      {hasValue && (
        <path
          d="M12 58 A48 48 0 0 1 108 58"
          fill="none"
          stroke="var(--color-ink-muted)"
          strokeWidth="10"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${progress} 100`}
        />
      )}
    </svg>
  );
}

export default function PerformanceAgainstTarget({ eyebrow = 'OVERVIEW', onDataLoaded, syncSelectedNode = false }) {
  const { user, hasPerm, perfPeriod, perfValues, selNode } = useApp();
  const allowed = !GLOBAL_REPORT_ROLES.includes(user.role) || hasPerm('view_institutional_performance');
  const [cycleYear, setCycleYear] = useState(null);
  const [reportType, setReportType] = useState(perfPeriod.type);
  const [reportIndex, setReportIndex] = useState(perfPeriod.idx);
  const [tierFilter, setTierFilter] = useState('all');
  const [orgNodeFilter, setOrgNodeFilter] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setReportType(perfPeriod.type);
    setReportIndex(perfPeriod.idx);
  }, [perfPeriod.type, perfPeriod.idx]);

  useEffect(() => {
    if (syncSelectedNode) setOrgNodeFilter(selNode ? `${selNode.kind}:${selNode.id}` : 'all');
  }, [selNode, syncSelectedNode]);

  const selectedYear = cycleYear ?? perfPeriod.year;
  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    const params = new URLSearchParams({
      cycleYear: String(selectedYear),
      periodType: reportType,
      periodIndex: String(reportIndex),
    });
    if (orgNodeFilter !== 'all') params.set('orgNode', orgNodeFilter);
    if (tierFilter !== 'all') params.set('tier', tierFilter);

    setLoading(true);
    onDataLoaded?.(null);
    api(`/kpis/performance-target?${params}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        onDataLoaded?.(result);
        setError(null);
        if (cycleYear == null && result.strategicYears.includes(perfPeriod.year)) {
          setCycleYear(perfPeriod.year);
        } else if (cycleYear == null && result.strategicYears.length) {
          setCycleYear(result.strategicYears[result.strategicYears.length - 1]);
        }
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load performance against target.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, selectedYear, reportType, reportIndex, tierFilter, orgNodeFilter, perfValues, onDataLoaded]);

  const childrenByParent = useMemo(() => {
    const result = new Map();
    for (const node of data?.nodes || []) {
      if (!node.parentKey) continue;
      const children = result.get(node.parentKey) || [];
      children.push(node);
      result.set(node.parentKey, children);
    }
    return result;
  }, [data]);

  if (!allowed) return null;

  const summary = data?.summary;
  const kpiDetails = data?.kpis || [];
  const ragCounts = kpiDetails.reduce((counts, kpi) => {
    const key = kpi.status === 'achieved' ? 'green'
      : kpi.status === 'approaching' ? 'amber'
        : ['missing', 'pending', 'returned', 'not-calculable'].includes(kpi.status) ? 'none' : 'red';
    counts[key] += 1;
    return counts;
  }, { green: 0, amber: 0, red: 0, none: 0 });
  const paceData = kpiDetails
    .filter((kpi) => kpi.actualProgressPct != null && kpi.progressExpectedPacePct != null)
    .map((kpi) => ({
      name: kpi.name,
      owner: kpi.ownerUnitName ? `${kpi.ownerName} · ${kpi.ownerUnitName}` : kpi.ownerName,
      ownerKind: kpi.ownerTier,
      actual: kpi.actualProgressPct,
      expected: kpi.progressExpectedPacePct,
      variance: kpi.paceVariancePct,
      flag: kpi.paceFlag,
    }));
  const behindPace = kpiDetails
    .filter((kpi) => kpi.paceFlag === 'behind' || kpi.paceFlag === 'attention')
    .sort((a, b) => a.paceVarianceRawPct - b.paceVarianceRawPct);
  const expectedPacePct = summary?.expectedPacePct ?? null;
  const averagePaceVariance = summary?.averagePaceVariancePct ?? null;
  const paceMaxValue = Math.max(100, Math.ceil(Math.max(0, ...paceData.map((item) => item.actual)) / 10) * 10);
  const periodLabel = `${PERIOD_TYPE_LABEL[reportType]} · ${periodOption(reportType, reportIndex)} ${selectedYear}`;

  function clearFilters() {
    setCycleYear(null);
    setReportType(perfPeriod.type);
    setReportIndex(perfPeriod.idx);
    setTierFilter('all');
    setOrgNodeFilter('all');
  }

  return (
    <section className="card mb-6 p-4 sm:p-5" aria-labelledby="performance-target-title" aria-busy={loading}>
      <div className="flex flex-wrap justify-between items-start gap-4 mb-5">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.12em] text-accent-600 mb-1">{eyebrow} · PERFORMANCE</p>
          <h2 id="performance-target-title" className="font-display font-extrabold text-[24px] leading-tight">
            Performance against target
          </h2>
          <p className="text-[12.5px] text-ink-secondary mt-1 max-w-2xl">
            Review approved KPI results, identify performance risks, and compare progress with the expected pace.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-sunken/40 p-3 sm:p-4 mb-4">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-ink-muted"><FilterIcon name="filter" size={19} /></span>
            <h3 className="font-display font-bold text-[13px]">Report filters</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="chip bg-surface text-ink-secondary hover:border-accent-500"
              aria-label="Reset reporting period filter"
              onClick={() => { setReportType(perfPeriod.type); setReportIndex(perfPeriod.idx); }}
            >
              Period: {periodOption(reportType, reportIndex)} <span aria-hidden="true">×</span>
            </button>
            <button
              type="button"
              className="chip bg-surface text-ink-secondary hover:border-accent-500"
              aria-label="Reset strategic plan cycle filter"
              onClick={() => setCycleYear(null)}
            >
              Cycle: {selectedYear} <span aria-hidden="true">×</span>
            </button>
            <button type="button" className="btn btn-ghost btn-sm text-ink-secondary" onClick={clearFilters}>
              Clear filters <FilterIcon name="reset" size={15} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <FilterField icon="cycle" label="Cycle">
            <select className="block w-full min-w-0 appearance-none bg-transparent p-0 text-[15px] font-semibold leading-5 text-ink" aria-label="Strategic plan cycle" value={selectedYear} onChange={(e) => setCycleYear(Number(e.target.value))}>
              {(data?.strategicYears?.length ? data.strategicYears : [selectedYear]).map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </FilterField>
          <FilterField icon="reporting" label="Reporting">
            <select className="block w-full min-w-0 appearance-none bg-transparent p-0 text-[15px] font-semibold leading-5 text-ink" aria-label="Reporting period type" value={reportType} onChange={(e) => { setReportType(e.target.value); setReportIndex(1); }}>
              {PERIOD_TYPES.map((type) => <option key={type} value={type}>{PERIOD_TYPE_LABEL[type]}</option>)}
            </select>
          </FilterField>
          <FilterField icon="period" label="Period">
            <select className="block w-full min-w-0 appearance-none bg-transparent p-0 text-[15px] font-semibold leading-5 text-ink" aria-label="Reporting period selection" value={reportIndex} onChange={(e) => setReportIndex(Number(e.target.value))}>
              {Array.from({ length: periodCount(reportType) }, (_, index) => index + 1).map((index) => (
                <option key={index} value={index}>{periodOption(reportType, index)}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon="tier" label="Tier">
            <select className="block w-full min-w-0 appearance-none bg-transparent p-0 text-[15px] font-semibold leading-5 text-ink" aria-label="Organisational tier filter" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
              <option value="all">All tiers</option>
              {(data?.tiers || []).map((tier) => <option key={tier.key} value={tier.key}>{tier.tier}</option>)}
            </select>
          </FilterField>
          <FilterField icon="scope" label="Scope">
            <select className="block w-full min-w-0 appearance-none bg-transparent p-0 text-[15px] font-semibold leading-5 text-ink" aria-label="Organisational unit filter" value={orgNodeFilter} onChange={(e) => { setOrgNodeFilter(e.target.value); setTierFilter('all'); }}>
              <option value="all">All in my scope</option>
              {(data?.unitOptions || []).map((node) => <option key={node.key} value={node.key}>{node.tier}: {node.name}</option>)}
            </select>
          </FilterField>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-critical-soft text-critical text-[12px] px-3 py-2 mb-3">{error}</p>}
      {loading && !data && <p className="text-[12px] text-ink-muted py-6 text-center">Loading approved performance results…</p>}
      {loading && data && <p role="status" className="text-[11.5px] text-accent-600 mb-3">Updating results…</p>}
      {!data && !loading && !error && <p className="text-[12px] text-ink-muted py-6 text-center">No performance data is available.</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4 items-stretch">
            <div className="min-w-0 xl:col-span-2">
              <div className="flex justify-between flex-wrap gap-3 items-center rounded-xl border border-accent-500/20 border-l-4 border-l-accent-500 bg-gradient-to-r from-accent-50/80 to-surface px-4 py-3 mb-4">
                <div>
                  <p className="text-[10.5px] font-extrabold tracking-[0.12em] text-accent-600 mb-0.5">PERFORMANCE SUMMARY</p>
                  <h3 className="font-display font-extrabold text-[22px] leading-tight">
                    <span className="text-accent-700">
                      {data.summaryName === 'University-wide' ? 'Institutional performance' : 'Performance summary'}
                    </span>
                    {data.summaryName !== 'University-wide' && (
                      <>
                        <span className="text-ink-muted"> · </span>
                        <span className="inline-block rounded-lg border border-good/30 bg-good-soft px-3 py-1 text-[17px] font-extrabold text-good shadow-sm align-middle">
                          {data.summaryName}
                        </span>
                      </>
                    )}
                  </h3>
                </div>
                <span className="chip border border-accent-500/20 bg-surface text-accent-700">{periodLabel} · approved values</span>
              </div>
              <div className="flex flex-wrap justify-between items-baseline gap-2 mb-2">
                <h3 className="font-display font-bold text-[16px]">KPI status</h3>
                <span className="text-[11px] text-ink-muted">Based on performance against each KPI target</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <StatusCard label="On track" value={summary?.achieved ?? 0} description="100% or more of target" color={STATUS.achieved.color} className="text-good" />
                <StatusCard label="At risk" value={summary?.approaching ?? 0} description="80% to under 100% of target" color={STATUS.approaching.color} className="text-warning" />
                <StatusCard label="Off track" value={summary?.offTrack ?? 0} description="Below 80% of target" color={STATUS['below-target'].color} className="text-critical" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <SummaryCard label="Total KPIs" value={summary?.totalKpis ?? 0} />
                <SummaryCard label="No reported actual" value={summary?.missingActual ?? 0} className="text-ink-muted" description="Not included as zero" />
                <SummaryCard
                  label="Approved submission coverage"
                  value={summary?.submissionCoveragePct == null ? '—' : `${summary.submissionCoveragePct}%`}
                  className={summary?.provisional ? 'text-warning' : 'text-good'}
                  description="Approved actuals received"
                  visual={<CoverageGauge value={summary?.submissionCoveragePct} />}
                />
              </div>
            </div>
            <PerformanceGauge value={summary?.averagePerformance} status={summary?.status} />
          </div>
          {(summary?.provisional || summary?.ratingStatus === 'not_configured') && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft/40 px-3 py-2.5 mb-4 text-[11.5px] text-ink-secondary">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip chip-rag-amber">Provisional summary</span>
                <span>Numerical performance is shown separately; no approved rating matrix is configured.</span>
              </div>
              {!!summary?.provisionalReasons?.length && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold text-ink-secondary">Calculation notes</summary>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {summary.provisionalReasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
            <div className="card">
              <h3 className="font-display font-bold text-[14px] mb-1">KPI status distribution</h3>
              <p className="text-[11px] text-ink-muted mb-2">On track (100%+), at risk (80% to under 100%), off track (below 80%), and missing actuals.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
                <div>
                  <p className="text-center text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">Share of KPIs</p>
                  <RagPieChart counts={ragCounts} labels={TARGET_RAG_LABELS} height={220} />
                </div>
                <div>
                  <p className="text-center text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">KPI count</p>
                  <RagBarChart counts={ragCounts} labels={TARGET_RAG_LABELS} height={200} />
                </div>
              </div>
            </div>
            <div className="card min-w-0">
              <h3 className="font-display font-bold text-[14px] mb-1">Variance analysis — actual vs. expected pace</h3>
              <p className="text-[11px] text-ink-muted mb-2">
                Uses the same baseline-to-target progress and month-based expected pace as Progress, from each KPI’s latest approved actual in this period.
              </p>
              <div className="rounded-lg bg-sunken/60 px-3 py-2 mb-2 flex flex-wrap justify-between gap-2 text-[11.5px]">
                <span>Average pace variance · expected {expectedPacePct == null ? '—' : `${expectedPacePct}%`} · {periodLabel}</span>
                <strong className={averagePaceVariance == null ? 'text-ink-muted' : averagePaceVariance <= -10 ? 'text-critical' : averagePaceVariance < 0 ? 'text-warning' : averagePaceVariance >= 10 ? 'text-good' : 'text-accent-600'}>
                  {averagePaceVariance == null ? '—' : `${averagePaceVariance > 0 ? '+' : ''}${averagePaceVariance} pts`}
                </strong>
              </div>
              <VarianceChart data={paceData} height={250} maxValue={paceMaxValue} />
            </div>
          </div>

          <BehindPaceTable kpis={behindPace} periodLabel={periodLabel} />

          <KpiPerformanceTable kpis={kpiDetails} periodLabel={periodLabel} />

          <OrganisationUnitBreakdown
            data={data}
            childrenByParent={childrenByParent}
            tierFilter={tierFilter}
            onHome={() => { setOrgNodeFilter('all'); setTierFilter('all'); }}
            onDrill={(selected) => { setOrgNodeFilter(selected.key); setTierFilter('all'); }}
          />
          <p className="text-[10.5px] text-ink-muted mt-3">
            Each KPI appears once in an aggregate. Parent results include their descendants. Missing actuals are excluded from averages, never treated as zero.
          </p>
        </>
      )}
    </section>
  );
}

function SummaryCard({ label, value, className = '', status, description, visual }) {
  return (
    <div className="rounded-lg border border-line bg-sunken/50 px-3 py-3 min-h-[104px]">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-bold min-h-7 leading-snug">{label}</div>
      <div className="flex items-center justify-between gap-1">
        <div className={`font-display font-extrabold text-[23px] tabular-nums ${className}`}>{value}</div>
        {visual}
      </div>
      {status && <span className={`chip ${STATUS[status]?.className || 'chip-rag-none'} mt-1`}>{STATUS[status]?.label || status}</span>}
      {description && <p className="text-[10.5px] text-ink-muted mt-1">{description}</p>}
    </div>
  );
}

function KpiPerformanceTable({ kpis, periodLabel }) {
  return (
    <details className="card mt-5">
      <summary className="cursor-pointer font-display font-bold text-[14px]">
        KPI performance detail <span className="text-[11px] text-ink-muted font-normal">— {kpis.length} KPIs · {periodLabel}</span>
      </summary>
      <div className="overflow-x-auto mt-3">
        <table className="w-full min-w-[980px] text-[12px]">
          <caption className="sr-only">KPI target performance, baseline progress, and approved milestone performance for {periodLabel}</caption>
          <thead>
            <tr className="bg-sunken text-[10px] uppercase tracking-wide text-ink-secondary font-bold">
              <th className="px-3 py-2.5 text-left">KPI / owner</th>
              <th className="px-3 py-2.5 text-right">Actual</th>
              <th className="px-3 py-2.5 text-right">Target</th>
              <th className="px-3 py-2.5 text-right">Target performance</th>
              <th className="px-3 py-2.5 text-right">Baseline progress</th>
              <th className="px-3 py-2.5 text-right">Target variance</th>
              <th className="px-3 py-2.5 text-right">Milestone progress expected</th>
              <th className="px-3 py-2.5 text-right">Performance vs milestone</th>
              <th className="px-3 py-2.5 text-right">Milestone variance</th>
              <th className="px-3 py-2.5 text-right">Weight</th>
              <th className="px-3 py-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            <PaginatedRows items={kpis} colSpan={11} emptyMessage="No KPIs are assigned in this scope." renderRow={(kpi) => {
              const status = STATUS[kpi.status] || STATUS.missing;
              const rowClass = kpi.paceFlag === 'attention' || kpi.status === 'below-target'
                ? 'bg-critical-soft/35'
                : kpi.paceFlag === 'behind' || kpi.status === 'approaching' ? 'bg-warning-soft/35' : '';
              const paceClass = kpi.paceFlag === 'attention' ? 'text-critical font-bold'
                : kpi.paceFlag === 'behind' ? 'text-warning font-semibold'
                  : kpi.paceFlag === 'ahead' ? 'text-good font-semibold' : 'text-ink-secondary';
              const targetVarianceSuffix = kpi.measure === '%' ? ' pp' : kpi.measure ? ` ${kpi.measure}` : '';
              const expectedVarianceSuffix = kpi.measure === '%' ? ' pp' : kpi.measure ? ` ${kpi.measure}` : '';
              return (
                <tr key={kpi.id} className={`border-t border-line ${rowClass}`}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{kpi.name}</div>
                    <div className="text-[10.5px] text-ink-muted">{kpi.ownerTier} · {kpi.ownerName}{kpi.ownerUnitName ? ` · ${kpi.ownerUnitName}` : ''}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.actual == null ? '—' : `${kpi.actual}${kpi.measure ? ` ${kpi.measure}` : ''}`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.target == null ? '—' : `${kpi.target}${kpi.measure ? ` ${kpi.measure}` : ''}`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.performancePct == null ? '—' : `${kpi.performancePct}%`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.baselineProgressPct == null ? '—' : `${kpi.baselineProgressPct}%`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.targetVariance == null ? '—' : `${kpi.targetVariance > 0 ? '+' : ''}${kpi.targetVariance}${targetVarianceSuffix}`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.expectedPacePct == null ? '—' : `${kpi.expectedPacePct}%`}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${paceClass}`}>{kpi.performanceAgainstExpectedPct == null ? '—' : `${kpi.performanceAgainstExpectedPct}%`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.expectedVariance == null ? '—' : `${kpi.expectedVariance > 0 ? '+' : ''}${kpi.expectedVariance}${expectedVarianceSuffix}`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.weight}</td>
                  <td className="px-3 py-2.5"><span className={`chip ${status.className}`}>{status.label}</span></td>
                </tr>
              );
            }} />
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] text-ink-muted mt-2">
        The variance chart uses the same month-based pace as Progress. These detail columns use configured KPI milestones; “pp” denotes percentage points.
      </p>
    </details>
  );
}

function BehindPaceTable({ kpis, periodLabel }) {
  return (
    <section className="card mb-5" aria-labelledby="behind-pace-title">
      <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
        <div>
          <h3 id="behind-pace-title" className="font-display font-bold text-[14px]">KPIs behind expected pace</h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            All KPIs whose baseline-to-target progress is below the pace expected by {periodLabel}, ordered by largest gap.
          </p>
        </div>
        <span className="chip chip-rag-red">{kpis.length} behind pace</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12px]">
          <caption className="sr-only">KPIs with baseline progress behind expected calendar pace for {periodLabel}</caption>
          <thead>
            <tr className="bg-sunken text-[10px] uppercase tracking-wide text-ink-secondary font-bold">
              <th className="px-3 py-2.5 text-left">KPI / owner</th>
              <th className="px-3 py-2.5 text-right">Actual progress</th>
              <th className="px-3 py-2.5 text-right">Expected pace</th>
              <th className="px-3 py-2.5 text-right">Variance</th>
              <th className="px-3 py-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            <PaginatedRows items={kpis} colSpan={5} emptyMessage="No KPIs are behind expected pace for this period." renderRow={(kpi) => (
              <tr key={kpi.id} className={`border-t border-line ${kpi.paceFlag === 'attention' ? 'bg-critical-soft/35' : 'bg-warning-soft/35'}`}>
                <td className="px-3 py-2.5">
                  <div className="font-semibold">{kpi.name}</div>
                  <div className="text-[10.5px] text-ink-muted">{kpi.ownerTier} · {kpi.ownerName}{kpi.ownerUnitName ? ` · ${kpi.ownerUnitName}` : ''}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{kpi.actualProgressPct == null ? '—' : `${kpi.actualProgressPct}%`}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{kpi.progressExpectedPacePct == null ? '—' : `${kpi.progressExpectedPacePct}%`}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${kpi.paceFlag === 'attention' ? 'text-critical' : 'text-warning'}`}>
                  {kpi.paceVariancePct > 0 ? '+' : ''}{kpi.paceVariancePct} pts
                </td>
                <td className="px-3 py-2.5">
                  <span className={`chip ${kpi.paceFlag === 'attention' ? 'chip-rag-red' : 'chip-rag-amber'}`}>
                    {kpi.paceFlag === 'attention' ? 'Significantly behind' : 'Behind pace'}
                  </span>
                </td>
              </tr>
            )} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrganisationUnitBreakdown({ data, childrenByParent, tierFilter, onHome, onDrill }) {
  const nodesByKey = new Map((data.unitOptions || []).map((node) => [node.key, node]));
  const path = [];
  let current = nodesByKey.get(data.rootKey);
  while (current && !path.some((node) => node.key === current.key)) {
    path.push(current);
    current = current.parentKey ? nodesByKey.get(current.parentKey) : null;
  }
  path.reverse();
  const scopeRoot = path[0];
  const rootNode = data.nodes.find((node) => node.key === data.rootKey);
  const children = tierFilter === 'all'
    ? childrenByParent.get(data.rootKey) || []
    : data.nodes.filter((node) => node.key !== data.rootKey);
  const firstChild = children[0];
  const heading = tierFilter === 'all'
    ? rootNode?.kind === 'university' ? 'Programmes'
      : rootNode?.kind === 'programme' ? 'Sub-programmes'
        : rootNode?.kind === 'sub' ? 'Departments / Units'
          : rootNode?.kind === 'unit' ? 'Employees' : 'Subordinate organisational units'
    : `${firstChild?.tier || 'Organisational units'} comparison`;

  return (
    <section className="card mt-5" aria-labelledby="organisational-unit-breakdown-title">
      <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-ink-muted mb-3">
        <button type="button" className="hover:text-accent-500 hover:underline" onClick={onHome}>Home</button>
        <span>/</span>
        <button type="button" className="hover:text-accent-500 hover:underline" onClick={onHome}>
          {scopeRoot?.kind === 'university' ? 'All Programmes' : 'My scope'}
        </button>
        {path.slice(1).map((node, index) => (
          <span key={node.key} className="flex items-center gap-1.5">
            <span>/</span>
            {index === path.length - 2
              ? <b className="text-ink-secondary">{node.name}</b>
              : <button type="button" className="hover:text-accent-500 hover:underline" onClick={() => onDrill(node)}>{node.name}</button>}
          </span>
        ))}
        {path.length === 1 && scopeRoot?.kind !== 'university' && (
          <span className="flex items-center gap-1.5"><span>/</span><b className="text-ink-secondary">{scopeRoot.name}</b></span>
        )}
      </div>

      <div className="flex justify-between gap-3 flex-wrap items-start mb-3">
        <div>
          <h3 id="organisational-unit-breakdown-title" className="font-display font-bold text-[14.5px]">
            Organisational unit breakdown
          </h3>
          <p className="text-[11.5px] text-ink-muted mt-0.5">
            {data.summaryName} · select a unit card to view its target performance.
          </p>
        </div>
        {data.rootKey !== 'university:0' && (
          <span className="chip bg-sunken text-ink-secondary">{rootNode?.tier || scopeRoot?.tier || 'Organisational unit'}</span>
        )}
      </div>

      <h4 className="font-display font-bold text-[13px] mb-2">{heading}</h4>
      {children.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {children.map((node) => <PerformanceNodeCard key={node.key} node={node} onDrill={onDrill} />)}
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-muted py-5 text-center">
          {tierFilter === 'all' ? 'No subordinate organisational units are available at this level.' : 'No organisational units match this tier and scope.'}
        </p>
      )}
    </section>
  );
}

function PerformanceNodeCard({ node, onDrill }) {
  const status = STATUS[node.status] || STATUS.missing;
  const pct = node.averagePerformance;
  return (
    <button
      type="button"
      onClick={() => onDrill(node)}
      className="card w-full text-left hover:border-accent-300 transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-bold text-[12.5px]">{node.name}</div>
          <div className="text-[10.5px] text-ink-muted">{node.tier} · {node.totalKpis} assigned KPIs</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
          <span className={`chip ${status.className}`}>{pct == null ? status.label : `${pct}% · ${status.label}`}</span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-sunken overflow-hidden mt-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%`, background: status.color }} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-muted mt-2">
        <span>{node.achieved} on track</span>
        <span>{node.approaching} at risk</span>
        <span>{node.offTrack} off track</span>
        <span>{node.missingActual} missing</span>
      </div>
      <span className="inline-block text-accent-600 font-semibold mt-2 text-[10.5px]">View this unit</span>
    </button>
  );
}
