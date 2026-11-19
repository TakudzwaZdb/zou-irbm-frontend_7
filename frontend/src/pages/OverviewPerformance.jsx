import { useCallback, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import PerformanceAgainstTarget from '../components/PerformanceAgainstTarget.jsx';
import { GLOBAL_REPORT_ROLES } from '../lib/scope.js';

export default function OverviewPerformance() {
  const { user, hasPerm } = useApp();
  const [summaryName, setSummaryName] = useState('');
  const handleDataLoaded = useCallback((data) => {
    if (data?.summaryName) setSummaryName(data.summaryName);
  }, []);
  const allowed = !GLOBAL_REPORT_ROLES.includes(user.role) || hasPerm('view_institutional_performance');

  return (
    <div className="overview-page">
      <header className="flex justify-between gap-3 flex-wrap items-start mb-4 rounded-xl border border-accent-700/25 border-l-4 border-l-accent-700 bg-accent-50 px-3.5 py-2.5 shadow-sm">
        <div>
          <p className="text-[10px] font-extrabold tracking-[0.12em] text-accent-700 mb-0.5">OVERVIEW / PERFORMANCE</p>
          <h1 className="font-display text-xl font-extrabold text-accent-700 mb-0.5">Performance</h1>
          {summaryName && (
            <span aria-live="polite" className="inline-flex rounded-lg border border-accent-700/25 bg-surface px-2.5 py-0.5 text-[11.5px] font-bold text-accent-700">
              {summaryName}
            </span>
          )}
          <p className="text-[12px] text-ink-secondary">{user.title || user.role}</p>
        </div>
      </header>
      {allowed
        ? <PerformanceAgainstTarget syncSelectedNode onDataLoaded={handleDataLoaded} />
        : (
          <div role="alert" className="card text-[13px] text-ink-secondary">
            Institutional performance is not available to your account. Contact an administrator if you need access.
          </div>
        )}
    </div>
  );
}
