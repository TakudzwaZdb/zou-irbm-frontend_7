import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { MONTHS } from '../lib/scope.js';

const STATUS_STYLE = {
  on_time: 'bg-good-soft text-good',
  due_soon: 'bg-sunken text-ink-secondary',
  late: 'bg-critical-soft text-critical',
  none: 'bg-sunken text-ink-muted',
};
const STATUS_LABEL = { on_time: 'On time', due_soon: 'Due soon', late: 'Late', none: 'No sub-level KPIs' };

// Two distinct, real concerns tracked separately, mirroring how Settings
// separates their triggers: a Sub-programme not reporting on time, and a KPI
// that IS reported on time but behind target for several periods running.
// Both are computed live from real submission timestamps and real values —
// see backend/src/routes/compliance.js — there is no simulated data here,
// only (as the label below says) no email/notification engine sending it.
export default function Compliance() {
  const { period } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    api(`/compliance?year=${period.year}&month=${period.month}`).then(setData).catch(() => setData(null));
  }, [period]);

  if (!data) return <div className="text-ink-muted text-[13px]">Loading…</div>;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Compliance &amp; Escalations</h1>
        <p className="text-[13px] text-ink-secondary max-w-[60ch]">
          Two distinct concerns, tracked separately: late submissions (a Sub-programme not reporting on time) and
          Red KPIs (a KPI reported on time but behind target). Both escalate up the org hierarchy.
        </p>
      </div>

      <h2 className="font-display font-bold text-[14.5px] mb-2.5">
        Late-submission compliance — {MONTHS[period.month]} {period.year}
      </h2>
      <div className="rounded-xl border border-line bg-surface overflow-x-auto mb-3">
        <table className="w-full text-[12.6px]">
          <thead>
            <tr className="bg-sunken text-[10.8px] uppercase tracking-wide text-ink-muted font-bold">
              <Th>Programme</Th><Th>Sub-programme</Th><Th>Sub-level KPIs</Th><Th>Status</Th><Th>Days late</Th>
            </tr>
          </thead>
          <tbody>
            {data.subs.map((s) => (
              <tr key={s.subId} className="border-t border-line">
                <Td>{s.programmeName}</Td>
                <Td className="font-semibold">{s.subName}</Td>
                <Td className="tabular-nums">{s.kpiCount}</Td>
                <Td><span className={`chip ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span></Td>
                <Td className="tabular-nums">{s.lateBy > 0 ? s.lateBy : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mb-2 mt-6">
        Late-submission escalation log <span className="font-normal text-ink-muted">(a real deployment would send these as emails)</span>
      </h2>
      {data.lateEscalations.length === 0
        ? <div className="card text-center text-ink-muted py-8">No overdue submissions right now — nothing to escalate.</div>
        : data.lateEscalations.map((e) => (
          <div key={e.subId} className="card mb-2 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-[13px] mb-0.5">{e.subName}</p>
              <p className="text-[12px] text-ink-secondary">{e.programmeName} · {e.lateBy} day{e.lateBy > 1 ? 's' : ''} late</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {e.chain.map((c) => <span key={c} className="chip chip-rag-red">{c}</span>)}
            </div>
          </div>
        ))}

      <h2 className="font-display font-bold text-[14.5px] mb-2.5 mt-8">
        Red-KPI performance escalation <span className="text-[11.8px] font-normal text-ink-muted">(a KPI behind target, separate from late submissions)</span>
      </h2>
      {data.redEscalations.length === 0
        ? <div className="card text-center text-ink-muted py-8">No KPI is currently escalated on performance — nothing to act on.</div>
        : data.redEscalations.map((e) => (
          <div key={e.kpiId} className="card mb-2 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-[13px] mb-0.5">{e.kpiName}</p>
              <p className="text-[12px] text-ink-secondary">{e.ownerName} · Red for {e.streak} consecutive period{e.streak > 1 ? 's' : ''}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {e.chain.map((c) => <span key={c} className="chip chip-rag-red">{c}</span>)}
            </div>
          </div>
        ))}

      {data.redKpis.length > 0 && (
        <p className="text-[11.5px] text-ink-muted mt-3">
          {data.redKpis.length} KPI{data.redKpis.length > 1 ? 's are' : ' is'} currently Red for at least one period;
          only those past a trigger in Settings are listed above as escalations.
        </p>
      )}
    </div>
  );
}

function Th({ children }) { return <th className="px-3 py-2.5 text-left">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2.5 ${className}`}>{children}</td>; }
