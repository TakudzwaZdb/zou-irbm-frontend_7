import { useApp } from '../context/AppContext.jsx';
import { MONTHS, yearRange } from '../lib/scope.js';

export default function PeriodPicker() {
  const { period, changePeriod } = useApp();
  const years = yearRange(period.year - 1);
  return (
    <div className="flex gap-2">
      <select
        className="field-input py-1.5 w-auto"
        value={period.month}
        onChange={(e) => changePeriod({ ...period, month: Number(e.target.value) })}
      >
        {MONTHS.slice(1).map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
      </select>
      <select
        className="field-input py-1.5 w-auto"
        value={period.year}
        onChange={(e) => changePeriod({ ...period, year: Number(e.target.value) })}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
