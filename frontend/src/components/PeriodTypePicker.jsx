import { useApp } from '../context/AppContext.jsx';
import { PERIOD_TYPES, PERIOD_TYPE_LABEL, defaultIdx } from '../lib/period.js';
import { MONTHS, currentPeriod, yearRange } from '../lib/scope.js';

// The read-only performance lens (see lib/period.js) — lets Reports/Overview
// be reviewed monthly, quarterly, bi-annually, or annually without touching
// the monthly data-entry period used everywhere else in the app.
export default function PeriodTypePicker() {
  const { perfPeriod, changePerfPeriod } = useApp();
  const now = currentPeriod();

  function setType(type) {
    changePerfPeriod({ type, year: perfPeriod.year, idx: defaultIdx(type, now.month) });
  }
  function setIdx(idx) {
    changePerfPeriod({ ...perfPeriod, idx: Number(idx) });
  }
  function setYear(year) {
    changePerfPeriod({ ...perfPeriod, year: Number(year) });
  }

  const years = yearRange(now.year - 1);

  return (
    <div className="flex gap-2 flex-wrap items-center">
      <select className="field-input py-1.5 w-auto" aria-label="Period type" value={perfPeriod.type} onChange={(e) => setType(e.target.value)}>
        {PERIOD_TYPES.map((t) => <option key={t} value={t}>{PERIOD_TYPE_LABEL[t]}</option>)}
      </select>
      {perfPeriod.type === 'monthly' && (
        <select className="field-input py-1.5 w-auto" aria-label="Month" value={perfPeriod.idx} onChange={(e) => setIdx(e.target.value)}>
          {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
      )}
      {perfPeriod.type === 'quarterly' && (
        <select className="field-input py-1.5 w-auto" aria-label="Quarter" value={perfPeriod.idx} onChange={(e) => setIdx(e.target.value)}>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
        </select>
      )}
      {perfPeriod.type === 'biannual' && (
        <select className="field-input py-1.5 w-auto" aria-label="Half-year" value={perfPeriod.idx} onChange={(e) => setIdx(e.target.value)}>
          {[1, 2].map((h) => <option key={h} value={h}>H{h}</option>)}
        </select>
      )}
      <select className="field-input py-1.5 w-auto" aria-label="Year" value={perfPeriod.year} onChange={(e) => setYear(e.target.value)}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
