import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import MonthlyPaceEditor from './MonthlyPaceEditor.jsx';
import { monthlyMilestoneDraft } from '../lib/reportingPeriods.js';

function milestoneCount(kpi) {
  try {
    return monthlyMilestoneDraft(kpi.reporting_periods).filter((value) => value !== '').length;
  } catch {
    return null;
  }
}

export default function KpiMilestoneSettings() {
  const { kpis } = useApp();
  const [search, setSearch] = useState('');
  const [editingKpi, setEditingKpi] = useState(null);
  const activeKpis = (kpis || []).filter((kpi) => !kpi.deleted_at && !kpi.removed_at);
  const filteredKpis = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return activeKpis;
    return activeKpis.filter((kpi) => [
      kpi.name, kpi.owner_name, kpi.owner_type, kpi.unit_name, kpi.subprogramme_name,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [activeKpis, search]);

  return (
    <section className="card mb-5" aria-labelledby="monthly-pace-settings-title">
      <div className="mb-3">
        <h2 id="monthly-pace-settings-title" className="text-[16px] font-bold text-ink">KPI monthly expected pace</h2>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-secondary">
          Configure each KPI’s expected monthly value here. A month left blank has no milestone and will not be
          included in that month’s expected-pace comparison.
        </p>
      </div>
      <label className="mb-3 block max-w-xl">
        <span className="field-label">Search KPIs</span>
        <input
          type="search"
          className="field-input mt-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by KPI or owner"
        />
      </label>
      {filteredKpis.length === 0 ? (
        <p className="rounded-lg bg-sunken px-3 py-5 text-center text-[12px] text-ink-muted">
          {activeKpis.length ? 'No KPIs match your search.' : 'No active KPIs are available to configure.'}
        </p>
      ) : (
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 z-10 border-b border-line bg-sunken">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold">KPI</th>
                <th scope="col" className="px-3 py-2 font-bold">Owner</th>
                <th scope="col" className="px-3 py-2 font-bold">Configured months</th>
                <th scope="col" className="px-3 py-2 font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredKpis.map((kpi) => {
                const count = milestoneCount(kpi);
                return (
                  <tr key={kpi.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-semibold">{kpi.name}</td>
                    <td className="px-3 py-2.5">{kpi.owner_name || kpi.owner_type || '—'}</td>
                    <td className="px-3 py-2.5">
                      {count == null ? <span className="text-critical">Invalid schedule</span> : count ? `${count} of 12` : 'No monthly milestones'}
                    </td>
                    <td className="px-3 py-2.5">
                      <button type="button" className="btn btn-sm" onClick={() => setEditingKpi(kpi)}>Configure</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editingKpi && <MonthlyPaceEditor kpi={editingKpi} onClose={() => setEditingKpi(null)} />}
    </section>
  );
}
