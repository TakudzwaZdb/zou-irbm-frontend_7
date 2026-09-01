import { ownerName } from '../lib/scope.js';
import { useApp } from '../context/AppContext.jsx';

// The real alert list a variance rollup drives: every KPI whose variance
// (actual progress % minus expected pace %) is -10 or worse — running 10+
// points behind where it should be by this point in the period. Nothing
// here is a separate judgement call from the chart above it; both read the
// same `items` from lib/scope.js's varianceRollup.
// Once this many KPIs are flagged, the list is capped to a fixed height and
// scrolls vertically instead of pushing the rest of the page down — added
// "if relevant" the same way the variance chart's own horizontal scroll
// only appears once it's actually needed; a short list is never capped or
// scrollable, unchanged from before.
const VERTICAL_SCROLL_THRESHOLD = 6;
const VISIBLE_ROW_HEIGHT = 44; // ~one alert row, used to size the scroll cap

export default function VarianceAlerts({ items, periodLabel }) {
  const { org } = useApp();
  const flagged = items.filter((i) => i.flag === 'attention');
  if (flagged.length === 0) return null;
  const scrollable = flagged.length > VERTICAL_SCROLL_THRESHOLD;

  return (
    <div className="mb-6 rounded-xl border border-critical/30 bg-critical-soft/40 px-4 py-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[14px]">⚠</span>
        <h3 className="font-display font-bold text-[13.5px] text-critical">
          {flagged.length} KPI{flagged.length > 1 ? 's' : ''} need{flagged.length === 1 ? 's' : ''} attention — {periodLabel}
        </h3>
      </div>
      <p className="text-[11.8px] text-ink-secondary mb-2.5">
        Running more than 10 points behind the pace expected by this point — actual progress vs. a straight-line
        path from baseline to target.
      </p>
      {scrollable && (
        <p className="text-[10.5px] text-ink-muted mb-1.5">↕ Scroll to see all {flagged.length}</p>
      )}
      <div
        className={`flex flex-col gap-1.5 ${scrollable ? 'overflow-y-auto pr-1' : ''}`}
        style={scrollable ? { maxHeight: VERTICAL_SCROLL_THRESHOLD * VISIBLE_ROW_HEIGHT } : undefined}
      >
        {flagged.map(({ kpi, actualPct, expectedPct, variance }) => (
          <div key={kpi.id} className="flex items-center gap-2.5 flex-wrap bg-surface rounded-lg px-3 py-2 text-[12.3px]">
            <span className="chip bg-critical text-white flex-none">{variance}pts</span>
            <span className="font-semibold">{kpi.name}</span>
            <span className="text-ink-muted">· {ownerName(org, kpi)}</span>
            <span className="ml-auto text-ink-secondary whitespace-nowrap">
              {actualPct}% actual vs {expectedPct}% expected
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
