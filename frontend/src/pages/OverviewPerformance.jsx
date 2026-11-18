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
      <header className="sticky top-0 z-30 flex justify-between gap-4 flex-wrap items-start mb-5 rounded-xl border border-good/25 border-l-4 border-l-good bg-good-soft px-4 py-3.5 shadow-sm">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.12em] text-good mb-1">OVERVIEW / PERFORMANCE</p>
          <h1 className="font-display text-2xl font-extrabold text-good mb-0.5">Performance</h1>
          {summaryName && (
            <span aria-live="polite" className="inline-flex rounded-lg border border-good/30 bg-surface px-2.5 py-1 text-[12px] font-bold text-good">
              {summaryName}
            </span>
          )}
          <p className="text-[13px] text-ink-secondary">{user.title || user.role}</p>
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
