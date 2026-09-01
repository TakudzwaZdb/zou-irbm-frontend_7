import { MONTHS, expectedValueForMonth, assumedMonthlyBaseline, monthlyPace, roundMeasure, automatedPeriodTargets } from '../lib/scope.js';
import Fig from './Fig.jsx';

// The automated monthly pace picture — see lib/scope.js's
// expectedValueForMonth/assumedMonthlyBaseline/monthlyPace, which is all
// this reads from; nothing here is computed independently. Baseline and
// Target are the KPI's fixed annual figures (labeled directly on the bar's
// own two ends here, so it reads on its own without having to look back up
// at a separate Baseline/Target figure elsewhere on the card); this adds
// the two numbers that move month to month without anyone typing them in:
// where a straight-line pace toward the annual target says this KPI should
// be BY this month ("Expected by <month>"), and the assumed baseline it's
// judged from — the same pace's position at the end of LAST month — so the
// gap between the two is what this one month itself was expected to
// contribute, not the whole year's climb from January.
//
// Shared by KpiCard (an owner's own KPI) and ContributionCard (what a
// contributor sees for the shared KPI's overall pace) — same component,
// same math, so a Unit Head and their team never look at two different
// pictures of the same KPI's pace.
export default function MonthlyPaceBar({ kpi, valueRow, period, isPreview = false }) {
  const base = Number(kpi.baseline), tgt = Number(kpi.target);
  const span = tgt - base;
  const pctOf = (v) => (span === 0 ? 100 : Math.max(0, Math.min(100, ((v - base) / span) * 100)));
  const expected = expectedValueForMonth(kpi, period.month);
  const assumedBaseline = assumedMonthlyBaseline(kpi, period.month);
  const pace = monthlyPace(kpi, valueRow);
  const monthLabel = MONTHS[period.month];
  const { quarter, half, quarterTarget, halfTarget } = automatedPeriodTargets(kpi, period.month);

  return (
    <div className="mt-3.5 pt-3.5 border-t border-line-strong">
      <div className="flex justify-between items-center gap-2 flex-wrap mb-2">
        <span className="field-label">Automated monthly pace — {monthLabel} {period.year}</span>
        {pace && (
          <span className={`chip ${pace.onPaceForMonth ? 'chip-rag-green' : 'chip-rag-red'}`}>
            {pace.onPaceForMonth ? 'On pace this month' : 'Behind pace this month'}{isPreview ? ' (projected)' : ''}
          </span>
        )}
      </div>

      <div className="relative h-3.5 rounded-full bg-surface border border-line overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-accent-100" style={{ width: `${pctOf(expected)}%` }} />
        <div className="absolute inset-y-0 w-[3px] bg-ink-secondary" style={{ left: `${pctOf(assumedBaseline)}%` }} title={`Assumed baseline for ${monthLabel}: ${roundMeasure(assumedBaseline)} ${kpi.measure}`} />
        {pace && <div className="absolute inset-y-0 left-0 bg-accent-500 rounded-full" style={{ width: `${pctOf(pace.actual)}%` }} />}
      </div>
      <div className="flex justify-between text-[10.5px] text-ink-muted font-semibold mt-1">
        <span>Baseline {roundMeasure(base)}</span>
        <span>Target {roundMeasure(tgt)} {kpi.measure}</span>
      </div>

      <div className="flex gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] text-ink-muted items-center">
        <LegendSwatch cls="bg-accent-100" label="Expected pace" />
        {pace && <LegendSwatch cls="bg-accent-500" label="Actual" />}
        <LegendSwatch cls="bg-ink-secondary w-[3px]!" label="Assumed baseline" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 mt-3.5">
        <Fig k="Assumed baseline" v={`${roundMeasure(assumedBaseline)} ${kpi.measure}`} />
        <Fig k={`Expected by ${monthLabel}`} v={`${roundMeasure(expected)} ${kpi.measure}`} />
        <Fig k="Annual target" v={`${tgt} ${kpi.measure}`} />
      </div>

      {/* Automated quarterly/bi-annual targets — the same straight-line
          baseline -> annual-target pace above, just read off at the end of
          this month's own quarter/half instead of the whole year. Nobody
          sets these separately; they're implied by the KPI's own
          baseline/target and recomputed every render, so they can never
          drift from the annual figure they're derived from. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-line">
        <Fig k={`Automated Q${quarter} target`} v={`${quarterTarget} ${kpi.measure}`} />
        <Fig k={`Automated H${half} target`} v={`${halfTarget} ${kpi.measure}`} />
      </div>

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

function LegendSwatch({ cls, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}
