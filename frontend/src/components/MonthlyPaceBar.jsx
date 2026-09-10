import { useMemo } from 'react';
import { MONTHS, expectedValueForMonth, assumedMonthlyBaseline, monthlyPace, roundMeasure, automatedPeriodTargets } from '../lib/scope.js';
import Fig from './Fig.jsx';

export default function MonthlyPaceBar({ kpi, valueRow, period, isPreview = false }) {
  // Parse targets safely to ensure calculations don't hit NaN boundaries
  const base = useMemo(() => Number(kpi.baseline) || 0, [kpi.baseline]);
  const tgt = useMemo(() => Number(kpi.target) || 0, [kpi.target]);
  
  const span = tgt - base;
  const pctOf = (v) => (span === 0 ? 100 : Math.max(0, Math.min(100, ((v - base) / span) * 100)));

  const expected = expectedValueForMonth(kpi, period.month);
  const assumedBaseline = assumedMonthlyBaseline(kpi, period.month);
  const pace = monthlyPace(kpi, valueRow);
  const monthLabel = MONTHS[period.month];
  const { quarter, half, quarterTarget, halfTarget } = automatedPeriodTargets(kpi, period.month);

  return (
    <div className="mt-3.5 pt-3.5 border-t border-line-strong">
      {/* Header Segment */}
      <div className="flex justify-between items-center gap-2 flex-wrap mb-2">
        <span className="field-label">Automated monthly pace — {monthLabel} {period.year}</span>
        {pace && (
          <span className={`chip ${pace.onPaceForMonth ? 'chip-rag-green' : 'chip-rag-red'}`}>
            {pace.onPaceForMonth ? 'On pace this month' : 'Behind pace this month'}{isPreview ? ' (projected)' : ''}
          </span>
        )}
      </div>

      {/* Progress Track: Layer order changed to keep structural markers visible */}
      <div className="relative h-3.5 rounded-full bg-surface border border-line overflow-hidden">
        {/* Layer 1: Expected Pace Background Box */}
        <div className="absolute inset-y-0 left-0 bg-accent-100" style={{ width: `${pctOf(expected)}%` }} />
        
        {/* Layer 2: Actual Performance Bar */}
        {pace && (
          <div className="absolute inset-y-0 left-0 bg-accent-500 rounded-full" style={{ width: `${pctOf(pace.actual)}%` }} />
        )}
        
        {/* Layer 3: Assumed Monthly Baseline Tick (Placed on top so it never gets covered) */}
        <div 
          className="absolute inset-y-0 w-[3px] bg-ink-secondary z-10" 
          style={{ left: `${pctOf(assumedBaseline)}%` }} 
          title={`Assumed baseline for ${monthLabel}: ${roundMeasure(assumedBaseline)} ${kpi.measure}`} 
        />
      </div>

      {/* Track Caps labels */}
      <div className="flex justify-between text-[10.5px] text-ink-muted font-semibold mt-1">
        <span>Baseline {roundMeasure(base)}</span>
        <span>Target {roundMeasure(tgt)} {kpi.measure}</span>
      </div>

      {/* Legend Indicators */}
      <div className="flex gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] text-ink-muted items-center">
        <LegendSwatch cls="bg-accent-100" label="Expected pace" />
        {pace && <LegendSwatch cls="bg-accent-500" label="Actual" />}
        <LegendSwatch cls="bg-ink-secondary" label="Assumed baseline" isTick={true} />
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 mt-3.5">
        <Fig k="Assumed baseline" v={`${roundMeasure(assumedBaseline)} ${kpi.measure}`} />
        <Fig k={`Expected by ${monthLabel}`} v={`${roundMeasure(expected)} ${kpi.measure}`} />
        <Fig k="Annual target" v={`${tgt} ${kpi.measure}`} />
      </div>

      {/* Automated Milestone Implied Targets */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-line">
        <Fig k={`Automated Q${quarter} target`} v={`${quarterTarget} ${kpi.measure}`} />
        <Fig k={`Automated H${half} target`} v={`${halfTarget} ${kpi.measure}`} />
      </div>

      {/* Dynamic Context Status Footer */}
      {pace && (
        <div className={`mt-3 rounded-lg px-3 py-2.5 text-[12.5px] font-semibold ${pace.onPaceForMonth ? 'bg-good-soft text-good' : 'bg-critical-soft text-critical'}`}>
          {isPreview ? 'Projected, if approved' : 'This month so far'}: {pace.actualMonthlyDelta >= 0 ? '+' : ''}{pace.actualMonthlyDelta} {kpi.measure}
          <span className="font-normal opacity-80"> (expected {pace.expectedMonthlyDelta >= 0 ? '+' : ''}{pace.expectedMonthlyDelta} {kpi.measure})</span>
        </div>
      )}
      {!pace && (
        <p className="mt-2.5 text-[11px] text-ink-muted">No value recorded yet this month — the pace above shows where it's automatically expected to be.</p>
      )}
    </div>
  );
}

// Clean helper presentation component with normalized style variables
function LegendSwatch({ cls, label, isTick = false }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block rounded-sm ${cls} ${isTick ? 'w-[3px] h-2.5' : 'w-2.5 h-2.5'}`} />
      {label}
    </span>
  );
}
