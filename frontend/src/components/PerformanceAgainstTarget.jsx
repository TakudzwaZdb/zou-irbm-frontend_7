import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { GLOBAL_REPORT_ROLES, MONTHS } from '../lib/scope.js';
import { PERIOD_TYPES, PERIOD_TYPE_LABEL } from '../lib/period.js';
import { configuredPaceForPeriod } from '../lib/configuredPace.js';
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
  const isOffTrack = status === 'below-target';
  const color = isOffTrack ? '#ff3333' : STATUS[status]?.color || STATUS.missing.color;
  const label = hasValue ? STATUS[status]?.label || 'Calculated' : 'Not available';
  const needleAngle = Math.PI + (progress / 100) * Math.PI;
  const needleX = 120 + 68 * Math.cos(needleAngle);
  const needleY = 135 + 68 * Math.sin(needleAngle);

  return (
    <div
      role="group"
      aria-label={`Average performance against target: ${hasValue ? `${numericValue}%` : 'not available'}, ${label}`}
      className="flex min-w-0 self-stretch flex-col items-center justify-between gap-5 rounded-2xl border-2 bg-surface px-5 py-5"
      style={{
        borderColor: `color-mix(in srgb, ${color} 68%, transparent)`,
        boxShadow: `0 8px 28px color-mix(in srgb, ${color} 20%, transparent)`,
      }}
    >
      <p className="text-center text-[13px] font-extrabold uppercase tracking-[0.12em] text-ink">Average performance against target</p>
      <div className="mt-1 font-display text-5xl font-extrabold leading-tight tabular-nums text-ink sm:text-6xl">
        {hasValue ? `${numericValue.toFixed(1)}%` : '—'}
      </div>
      <svg className="h-[230px] w-full max-w-[340px]" viewBox="0 0 240 170" aria-hidden="true">
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
        {hasValue && <line x1="120" y1="135" x2={needleX} y2={needleY} stroke="var(--color-ink)" strokeWidth="6" strokeLinecap="round" />}
        {hasValue && <circle cx="120" cy="135" r="8" fill="var(--color-ink)" />}
        <text x="50" y="122" textAnchor="middle" fill="#ff3333" fontSize="12" fontWeight="700">Off track</text>
        <text x="50" y="138" textAnchor="middle" fill="var(--color-ink)" fontSize="11" fontWeight="600">&lt;80%</text>
        <text x="120" y="67" textAnchor="middle" fill="var(--color-warning)" fontSize="12" fontWeight="700">At risk</text>
        <text x="120" y="83" textAnchor="middle" fill="var(--color-ink)" fontSize="11" fontWeight="600">80–&lt;100%</text>
        <text x="190" y="122" textAnchor="middle" fill="var(--color-good)" fontSize="12" fontWeight="700">On track</text>
        <text x="190" y="138" textAnchor="middle" fill="var(--color-ink)" fontSize="11" fontWeight="600">≥100%</text>
      </svg>
      <span
        className={`chip border px-4 py-1.5 text-[14px] font-extrabold shadow-sm ${hasValue ? STATUS[status]?.className || 'chip-rag-none' : 'chip-rag-none'} -mt-1`}
        style={isOffTrack ? { backgroundColor: '#260707', borderColor: color, color } : undefined}
      >
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

export default function PerformanceAgainstTarget({ eyebrow = 'OVERVIEW', onDataLoaded, syncSelectedNode = false, onNavigate }) {
  const { user, hasPerm, perfPeriod, perfValues, selNode, kpis: catalogKpis } = useApp();
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

  const paceResults = useMemo(() => configuredPaceForPeriod(
    data?.kpis || [],
    catalogKpis,
    reportType,
    reportIndex
  ), [data?.kpis, catalogKpis, reportType, reportIndex]);

  if (!allowed) return null;

  const summary = data?.summary;
  const kpiDetails = paceResults.kpis;
  const paceSummary = paceResults.summary;
  const ragCounts = kpiDetails.reduce((counts, kpi) => {
    const key = kpi.status === 'achieved' ? 'green'
      : kpi.status === 'approaching' ? 'amber'
        : ['missing', 'pending', 'returned', 'not-calculable'].includes(kpi.status) ? 'none' : 'red';
    counts[key] += 1;
    return counts;
  }, { green: 0, amber: 0, red: 0, none: 0 });
  const paceData = kpiDetails
    .filter((kpi) => kpi.performancePct != null && kpi.performanceExpectedPacePct != null)
    .map((kpi) => ({
      name: kpi.name,
      owner: kpi.ownerUnitName ? `${kpi.ownerName} · ${kpi.ownerUnitName}` : kpi.ownerName,
      ownerKind: kpi.ownerTier,
      actual: kpi.performancePct,
      expected: kpi.performanceExpectedPacePct,
      variance: kpi.paceVariancePct,
      flag: kpi.paceFlag,
    }));
  const behindPace = kpiDetails
    .filter((kpi) => kpi.paceFlag === 'behind' || kpi.paceFlag === 'attention')
    .sort((a, b) => b.paceVarianceRawPct - a.paceVarianceRawPct);
  const expectedPacePct = paceSummary.expectedPacePct ?? summary?.expectedPacePct ?? null;
  const comparedExpectedPace = paceSummary.averageComparedExpectedPacePct ?? summary?.averageComparedExpectedPacePct ?? null;
  const actualPerformancePct = paceSummary.averagePacePerformancePct ?? summary?.averagePacePerformancePct ?? null;
  const averagePaceVariance = paceSummary.averagePaceVariancePct ?? summary?.averagePaceVariancePct ?? null;
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
          <h2 id="performance-target-title" className="font-display font-extrabold text-[22px] leading-tight">
            Performance against target
          </h2>
          <p className="text-[12.5px] text-ink-secondary mt-1 max-w-2xl">
            Review approved KPI results, identify performance risks, and compare target performance with the expected pace.
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
              <ExpectedPaceCard
                expected={expectedPacePct}
                comparedExpected={comparedExpectedPace}
                actual={actualPerformancePct}
                variance={averagePaceVariance}
                behind={averagePaceVariance != null && averagePaceVariance > 0}
                behindCount={paceSummary.behindPaceCount ?? summary?.behindPaceCount ?? 0}
                notCalculableCount={paceSummary.notCalculablePaceCount ?? summary?.notCalculablePaceCount ?? 0}
                notConfiguredCount={paceSummary.notConfiguredPaceCount ?? summary?.notConfiguredPaceCount ?? 0}
                invalidScheduleCount={paceSummary.invalidScheduleCount ?? 0}
                monthlyFallbackCount={paceSummary.monthlyFallbackCount ?? 0}
                count={paceSummary.paceKpiCount ?? summary?.paceKpiCount ?? 0}
                periodLabel={periodLabel}
                canConfigure={hasPerm('manage_settings')}
                onConfigure={() => onNavigate?.('settings')}
              />
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

          <OrganisationUnitBreakdown
            data={data}
            childrenByParent={childrenByParent}
            tierFilter={tierFilter}
            onHome={() => { setOrgNodeFilter('all'); setTierFilter('all'); }}
            onDrill={(selected) => { setOrgNodeFilter(selected.key); setTierFilter('all'); }}
          />

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
              <h3 className="font-display font-bold text-[13px] mb-1">Variance analysis — performance vs. expected pace</h3>
              <p className="text-[10.5px] text-ink-muted mb-2">
                Compares each KPI’s target-performance percentage with the expected pace for this reporting period, using approved actuals.
              </p>
              <div className="rounded-lg bg-sunken/60 px-3 py-2 mb-2 flex flex-wrap justify-between gap-2 text-[11px]">
                <span>Expected pace − actual performance · {periodLabel}</span>
                <strong className={averagePaceVariance == null ? 'text-ink-muted' : averagePaceVariance >= 10 ? 'text-critical' : averagePaceVariance > 0 ? 'text-warning' : averagePaceVariance <= -10 ? 'text-good' : 'text-accent-600'}>
                  {averagePaceVariance == null ? '—' : `${averagePaceVariance > 0 ? '+' : ''}${averagePaceVariance} pts`}
                </strong>
              </div>
              <VarianceChart data={paceData} height={250} actualLabel="Actual performance" />
            </div>
          </div>

          <BehindPaceTable kpis={behindPace} periodLabel={periodLabel} />

          <KpiPerformanceTable kpis={kpiDetails} periodLabel={periodLabel} />

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
      <summary className="cursor-pointer rounded-lg border border-line bg-sunken/50 px-3 py-2.5 font-display font-bold text-[14px]">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>KPI performance detail</span>
          <span className="text-[11px] font-medium text-ink-muted">{kpis.length} KPIs · {periodLabel}</span>
        </span>
      </summary>
      <div className="mt-3 max-h-[65vh] overflow-auto rounded-xl border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[980px] text-[12px]">
          <caption className="sr-only">KPI target performance, expected pace, and performance variance for {periodLabel}</caption>
          <thead>
            <tr className="bg-sunken text-[10px] uppercase tracking-wide text-ink-secondary font-bold">
              <th className="px-3 py-2.5 text-left">KPI / owner</th>
              <th className="px-3 py-2.5 text-right">Actual value</th>
              <th className="px-3 py-2.5 text-right">Target value</th>
              <th className="px-3 py-2.5 text-right">Target performance</th>
              <th className="px-3 py-2.5 text-right">Expected pace</th>
              <th className="px-3 py-2.5 text-right">Pace variance (expected − actual)</th>
              <th className="px-3 py-2.5 text-right">Weight</th>
              <th className="px-3 py-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            <PaginatedRows items={kpis} colSpan={8} emptyMessage="No KPIs are assigned in this scope." renderRow={(kpi) => {
              const status = STATUS[kpi.status] || STATUS.missing;
              const rowClass = kpi.paceFlag === 'attention' || kpi.status === 'below-target'
                ? 'bg-critical-soft/35'
                : kpi.paceFlag === 'behind' || kpi.status === 'approaching' ? 'bg-warning-soft/35' : '';
              const paceClass = kpi.paceFlag === 'attention' ? 'text-critical font-bold'
                : kpi.paceFlag === 'behind' ? 'text-warning font-semibold'
                  : kpi.paceFlag === 'ahead' ? 'text-good font-semibold' : 'text-ink-secondary';
              return (
                <tr key={kpi.id} className={`border-t border-line ${rowClass}`}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{kpi.name}</div>
                    <div className="text-[10.5px] text-ink-muted">{kpi.ownerTier} · {kpi.ownerName}{kpi.ownerUnitName ? ` · ${kpi.ownerUnitName}` : ''}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.actual == null ? '—' : `${kpi.actual}${kpi.measure ? ` ${kpi.measure}` : ''}`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.target == null ? '—' : `${kpi.target}${kpi.measure ? ` ${kpi.measure}` : ''}`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.performancePct == null ? '—' : `${kpi.performancePct}%`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.performanceExpectedPacePct == null ? '—' : `${kpi.performanceExpectedPacePct}%`}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${paceClass}`}>{kpi.paceVariancePct == null ? '—' : `${kpi.paceVariancePct > 0 ? '+' : ''}${kpi.paceVariancePct} pp`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{kpi.weight}</td>
                  <td className="px-3 py-2.5"><span className={`chip ${status.className}`}>{status.label}</span></td>
                </tr>
              );
            }} />
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] text-ink-muted mt-2">
        Expected pace is calculated from each KPI’s configured reporting milestone using its own target-performance rule. Pace variance is expected performance minus actual performance; a positive value means the KPI is behind pace. KPIs without a matching milestone have no pace or variance.
      </p>
    </details>
  );
}

function BehindPaceTable({ kpis, periodLabel }) {
  return (
    <section className="card mb-5" aria-labelledby="behind-pace-title">
      <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
        <div>
          <h3 id="behind-pace-title" className="font-display font-bold text-[13px]">KPIs behind expected pace</h3>
          <p className="text-[10.5px] text-ink-muted mt-0.5">
            Approved actuals with target performance below the expected pace for {periodLabel}, ordered by largest gap.
          </p>
        </div>
        <span className="chip chip-rag-red text-[10px]">{kpis.length} behind pace</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[11.5px]">
          <caption className="sr-only">Approved KPI actuals with target performance below expected pace for {periodLabel}</caption>
          <thead>
            <tr className="bg-sunken text-[9.5px] uppercase tracking-wide text-ink-secondary font-bold">
              <th className="px-3 py-2.5 text-left">KPI / owner</th>
              <th className="px-3 py-2.5 text-right">Approved actual</th>
              <th className="px-3 py-2.5 text-right">Scoring target</th>
              <th className="px-3 py-2.5 text-right">Actual performance</th>
              <th className="px-3 py-2.5 text-right">Expected pace</th>
              <th className="px-3 py-2.5 text-right">Expected − actual</th>
              <th className="px-3 py-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            <PaginatedRows items={kpis} colSpan={7} emptyMessage="No approved KPIs are behind expected pace for this period." renderRow={(kpi) => (
              <tr key={kpi.id} className={`border-t border-line ${kpi.paceFlag === 'attention' ? 'bg-critical-soft/35' : 'bg-warning-soft/35'}`}>
                <td className="px-3 py-2.5">
                  <div className="font-semibold">{kpi.name}</div>
                  <div className="text-[10px] text-ink-muted">{kpi.ownerTier} · {kpi.ownerName}{kpi.ownerUnitName ? ` · ${kpi.ownerUnitName}` : ''}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {kpi.actual == null ? '—' : `${Number(kpi.actual).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${kpi.measure}`}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {kpi.target == null ? '—' : `${Number(kpi.target).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${kpi.measure}`}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{kpi.performancePct == null ? '—' : `${kpi.performancePct}%`}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{kpi.performanceExpectedPacePct == null ? '—' : `${kpi.performanceExpectedPacePct}%`}</td>
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
  const rootNode = data.nodes.find((node) => node.key === data.rootKey) || nodesByKey.get(data.rootKey);
  const rootTier = rootNode?.tier || scopeRoot?.tier || 'Organisational tier';
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

  function drillTo(node) {
    onDrill(node);
    requestAnimationFrame(() => {
      document.getElementById('performance-target-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <section
      id="performance-tier-overview"
      className="card mt-5 scroll-mt-4"
      aria-labelledby="organisational-unit-breakdown-title"
    >
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
              : <button type="button" className="hover:text-accent-500 hover:underline" onClick={() => drillTo(node)}>{node.name}</button>}
          </span>
        ))}
        {path.length === 1 && scopeRoot?.kind !== 'university' && (
          <span className="flex items-center gap-1.5"><span>/</span><b className="text-ink-secondary">{scopeRoot.name}</b></span>
        )}
      </div>

      <div className="flex justify-between gap-3 flex-wrap items-start mb-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-accent-600">Selected tier overview</p>
          <h3 id="organisational-unit-breakdown-title" className="mt-0.5 font-display text-[20px] font-extrabold text-ink">
            {data.summaryName || rootNode?.name || 'Selected scope'}
          </h3>
          <p className="text-[11.5px] text-ink-secondary mt-0.5">
            {rootTier} · {periodLabelFor(data)} · approved KPI results across this reporting scope.
          </p>
        </div>
        <span className="chip border border-accent-500/20 bg-accent-50 text-accent-700">
          {data.summary.totalKpis} assigned KPIs
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <TierOverviewMetric
          label="Average performance"
          value={data.summary.averagePerformance == null ? '—' : `${data.summary.averagePerformance}%`}
          className="text-accent-700"
        />
        <TierOverviewMetric label="On track" value={data.summary.achieved} className="text-good" />
        <TierOverviewMetric label="At risk" value={data.summary.approaching} className="text-warning" />
        <TierOverviewMetric label="Off track" value={data.summary.offTrack} className="text-critical" />
        <TierOverviewMetric label="Missing actual" value={data.summary.missingActual} className="text-ink-muted" />
      </div>

      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display font-bold text-[13px]">{heading}</h4>
        <span className="text-[10.5px] text-ink-muted">Select a tier card to open its overview and next tier.</span>
      </div>
      {children.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {children.map((node) => <PerformanceNodeCard key={node.key} node={node} onDrill={drillTo} />)}
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-muted py-5 text-center">
          {tierFilter === 'all' ? 'No subordinate organisational units are available at this level.' : 'No organisational units match this tier and scope.'}
        </p>
      )}
    </section>
  );
}

function periodLabelFor(data) {
  const type = data.periodType || 'monthly';
  const label = PERIOD_TYPE_LABEL[type] || type;
  const index = periodOption(type, data.periodIndex || 1);
  return `${label} · ${index} ${data.cycleYear || '—'}`;
}

function TierOverviewMetric({ label, value, className = '' }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-sunken/50 px-3 py-2.5">
      <div className="truncate text-[9.5px] font-bold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-0.5 font-display text-[20px] font-extrabold leading-tight tabular-nums ${className}`}>{value}</div>
    </div>
  );
}

function ExpectedPaceCard({ expected, comparedExpected, actual, variance, behind, behindCount, notCalculableCount, notConfiguredCount, invalidScheduleCount, monthlyFallbackCount, count, periodLabel, canConfigure, onConfigure }) {
  const paceAlert = behind || behindCount > 0;
  const cardTone = paceAlert
    ? 'border-critical/40 bg-critical-soft/60'
    : 'border-accent-500/35 bg-gradient-to-br from-accent-50 via-surface to-accent-50/70';
  const statusTone = paceAlert
    ? 'border-critical/40 bg-surface'
    : 'border-accent-500/30 bg-surface';
  const status = variance == null
    ? invalidScheduleCount > 0 ? 'Review invalid KPI reporting schedules'
      : expected == null && notConfiguredCount > 0 ? 'No KPI reporting milestones configured'
      : notCalculableCount > 0 ? 'Approved actuals cannot be compared'
      : expected == null ? 'No pace data available' : 'Awaiting approved actuals'
    : behind ? 'Overall behind expected pace'
      : behindCount > 0 ? `${behindCount} KPIs behind expected pace`
        : variance < 0 ? 'Overall ahead of expected pace' : 'Overall on expected pace';
  const statusColor = paceAlert ? 'text-critical' : variance == null ? 'text-ink-secondary' : 'text-good';
  const varianceLabel = variance == null
    ? expected == null && notConfiguredCount > 0 ? 'No KPI reporting milestones are configured for this period'
      : notCalculableCount > 0 ? 'Approved actuals cannot be compared with pace' : expected == null ? 'No pace data available' : 'Awaiting approved actuals'
    : Math.abs(variance) < 0.1 ? 'Expected pace and actual performance are within 0.1 pts'
      : `Expected pace (${comparedExpected == null ? '—' : `${comparedExpected.toFixed(1)}%`}) − actual performance (${actual == null ? '—' : `${actual.toFixed(1)}%`}) = ${variance > 0 ? '+' : ''}${variance} pts`;
  return (
    <section
      className={`mb-4 overflow-hidden rounded-2xl border-2 px-4 py-4 shadow-sm sm:px-6 sm:py-5 ${cardTone} ${paceAlert ? 'pace-alert-pulse' : ''}`}
      aria-label={`KPI expected pace for ${periodLabel}`}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] md:items-center md:gap-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <div className={`h-16 w-1.5 flex-none rounded-full sm:h-20 ${paceAlert ? 'bg-critical' : 'bg-accent-500'}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-accent-700">
              Expected pace · {periodLabel}
            </p>
            <div className={`mt-1 font-display text-5xl font-extrabold leading-none tracking-tight tabular-nums sm:text-6xl lg:text-7xl ${paceAlert ? 'text-critical' : 'text-accent-700'}`}>
              {expected == null ? '—' : `${expected}%`}
            </div>
            <p className="mt-2 text-[14px] font-semibold leading-snug text-ink">
              KPI performance expected by this reporting period
            </p>
          </div>
        </div>
        <div className={`min-w-0 rounded-xl border-2 p-4 ${statusTone}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-ink">Current assessment</span>
            <span className={`chip border px-3 py-1.5 text-[14px] font-extrabold shadow-sm ${paceAlert ? 'chip-rag-red border-critical/40' : variance == null ? 'chip-rag-none border-line' : 'chip-rag-green border-good/40'}`}>
              {paceAlert ? 'Attention' : variance == null ? 'Pending' : 'On pace'}
            </span>
          </div>
          <p className={`mt-2 font-display text-[19px] font-extrabold leading-snug sm:text-[21px] ${statusColor}`} role={paceAlert ? 'alert' : undefined}>
            {paceAlert && <span aria-hidden="true">⚠ </span>}{status}
          </p>
          <p className="mt-2 text-[14px] font-semibold leading-relaxed text-ink">{varianceLabel}</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {count > 0 && (
              <span className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-bold text-ink shadow-sm">
                {count} KPI{count === 1 ? '' : 's'} compared
              </span>
            )}
            {notConfiguredCount > 0 && (
              <span className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-bold text-ink shadow-sm">
                {notConfiguredCount} without a milestone
              </span>
            )}
          </div>
          {expected == null && notConfiguredCount > 0 && canConfigure && onConfigure && (
            <button type="button" className="btn btn-sm mt-4 px-4 py-2.5 text-[13px] font-bold" onClick={onConfigure}>
              Configure milestones in Settings
            </button>
          )}
        </div>
      </div>
      {(monthlyFallbackCount > 0 || invalidScheduleCount > 0) && (
        <div className={`mt-4 border-t pt-3 text-[13px] font-semibold leading-relaxed ${paceAlert ? 'border-critical/30' : 'border-accent-500/30'}`}>
          {monthlyFallbackCount > 0 && (
            <p className="text-ink">
              Using the month-end monthly milestone for {monthlyFallbackCount} KPI{monthlyFallbackCount === 1 ? '' : 's'} without a matching period milestone.
            </p>
          )}
          {invalidScheduleCount > 0 && (
            <p className="mt-1 font-bold text-critical">
              {invalidScheduleCount} KPI reporting schedule{invalidScheduleCount === 1 ? ' is' : 's are'} invalid and cannot be used.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function PerformanceNodeCard({ node, onDrill }) {
  const status = STATUS[node.status] || STATUS.missing;
  const pct = node.averagePerformance;
  const expectedPace = node.expectedPacePct;
  const paceVariance = node.averageComparedExpectedPacePct == null || node.averagePacePerformancePct == null
    ? null
    : Math.round((node.averageComparedExpectedPacePct - node.averagePacePerformancePct) * 10) / 10;
  const behindPace = node.isBehindPace === true;
  const paceAlert = behindPace || node.behindPaceCount > 0;
  return (
    <button
      type="button"
      onClick={() => onDrill(node)}
      aria-label={`Open ${node.tier.toLowerCase()} overview: ${node.name}`}
      className="card w-full text-left hover:border-accent-300 hover:shadow-md transition-all"
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
      <div className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 mt-2 ${paceAlert ? 'bg-critical-soft pace-alert-pulse' : 'bg-sunken'}`}>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-ink-muted">Tier expected pace</div>
          <div className={`font-display text-[20px] leading-tight font-extrabold ${paceAlert ? 'text-critical' : 'text-accent-700'}`}>
            {expectedPace == null ? '—' : `${expectedPace}%`}
          </div>
        </div>
        <div className={`text-right text-[10px] font-bold ${paceAlert ? 'text-critical' : paceVariance == null ? 'text-ink-muted' : 'text-good'}`}>
          <div role={paceAlert ? 'alert' : undefined}>
            {behindPace ? 'Overall behind pace'
              : node.behindPaceCount > 0 ? `${node.behindPaceCount} KPIs behind pace`
                : paceVariance == null
                ? node.notCalculablePaceCount > 0 ? 'Actuals not comparable'
                  : expectedPace == null && node.notConfiguredPaceCount > 0 ? 'No KPI milestones configured'
                    : expectedPace == null ? 'No pace data' : 'Awaiting approved actual'
                : paceVariance < 0 ? 'On / ahead of pace' : 'On expected pace'}
          </div>
          {paceVariance != null && (
            <div className="mt-0.5">
              {behindPace && Math.abs(paceVariance) < 0.1
                ? '<0.1 pts below pace'
                : `${paceVariance > 0 ? '+' : ''}${paceVariance} pts`}
              {' · '}{node.paceKpiCount} compared
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-muted mt-2">
        <span>{node.achieved} on track</span>
        <span>{node.approaching} at risk</span>
        <span>{node.offTrack} off track</span>
        <span>{node.missingActual} missing</span>
      </div>
      <span className="inline-block text-accent-600 font-semibold mt-2 text-[10.5px]">Open {node.tier} overview</span>
    </button>
  );
}
