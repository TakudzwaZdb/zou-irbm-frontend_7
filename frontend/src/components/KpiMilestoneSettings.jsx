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
  const [open, setOpen] = useState(false);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="monthly-pace-settings-title" className="text-[16px] font-bold text-ink">KPI monthly expected pace</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-secondary">
            Set monthly milestones used to compare approved KPI results with expected progress. Blank months are excluded.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary flex-none"
          aria-expanded={open}
          aria-controls="monthly-pace-settings-panel"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Hide monthly pace settings' : 'Configure monthly expected pace'}
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold tabular-nums">
            {activeKpis.length} KPIs
          </span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </div>
      <div id="monthly-pace-settings-panel" className="mt-4" hidden={!open}>
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
            <table className="w-full min-w-[760px] table-fixed text-left text-[12px]">
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[26%]" />
                <col className="w-[22%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-line bg-sunken">
                <tr>
                  <th scope="col" className="px-3 py-2 font-bold">KPI</th>
                  <th scope="col" className="px-3 py-2 font-bold">Owner</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Configured months</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredKpis.map((kpi) => {
                  const count = milestoneCount(kpi);
                  return (
                    <tr key={kpi.id} className="border-b border-line align-middle last:border-0">
                      <td className="break-words px-3 py-2.5 font-semibold">{kpi.name}</td>
                      <td className="break-words px-3 py-2.5">{kpi.owner_name || kpi.owner_type || '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {count == null ? <span className="text-critical">Invalid schedule</span> : count ? `${count} of 12` : 'No monthly milestones'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button type="button" className="btn btn-sm" onClick={() => setEditingKpi(kpi)}>Configure</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editingKpi && <MonthlyPaceEditor kpi={editingKpi} onClose={() => setEditingKpi(null)} />}
    </section>
  );
}
