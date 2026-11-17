// Data entry stays monthly everywhere (that's the real unit of truth — see
// Entry.jsx) — this is a separate, read-only "performance lens" used by
// Overview and Reports so progress can be reviewed at the cadence an M&E
// system actually reports at: quarterly, bi-annual, or annual, not just
// month by month. A quarter/half/year's "performance" is the latest actual
// value available within that range (the same as viewing a running
// scorecard as of today), fetched via GET /kpis/values-range.
import { effectiveKpiValue, officialKpiValueRow } from './scope.js';

export const PERIOD_TYPES = ['monthly', 'quarterly', 'biannual', 'annual'];
export const PERIOD_TYPE_LABEL = { monthly: 'Monthly', quarterly: 'Quarterly', biannual: 'Bi-annual', annual: 'Annual' };

export function quarterOf(month) { return Math.ceil(month / 3); }
export function halfOf(month) { return month > 6 ? 2 : 1; }

// idx means: month (1-12) for monthly, quarter (1-4) for quarterly,
// half (1-2) for biannual, ignored (always 1) for annual.
export function defaultIdx(type, month) {
  if (type === 'monthly') return month;
  if (type === 'quarterly') return quarterOf(month);
  if (type === 'biannual') return halfOf(month);
  return 1;
}

export function rangeFor(type, idx) {
  if (type === 'monthly') return [idx, idx];
  if (type === 'quarterly') return [(idx - 1) * 3 + 1, idx * 3];
  if (type === 'biannual') return [(idx - 1) * 6 + 1, idx * 6];
  return [1, 12];
}

export function labelFor(type, year, idx, monthNames) {
  if (type === 'monthly') return `${monthNames[idx]} ${year}`;
  if (type === 'quarterly') return `Q${idx} ${year}`;
  if (type === 'biannual') return `H${idx} ${year}`;
  return `${year} (Annual)`;
}

// Given every kpi_values row in range for one KPI, the "as of" row for the
// period — the latest CPU-approved month with an official value, so a
// quarter reports on approved results without including pending submissions.
export function latestInRange(rows) {
  let best = null;
  rows.forEach((r) => {
    const officialRow = officialKpiValueRow(r);
    if (!officialRow) return;
    const value = effectiveKpiValue(officialRow);
    if (value == null) return;
    if (!best || r.month > best.month) best = officialRow;
  });
  return best;
}
