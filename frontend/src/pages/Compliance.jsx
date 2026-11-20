import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { MONTHS } from '../lib/scope.js';
import { complianceFilterParams } from '../lib/complianceFilters.js';
import PaginatedRows from '../components/PaginatedRows.jsx';
import PeriodPicker from '../components/PeriodPicker.jsx';

const STATUS_STYLE = {
  on_time: 'bg-good-soft text-good',
  due_soon: 'bg-sunken text-ink-secondary',
  late: 'bg-critical-soft text-critical',
  none: 'bg-sunken text-ink-muted',
};
const STATUS_LABEL = { on_time: 'On time', due_soon: 'Due soon', late: 'Late', none: 'No sub-level KPIs' };
const USER_DESIGNATION = {
  cpu: 'Corporate Planning Unit reviewer',
  vc: 'Vice-Chancellor',
  exec: 'Executive reviewer',
  rep: 'Sub-programme representative',
  unithead: 'Department / Unit Head',
  programme: 'Programme Head',
  ictadmin: 'ICT Systems Administrator',
  council: 'University Council reviewer',
};

// Durable performance-alert workflows are layered beside, not substituted
// for, the existing live submission-compliance calculations.
export default function Compliance() {
  const { period, hasPerm, org, user } = useApp();
  const [data, setData] = useState(null);
  const [alertData, setAlertData] = useState(null);
  const [error, setError] = useState(null);
  const [alertError, setAlertError] = useState(null);
  const [orgFilter, setOrgFilter] = useState('');
  const [retry, setRetry] = useState(0);

  const orgFilterOptions = [
    ...org.programmes.map((item) => ({ ...item, filterType: 'programme', group: 'Programmes', label: item.name })),
    ...org.subs.map((item) => ({
      ...item,
      filterType: 'sub',
      group: 'Sub-programmes',
      label: `${item.name} · ${org.programmes.find((programme) => programme.id === item.programme_id)?.name || 'Programme'}`,
    })),
    ...org.units.map((item) => ({
      ...item,
      filterType: 'unit',
      group: 'Departments, faculties and units',
      label: `${item.kind || 'Unit'}: ${item.name} · ${org.subs.find((sub) => sub.id === item.sub_id)?.name || 'Sub-programme'}`,
    })),
    ...org.employees.map((item) => ({
      ...item,
      filterType: 'employee',
      group: 'Employees',
      label: `${item.role_title || 'Employee'}: ${item.name} · ${org.units.find((unit) => unit.id === item.unit_id)?.name || 'Unit'}`,
    })),
  ];

  useEffect(() => {
    let active = true;
    setData(null);
    setAlertData(null);
    setError(null);
    setAlertError(null);
    const params = complianceFilterParams(period, orgFilter);
    api(`/compliance?${params}`)
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message || 'Unable to load compliance results.'); });
    api(`/performance-alerts?${params}`)
      .then((result) => { if (active) setAlertData(result); })
      .catch((err) => { if (active) setAlertError(err.message || 'Unable to load progress pace alerts.'); });
    return () => { active = false; };
  }, [period.year, period.month, orgFilter, retry]);

  function refreshWorkflowData() {
    setRetry((value) => value + 1);
    window.dispatchEvent(new Event('zou:performance-notifications-updated'));
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-extrabold tracking-[0.12em] text-accent-600 mb-1">INSTITUTIONAL OVERSIGHT</p>
          <h1 className="text-xl font-bold mb-0.5">Compliance &amp; Escalations</h1>
          <p className="text-[13px] text-ink-secondary max-w-[72ch]">
            A single reporting workspace for progress pace, target performance, and submission compliance.
            Each measure remains distinct while sharing the same reporting period and organisation scope.
          </p>
        </div>
        <PeriodPicker />
      </div>

      <OrganisationFilter
        label="Reporting scope"
        value={orgFilter}
        options={orgFilterOptions}
        onChange={setOrgFilter}
        help="Both sections share this period and scope. Unit and Employee selections show submission compliance at the owning Sub-programme; performance escalation excludes employee-owned KPIs."
      />

      <section aria-label="Progress and performance pace and submission alerts" className="mb-7">
        {alertError
          ? <>
            <div role="alert" className="card border-l-4 border-l-critical text-[12.5px] text-critical">
              <p className="mb-2">{alertError}</p>
              <button type="button" className="btn btn-sm" onClick={() => setRetry((value) => value + 1)}>Retry alerts</button>
            </div>
            {data && <TargetPerformanceIndicators data={data} />}
          </>
          : alertData
            ? <PerformanceWorkflow
              data={alertData}
              targetPerformanceData={data}
              canManage={hasPerm('manage_performance_alerts')}
              canManageActions={hasPerm('manage_corrective_actions')}
              canApproveActions={hasPerm('approve_corrective_actions')}
              currentUserId={user.id}
              onRefresh={refreshWorkflowData}
            />
            : <>
              <div role="status" className="card text-[13px] text-ink-muted">Loading progress pace alerts…</div>
              {data && <TargetPerformanceIndicators data={data} />}
            </>}
      </section>

      {error
        ? <div role="alert" className="card max-w-xl border-l-4 border-l-critical">
          <p className="font-semibold mb-1">Compliance and performance escalation data could not be loaded</p>
          <p className="text-[13px] text-ink-secondary mb-3">{error}</p>
          <button type="button" className="btn btn-sm" onClick={() => setRetry((value) => value + 1)}>Retry data</button>
        </div>
        : !data
          ? <div role="status" className="card text-ink-muted text-[13px]">Loading compliance and performance escalation data…</div>
          : <>
      <h2 className="font-display font-bold text-[14.5px] mb-2.5">
        Late-submission compliance — {MONTHS[period.month]} {period.year}
      </h2>
      <div className="rounded-xl border border-line bg-surface overflow-x-auto max-h-[65vh] overflow-y-auto mb-3">
        <table className="w-full text-[12.6px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-sunken text-[10.8px] uppercase tracking-wide text-ink-muted font-bold">
              <Th>Programme</Th><Th>Sub-programme</Th><Th>Sub-level KPIs</Th><Th>Status</Th><Th>Days late</Th>
            </tr>
          </thead>
          <tbody>
            <PaginatedRows items={data.subs} colSpan={5} emptyMessage="No sub-programme compliance records for this period." renderRow={(s) => (
              <tr key={s.subId} className="border-t border-line">
                <Td>{s.programmeName}</Td>
                <Td className="font-semibold">{s.subName}</Td>
                <Td className="tabular-nums">{s.kpiCount}</Td>
                <Td><span className={`chip ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span></Td>
                <Td className="tabular-nums">{s.lateBy > 0 ? s.lateBy : '—'}</Td>
              </tr>
            )} />
          </tbody>
        </table>
      </div>

      <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mb-2 mt-6">
        Live late-submission escalation indicators <span className="font-normal text-ink-muted">(durable missing-KPI alerts and assignments are shown above)</span>
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

          </>}
    </div>
  );
}

function OrganisationFilter({ label, value, options, onChange, help }) {
  return (
    <div className="card mb-3 flex flex-wrap items-end gap-3">
      <label className="text-[11px] font-semibold text-ink-secondary">
        {label}
        <select className="field-input mt-1 min-w-[280px] max-w-full" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">All organisations in my scope</option>
          {['Programmes', 'Sub-programmes', 'Departments, faculties and units', 'Employees'].map((group) => {
            const groupedOptions = options.filter((item) => item.group === group);
            return groupedOptions.length > 0 && (
              <optgroup key={group} label={group}>
                {groupedOptions.map((item) => (
                  <option key={`${item.filterType}:${item.id}`} value={`${item.filterType}:${item.id}`}>{item.label}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      <p className="text-[11.5px] text-ink-muted pb-2">{help}</p>
    </div>
  );
}

function TargetPerformanceIndicators({ data }) {
  const escalationByKpi = new Map(data.redEscalations.map((item) => [item.kpiId, item]));
  return (
    <div role="region" aria-labelledby="target-performance-indicators-heading" className="mt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="target-performance-indicators-heading" className="font-display font-bold text-[14px]">
            Target-performance indicators
          </h3>
          <p className="text-[11.5px] text-ink-secondary mt-1">
            Consecutive approved periods below the target-performance threshold. These scores remain distinct from progress pace.
          </p>
        </div>
        <span className="chip border border-line bg-surface text-ink-secondary">
          Threshold {data.settings.ragAmber}% · {data.redKpis.length} below target
        </span>
      </div>
      <div className="rounded-xl border border-line bg-surface overflow-x-auto max-h-[65vh] overflow-y-auto">
        <table className="w-full text-[12.6px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-sunken text-[10.8px] uppercase tracking-wide text-ink-muted font-bold">
              <Th>KPI</Th><Th>Owner</Th><Th>Actual</Th><Th>Target</Th><Th>Performance</Th><Th>Periods below threshold</Th><Th>Escalation path</Th>
            </tr>
          </thead>
          <tbody>
            <PaginatedRows items={data.redKpis} colSpan={7} emptyMessage="No KPI is below the target-performance threshold for this period." renderRow={(item) => {
              const escalation = escalationByKpi.get(item.kpiId);
              const ownerType = ({ programme: 'Programme', sub: 'Sub-programme', unit: 'Unit', university: 'University' })[item.ownerType] || item.ownerType;
              return (
                <tr key={item.kpiId} className="border-t border-line">
                  <Td className="font-semibold min-w-[220px]">{item.kpiName}</Td>
                  <Td><span className="block font-medium">{item.ownerName}</span><span className="text-[10.5px] text-ink-muted">{ownerType}</span></Td>
                  <Td className="tabular-nums">{Number(item.actualValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Td>
                  <Td className="tabular-nums">{Number(item.target).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Td>
                  <Td className="tabular-nums font-bold text-critical">{Number(item.performancePct).toFixed(1)}%</Td>
                  <Td className="tabular-nums">{item.streak}</Td>
                  <Td>
                    {escalation
                      ? <div className="flex flex-wrap gap-1">{escalation.chain.map((name) => <span key={name} className="chip chip-rag-red">{name}</span>)}</div>
                      : <span className="chip bg-sunken text-ink-secondary">Monitoring</span>}
                  </Td>
                </tr>
              );
            }} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerformanceWorkflow({ data, targetPerformanceData, canManage, canManageActions, canApproveActions, currentUserId, onRefresh }) {
  const [selectedAlertId, setSelectedAlertId] = useState('');
  const activeAlerts = data.alerts.filter((alert) => alert.status !== 'resolved');
  const summary = activeAlerts.reduce((counts, alert) => {
    counts[alert.severity] += 1;
    return counts;
  }, { red: 0, amber: 0, missing: 0 });
  const escalationCount = activeAlerts.reduce((sum, alert) =>
    sum + alert.escalations.filter((item) => !['resolved', 'closed'].includes(item.status)).length, 0);
  const visibleAlerts = data.alerts.filter((alert) => alert.status !== 'resolved'
    || alert.escalations.some((item) => !['resolved', 'closed'].includes(item.status))
    || alert.correctiveActions.some((item) => !['completed', 'rejected'].includes(item.status)));
  const selectedAlert = visibleAlerts.find((alert) => alert.id === selectedAlertId) || visibleAlerts[0] || null;
  return (
    <section aria-labelledby="performance-alerts-heading" className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold tracking-[0.12em] text-accent-600 mb-1">PROGRESS &amp; PERFORMANCE OVERSIGHT</p>
          <h2 id="performance-alerts-heading" className="font-display font-extrabold text-[21px]">
            Progress and Performance pace and submission alerts
          </h2>
          <p className="text-[12.5px] text-ink-secondary mt-1 max-w-[80ch]">
            Progress pace and target performance are measured separately, then brought together here with submission alerts and their escalation paths.
          </p>
        </div>
        <span className="chip border border-line bg-surface text-ink-secondary">{MONTHS[data.period.month]} {data.period.year}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <AlertMetric label="Critical progress" value={summary.red} className="border-l-critical" />
        <AlertMetric label="Progress warning" value={summary.amber} className="border-l-warning" />
        <AlertMetric label="Missing reports" value={summary.missing} className="border-l-line-strong" />
        <AlertMetric label="Progress / report escalations" value={escalationCount} className="border-l-accent-500" />
        <AlertMetric
          label="Below performance threshold"
          value={targetPerformanceData ? targetPerformanceData.redKpis.length : '—'}
          className="border-l-critical"
        />
        <AlertMetric
          label="Performance escalations"
          value={targetPerformanceData ? targetPerformanceData.redEscalations.length : '—'}
          className="border-l-warning"
        />
      </div>
      <div className="mb-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="rounded-xl border border-line bg-sunken/50 px-4 py-3">
          <h3 className="font-display text-[14px] font-bold text-ink mb-1">Progress and submission workflow</h3>
          <p className="text-[11.5px] text-ink-secondary">Review the alert, assign an action owner, submit a plan for approval, then record the outcome. Target-performance indicators appear alongside the progress escalations below.</p>
          <details className="mt-2 text-[11px] text-ink-muted">
            <summary className="cursor-pointer font-semibold">View workflow steps</summary>
            <ol className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <WorkflowStep number="1" title="Draft" detail="Manager creates a plan" />
              <WorkflowStep number="2" title="Submitted" detail="Plan sent for review" />
              <WorkflowStep number="3" title="Approved" detail="Reviewer approves" />
              <WorkflowStep number="4" title="In progress" detail="Owner acts" />
              <WorkflowStep number="5" title="Completed" detail="Owner records outcome" />
            </ol>
            <p className="mt-2">A reviewer cannot approve their own plan. Rejected plans can be revised and resubmitted.</p>
          </details>
        </div>
        <WorkflowNotifications />
      </div>
      <div className="card mt-3">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-[14px] font-bold text-ink">Alert actions</h3>
            <p className="text-[11.5px] text-ink-muted">Choose an alert to view its workflow options.</p>
          </div>
          {visibleAlerts.length > 0 && (
            <label className="text-[11px] font-semibold text-ink-secondary">
              Select an alert
              <select
                className="field-input mt-1 min-w-[260px] max-w-full"
                value={selectedAlert?.id || ''}
                disabled={visibleAlerts.length === 1}
                onChange={(event) => setSelectedAlertId(event.target.value)}
              >
                {visibleAlerts.map((alert) => (
                  <option key={alert.id} value={alert.id}>
                    {alert.severity === 'missing' ? 'Missing report' : `Progress pace ${alert.severity}`} · {alert.kpi_name} · {alert.owner_name}
                  </option>
                ))}
              </select>
              {visibleAlerts.length === 1 && (
                <span className="mt-1 block max-w-[42ch] font-normal text-ink-muted">
                  1 alert needs attention for this organisation and month, so there is no other alert to select. The selector enables when more alerts match.
                </span>
              )}
            </label>
          )}
        </div>
        {selectedAlert
          ? <PerformanceAlertCard
            key={selectedAlert.id}
            alert={selectedAlert}
            canManage={canManage}
            canManageActions={canManageActions}
            canApproveActions={canApproveActions}
            currentUserId={currentUserId}
            onRefresh={onRefresh}
          />
          : <p className="text-center text-[12px] text-ink-muted py-3">No open alerts for this organisation and reporting month.</p>}
      </div>
      <EscalationsTable alerts={data.alerts} canManage={canManage} onRefresh={onRefresh} />
      {targetPerformanceData && <TargetPerformanceIndicators data={targetPerformanceData} />}
    </section>
  );
}

function WorkflowStep({ number, title, detail }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
      <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent-50 text-[10px] font-extrabold text-accent-700">{number}</span>
      <span><strong className="block text-ink">{title}</strong><span className="text-ink-muted">{detail}</span></span>
    </li>
  );
}

function WorkflowNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const unreadCount = notifications.filter((item) => !item.read_at).length;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api('/performance-alerts/notifications');
        if (active) {
          setNotifications(result.notifications);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err.message || 'Workflow notifications could not be loaded.');
      }
    }
    load();
    const timer = window.setInterval(load, 30_000);
    window.addEventListener('focus', load);
    window.addEventListener('zou:performance-notifications-updated', load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener('zou:performance-notifications-updated', load);
    };
  }, []);

  async function markRead(notification) {
    if (notification.read_at) return;
    try {
      await api(`/performance-alerts/notifications/${notification.id}/read`, { method: 'PATCH' });
      setNotifications((items) => items.map((item) => item.id === notification.id
        ? { ...item, read_at: new Date().toISOString() }
        : item));
      window.dispatchEvent(new Event('zou:performance-notifications-updated'));
    } catch (err) {
      setError(err.message || 'Notification could not be marked as read.');
    }
  }

  return (
    <div className="relative">
      <button type="button" className="btn h-full min-h-[48px]" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Workflow notifications
        <span className={`chip ${unreadCount ? 'chip-rag-amber' : 'chip-tag'}`}>{unreadCount} new</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <h3 className="font-display text-[13px] font-bold">Workflow notifications</h3>
            <span className="text-[11px] text-ink-muted">{unreadCount} unread</span>
          </div>
          {error && <p role="alert" className="px-3.5 py-2 text-[11px] text-critical">{error}</p>}
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0
              ? <p className="px-4 py-6 text-center text-[12px] text-ink-muted">No workflow notifications yet.</p>
              : notifications.map((notification) => (
                <button
                  type="button"
                  key={notification.id}
                  onClick={() => markRead(notification)}
                  className={`block w-full border-b border-line px-3.5 py-3 text-left last:border-0 hover:bg-sunken ${notification.read_at ? 'bg-surface' : 'bg-accent-50/40'}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <strong className="text-[12px] text-ink">{notification.subject}</strong>
                    {!notification.read_at && <span className="mt-1 h-2 w-2 flex-none rounded-full bg-accent-500" aria-label="Unread" />}
                  </span>
                  <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-secondary">{notification.body}</span>
                  <span className="mt-1 block text-[10px] text-ink-muted">{notification.created_at}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EscalationsTable({ alerts, canManage, onRefresh }) {
  const escalations = alerts.flatMap((alert) => alert.escalations.map((escalation) => ({ ...escalation, alert })));
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [draftStatuses, setDraftStatuses] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
  const activeEscalations = escalations.filter((item) => !['resolved', 'closed'].includes(item.status));
  const allSelected = activeEscalations.length > 0 && activeEscalations.every((item) => selectedIds.has(item.id));

  function toggleSelected(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setStatus(id, value) {
    setDraftStatuses((current) => ({ ...current, [id]: value }));
  }

  function optionsFor(status) {
    return ({
      open: ['acknowledged', 'in_progress', 'resolved', 'closed'],
      acknowledged: ['in_progress', 'resolved', 'closed'],
      in_progress: ['acknowledged', 'resolved', 'closed'],
    })[status] || [];
  }

  async function updateEscalation(escalation, nextStatus, resolution, throwOnError = false) {
    setSavingId(escalation.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/performance-alerts/escalations/${escalation.id}`, {
        method: 'PATCH',
        body: { status: nextStatus, resolution },
      });
      setNotice(`${escalation.reference_code} updated to ${nextStatus.replace('_', ' ')}.`);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(escalation.id);
        return next;
      });
      onRefresh();
    } catch (err) {
      const message = `${escalation.reference_code}: ${err.message || 'Update failed.'}`;
      if (throwOnError) throw new Error(message);
      setError(message);
    } finally {
      setSavingId(null);
    }
  }

  async function resolveSelected() {
    const selected = activeEscalations.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;
    setDialog({ type: 'resolve-selected', ids: selected.map((item) => item.id) });
  }

  async function submitResolutionDialog(values) {
    if (dialog.type === 'resolve-row') {
      await updateEscalation(dialog.escalation, dialog.status, values.resolution.trim(), true);
      return;
    }
    const selected = activeEscalations.filter((item) => dialog.ids.includes(item.id));
    setError(null);
    setNotice(null);
    const failures = [];
    for (const escalation of selected) {
      try {
        // Resolve sequentially so a failure can be reported against its exact record.
        // eslint-disable-next-line no-await-in-loop
        await api(`/performance-alerts/escalations/${escalation.id}`, {
          method: 'PATCH',
          body: { status: 'resolved', resolution: values.resolution.trim() },
        });
      } catch (err) {
        failures.push({ id: escalation.id, message: `${escalation.reference_code}: ${err.message || 'Update failed.'}` });
      }
    }
    if (failures.length) {
      setSelectedIds(new Set(failures.map((failure) => failure.id)));
      onRefresh();
      throw new Error(failures.map((failure) => failure.message).join(' '));
    }
    setSelectedIds(new Set());
    setNotice(`${selected.length} escalation${selected.length === 1 ? '' : 's'} resolved.`);
    onRefresh();
  }

  function toggleExpanded(id) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
    <section className="card mb-4 p-0 overflow-hidden" aria-labelledby="escalations-table-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h3 id="escalations-table-heading" className="font-display text-[16px] font-bold">Progress-pace and submission escalations</h3>
          <p className="text-[11.5px] text-ink-muted mt-0.5">Select open records to resolve together, or change a single record’s status.</p>
        </div>
        {canManage && (
          <button type="button" className="btn btn-sm" disabled={!selectedIds.size || savingId != null} onClick={resolveSelected}>
            Resolve selected ({selectedIds.size})
          </button>
        )}
      </div>
      {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-critical-soft px-3 py-2 text-[12px] text-critical">{error}</p>}
      {notice && <p role="status" className="mx-4 mt-3 rounded-lg bg-good-soft px-3 py-2 text-[12px] text-good">{notice}</p>}
      {escalations.length === 0
        ? <p className="px-4 py-7 text-center text-[12.5px] text-ink-muted">No progress-pace or submission escalations have been recorded for this reporting period.</p>
        : <div className="max-h-[440px] overflow-auto">
          <table className="w-full min-w-[980px] text-[12px]">
            <thead className="sticky top-0 z-10 bg-sunken">
              <tr className="text-left text-[10px] uppercase tracking-wide text-ink-secondary">
                {canManage && <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all open escalations" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(activeEscalations.map((item) => item.id)) : new Set())} /></th>}
                <th className="px-3 py-2.5">Reference / KPI</th>
                <th className="px-3 py-2.5">Escalation</th>
                <th className="px-3 py-2.5">Assigned to</th>
                <th className="px-3 py-2.5">Due</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              <PaginatedRows items={escalations} colSpan={canManage ? 7 : 6} emptyMessage="No performance escalations." renderRow={(escalation) => {
                const isOpen = expandedIds.has(escalation.id);
                const nextStatus = draftStatuses[escalation.id] || escalation.status;
                const options = optionsFor(escalation.status);
                const canUpdate = canManage && options.includes(nextStatus) && nextStatus !== escalation.status;
                return (
                  <FragmentRow
                    key={escalation.id}
                    escalation={escalation}
                    canManage={canManage}
                    selected={selectedIds.has(escalation.id)}
                    onSelect={() => toggleSelected(escalation.id)}
                    isOpen={isOpen}
                    onToggle={() => toggleExpanded(escalation.id)}
                    nextStatus={nextStatus}
                    options={options}
                    onStatusChange={(value) => setStatus(escalation.id, value)}
                    canUpdate={canUpdate}
                    busy={savingId === escalation.id || savingId != null}
                    onUpdate={(status, resolution) => updateEscalation(escalation, status, resolution)}
                    onRequestResolution={(status) => setDialog({ type: 'resolve-row', escalation, status })}
                  />
                );
              }} />
            </tbody>
          </table>
        </div>}
    </section>
    {dialog && (
      <WorkflowDialog
        title={dialog.status === 'closed' ? 'Close escalation' : 'Resolve progress/report escalation'}
        description={dialog.type === 'resolve-row'
          ? `Add a resolution summary for ${dialog.escalation.reference_code}.`
          : `Add one resolution summary for ${dialog.ids.length} selected escalation${dialog.ids.length === 1 ? '' : 's'}.`}
        submitLabel={dialog.status === 'closed' ? 'Save and close' : 'Resolve escalation'}
        fields={[{
          name: 'resolution',
          label: 'Resolution summary',
          type: 'textarea',
          required: true,
          minLength: 3,
          maxLength: 2000,
          hint: 'Describe what was done to address the escalation.',
        }]}
        onClose={() => setDialog(null)}
        onSubmit={submitResolutionDialog}
      />
    )}
    </>
  );
}

function FragmentRow({ escalation, canManage, selected, onSelect, isOpen, onToggle, nextStatus, options, onStatusChange, canUpdate, busy, onUpdate, onRequestResolution }) {
  const { alert } = escalation;
  const finished = ['resolved', 'closed'].includes(escalation.status);
  const statusLabel = { open: 'Open', acknowledged: 'Acknowledged', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
  return (
    <>
      <tr className="border-t border-line align-top hover:bg-sunken/40">
        {canManage && (
          <td className="px-3 py-2.5">
            <input type="checkbox" aria-label={`Select ${escalation.reference_code}`} checked={selected} disabled={finished} onChange={onSelect} />
          </td>
        )}
        <td className="px-3 py-2.5">
          <strong className="block text-ink">{escalation.reference_code}</strong>
          <span className="text-ink-secondary">{alert.kpi_name}</span>
        </td>
        <td className="px-3 py-2.5">
          <span className="chip chip-tag">Level {escalation.level}</span>
          <span className="block mt-1 max-w-[280px] truncate text-ink-secondary" title={escalation.reason}>{escalation.reason}</span>
        </td>
        <td className="px-3 py-2.5 text-ink-secondary">{escalation.assigned_name || 'Unassigned'}</td>
        <td className="px-3 py-2.5 whitespace-nowrap text-ink-secondary">{escalation.response_due_at || '—'}</td>
        <td className="px-3 py-2.5">
          <span className={`chip ${finished ? 'chip-rag-none' : 'chip-rag-amber'}`}>{statusLabel[escalation.status] || escalation.status}</span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn btn-sm" aria-expanded={isOpen} onClick={onToggle}>{isOpen ? 'Hide' : 'Details'}</button>
            {canManage && !finished && (
              <>
                <select className="field-input min-w-[130px] py-1 text-[11px]" value={nextStatus} aria-label={`New status for ${escalation.reference_code}`} onChange={(event) => onStatusChange(event.target.value)}>
                  <option value={escalation.status}>{statusLabel[escalation.status]}</option>
                  {options.map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
                </select>
                <button type="button" className="btn btn-sm" disabled={!canUpdate || busy} onClick={() => {
                  if (['resolved', 'closed'].includes(nextStatus)) {
                    onRequestResolution(nextStatus);
                    return;
                  }
                  onUpdate(nextStatus);
                }}>{busy ? 'Saving…' : 'Save'}</button>
              </>
            )}
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-line bg-sunken/35">
          <td colSpan={canManage ? 7 : 6} className="px-4 py-3">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11.5px]">
              <div><dt className="font-bold text-ink-muted">Organisation</dt><dd className="text-ink-secondary">{alert.programme_name} · {alert.sub_name} · {alert.unit_name || alert.employee_name || alert.owner_name}</dd></div>
              <div><dt className="font-bold text-ink-muted">Alert status</dt><dd className="text-ink-secondary">{alert.status.replace('_', ' ')}</dd></div>
              <div><dt className="font-bold text-ink-muted">Actual / target</dt><dd className="text-ink-secondary">{alert.actual == null ? '—' : `${alert.actual} / ${alert.target}`}</dd></div>
              <div><dt className="font-bold text-ink-muted">Resolution</dt><dd className="text-ink-secondary">{escalation.resolution || 'Not resolved'}</dd></div>
              <div className="sm:col-span-2 lg:col-span-4"><dt className="font-bold text-ink-muted">Evidence</dt><dd className="text-ink-secondary whitespace-pre-wrap">{escalation.evidence || alert.details || 'No evidence recorded.'}</dd></div>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function PerformanceAlertCard({ alert, canManage, canManageActions, canApproveActions, currentUserId, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [editingAction, setEditingAction] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [assigneeError, setAssigneeError] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [dialog, setDialog] = useState(null);
  const severity = alert.severity === 'red'
    ? 'chip-rag-red'
    : alert.severity === 'amber' ? 'chip-rag-amber' : 'chip-rag-none';

  async function perform(path, options) {
    setBusy(true);
    setError(null);
    try {
      await api(path, options);
      onRefresh();
      return true;
    } catch (err) {
      setError(err.message || 'The requested workflow update failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadAssignees() {
    if (usersLoaded || usersLoading) return;
    setUsersLoading(true);
    setAssigneeError(null);
    try {
      const result = await api(`/performance-alerts/${alert.id}/assignees`);
      setUsers(result.users);
      setUsersLoaded(true);
    } catch (err) {
      setAssigneeError(err.message || 'Could not load eligible action owners.');
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    if (!showPlan) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busy) {
        setShowPlan(false);
        setEditingAction(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPlan, busy]);

  async function expand() {
    const next = !expanded;
    setExpanded(next);
    if (next) await loadAssignees();
  }

  async function loadHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    try {
      const result = await api(`/performance-alerts/history/${alert.id}`);
      setHistory(result.history);
    } catch (err) {
      setError(err.message || 'Could not load the alert audit history.');
    }
  }

  function resolveAlert() {
    setDialog({ type: 'resolve-alert' });
  }

  function createEscalation() {
    setDialog({ type: 'create-escalation' });
  }

  async function submitWorkflowDialog(values) {
    if (dialog.type === 'resolve-alert') {
      await api(`/performance-alerts/${alert.id}/status`, {
        method: 'PATCH',
        body: { status: 'resolved', note: values.note.trim() },
      });
    } else if (dialog.type === 'create-escalation') {
      await api(`/performance-alerts/${alert.id}/escalations`, {
        method: 'POST',
        body: { level: Number(values.level), reason: values.reason.trim() },
      });
    } else if (dialog.type === 'complete-action') {
      await api(`/performance-alerts/actions/${dialog.action.id}`, {
        method: 'PATCH',
        body: { status: 'completed', outcome: values.outcome.trim() },
      });
    } else if (dialog.type === 'reject-action') {
      await api(`/performance-alerts/actions/${dialog.action.id}`, {
        method: 'PATCH',
        body: { status: 'rejected', evidence: values.reason.trim() },
      });
    }
    onRefresh();
  }

  async function createAction(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const textFields = ['title', 'rootCause', 'intervention', 'expectedImprovement'];
    const values = Object.fromEntries(textFields.map((name) => [name, String(form.get(name) || '').trim()]));
    const dueDate = String(form.get('dueDate') || '');
    const responsibleUserId = String(form.get('responsibleUserId') || '');
    const nextFieldErrors = {};
    const labels = {
      title: 'Plan title',
      rootCause: 'Root cause',
      intervention: 'Intervention',
      expectedImprovement: 'Expected improvement',
    };
    textFields.forEach((name) => {
      if (values[name].length < 3) nextFieldErrors[name] = `${labels[name]} must be at least 3 characters.`;
      else if (values[name].length > 4000) nextFieldErrors[name] = `${labels[name]} must be 4000 characters or fewer.`;
    });
    if (!responsibleUserId) nextFieldErrors.responsibleUserId = 'Select a responsible person with a designation.';
    if (!dueDate) nextFieldErrors.dueDate = 'Choose a due date.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < new Date().toISOString().slice(0, 10)) {
      nextFieldErrors.dueDate = 'Choose a valid date that is today or later.';
    }
    setFieldErrors(nextFieldErrors);
    setError(null);
    if (Object.keys(nextFieldErrors).length) return;
    const payload = {
      title: values.title,
      rootCause: values.rootCause,
      intervention: values.intervention,
      dueDate,
      expectedImprovement: values.expectedImprovement,
      resources: String(form.get('resources') || '').trim(),
      responsibleUserId,
      escalationId: form.get('escalationId') || null,
    };
    setBusy(true);
    setError(null);
    try {
      if (editingAction) {
        await api(`/performance-alerts/actions/${editingAction.id}`, {
          method: 'PATCH',
          body: { ...payload, status: 'draft' },
        });
      } else {
        await api(`/performance-alerts/${alert.id}/actions`, { method: 'POST', body: payload });
      }
      setEditingAction(null);
      setShowPlan(false);
      onRefresh();
    } catch (err) {
      setError(err.message || 'The corrective action plan could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function advanceAction(action) {
    const nextStatus = {
      draft: 'submitted',
      approved: 'in_progress',
      in_progress: 'completed',
    }[action.status];
    if (!nextStatus) return;
    if (nextStatus === 'completed') {
      setDialog({ type: 'complete-action', action });
      return;
    }
    await perform(`/performance-alerts/actions/${action.id}`, {
      method: 'PATCH',
      body: { status: nextStatus },
    });
  }

  async function reviewAction(action, status) {
    if (status === 'rejected') {
      setDialog({ type: 'reject-action', action });
      return;
    }
    await perform(`/performance-alerts/actions/${action.id}`, { method: 'PATCH', body: { status } });
  }

  function openPlanForm(action = null) {
    setEditingAction(action);
    setFieldErrors({});
    setError(null);
    setShowPlan(true);
    void loadAssignees();
  }

  function closePlanForm() {
    setShowPlan(false);
    setEditingAction(null);
    setFieldErrors({});
  }

  function clearFieldError(name) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  const statusLabel = { open: 'Open', acknowledged: 'Acknowledged', action_planned: 'Action planned', resolved: 'Resolved' };
  const actionStatusLabel = { draft: 'Draft', submitted: 'Submitted for review', approved: 'Approved', in_progress: 'In progress', completed: 'Completed', rejected: 'Revision requested' };

  const dialogFields = dialog?.type === 'resolve-alert'
    ? [{ name: 'note', label: 'Resolution note', type: 'textarea', required: true, minLength: 3, maxLength: 2000, hint: 'Explain how the KPI issue was addressed.' }]
    : dialog?.type === 'create-escalation'
      ? [
        { name: 'level', label: 'Escalation level', type: 'select', required: true, options: [{ value: '1', label: 'Level 1 · Programme' }, { value: '2', label: 'Level 2 · Executive' }, { value: '3', label: 'Level 3 · Institutional' }], hint: 'Choose the appropriate governance level.' },
        { name: 'reason', label: 'Reason for escalation', type: 'textarea', required: true, minLength: 5, maxLength: 2000, hint: 'Summarize why this alert needs escalation.' },
      ]
      : dialog?.type === 'complete-action'
        ? [{ name: 'outcome', label: 'Outcome recorded', type: 'textarea', required: true, minLength: 3, maxLength: 2000, hint: 'Record the result of the corrective action before completing it.' }]
        : dialog?.type === 'reject-action'
          ? [{ name: 'reason', label: 'Revision feedback', type: 'textarea', required: true, minLength: 3, maxLength: 2000, hint: 'Explain what must change before the plan can be approved.' }]
          : [];
  const dialogTitles = {
    'resolve-alert': ['Resolve progress pace alert', 'Add a clear resolution note to the alert record.', 'Resolve alert'],
    'create-escalation': ['Escalate progress pace alert', 'Choose an escalation level and explain the reason.', 'Create escalation'],
    'complete-action': ['Complete corrective action', 'Record the outcome before marking this plan complete.', 'Save outcome and complete'],
    'reject-action': ['Request a plan revision', 'Provide actionable feedback for the plan creator.', 'Send revision feedback'],
  };
  const activeDialogTitle = dialog ? dialogTitles[dialog.type] : null;

  return (
    <>
    <article className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`chip ${severity}`}>
              {alert.severity === 'missing' ? 'Missing submission' : `Progress pace · ${alert.severity.toUpperCase()}`}
            </span>
            <span className="chip bg-sunken text-ink-secondary">{statusLabel[alert.status]}</span>
            <span className="text-[11px] text-ink-muted">{alert.programme_name} · {alert.sub_name} · {alert.unit_name || alert.employee_name || alert.owner_name}</span>
          </div>
          <h3 className="font-display font-bold text-[16px] text-ink">{alert.kpi_name}</h3>
          <p className="text-[12.5px] leading-relaxed text-ink-secondary mt-1">{alert.details}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={expand}>{expanded ? 'Hide workflow' : 'Open workflow details'}</button>
        <button type="button" className="btn btn-sm" onClick={loadHistory}>Audit history</button>
        {canManage && alert.status === 'open' && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => perform(`/performance-alerts/${alert.id}/status`, { method: 'PATCH', body: { status: 'acknowledged' } })}>Acknowledge</button>
        )}
        {canManage && alert.status !== 'resolved' && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={resolveAlert}>Resolve</button>
        )}
        {canManage && alert.status !== 'resolved' && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={createEscalation}>Escalate</button>
        )}
        {canManageActions && alert.status !== 'resolved' && (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => openPlanForm()}>
            Create corrective action
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-[11.5px] text-critical mt-2">{error}</p>}
      {expanded && (
        <div className="mt-4 border-t border-line pt-3 space-y-3">
          {alert.correctiveActions.map((action) => {
            const reviewers = action.reviewers || [];
            return (
            <div key={action.id} className="rounded-xl border border-line bg-sunken/50 p-3.5 text-[12px]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong className="text-[13px] text-ink">{action.title}</strong>
                  <p className="text-[11.5px] text-ink-secondary mt-1">{action.root_cause}</p>
                </div>
                <span className={`chip ${action.status === 'completed' ? 'chip-rag-green' : action.status === 'rejected' ? 'chip-rag-amber' : 'chip-tag'}`}>
                  {actionStatusLabel[action.status] || action.status}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px] text-ink-secondary">
                <p><strong className="text-ink">Owner:</strong> {action.responsible_name
                  ? `${action.responsible_name} · ${action.responsible_title || action.responsible_role || 'Designation unavailable'}`
                  : 'Unassigned'}</p>
                <p><strong className="text-ink">Due:</strong> {action.due_date}</p>
                <p><strong className="text-ink">Intervention:</strong> {action.intervention}</p>
                <p><strong className="text-ink">Expected improvement:</strong> {action.expected_improvement}</p>
                {action.evidence && <p className="sm:col-span-2"><strong className="text-ink">Review note / evidence:</strong> {action.evidence}</p>}
                {action.outcome && <p className="sm:col-span-2"><strong className="text-ink">Outcome:</strong> {action.outcome}</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {action.status === 'draft' && canManageActions && (
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => advanceAction(action)}>Submit plan for review</button>
                )}
                {action.status === 'submitted' && canApproveActions && action.created_by !== currentUserId && (
                  <>
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => reviewAction(action, 'approved')}>Approve plan</button>
                    <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => reviewAction(action, 'rejected')}>Request revision</button>
                  </>
                )}
                {action.status === 'rejected' && canManageActions && (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => openPlanForm(action)}>Revise and resubmit</button>
                )}
                {action.status === 'approved' && (canManageActions || action.responsible_user_id === currentUserId) && (
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => advanceAction(action)}>Start action</button>
                )}
                {action.status === 'in_progress' && (canManageActions || action.responsible_user_id === currentUserId) && (
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => advanceAction(action)}>Complete and record outcome</button>
                )}
                {action.status === 'submitted' && (
                  <div className="w-full rounded-lg border border-accent-500/20 bg-accent-50/40 px-3 py-2 text-[11px]">
                    <strong className="text-ink">Review required · An authorised reviewer in this scope must decide</strong>
                    {reviewers.length > 0
                      ? <ul className="mt-1 space-y-0.5 text-ink-secondary">
                        {reviewers.map((reviewer) => (
                          <li key={reviewer.id}>
                            {reviewer.name} — {reviewer.designation}{reviewer.department ? ` · ${reviewer.department}` : ''}
                          </li>
                        ))}
                      </ul>
                      : <p className="mt-1 text-warning">No eligible reviewer is configured for this scope. Contact the Corporate Planning Unit or an administrator to assign corrective-action approval access.</p>}
                  </div>
                )}
                {action.status === 'approved' && action.responsible_user_id !== currentUserId && !canManageActions && (
                  <span className="text-[11px] text-ink-muted">The assigned owner can start this action.</span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
      {showPlan && canManageActions && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) closePlanForm();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="corrective-action-title"
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line bg-sunken/50 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-accent-700">Performance improvement plan</p>
                <h2 id="corrective-action-title" className="mt-1 font-display text-lg font-bold text-ink">
                  {editingAction ? 'Revise corrective action' : 'Create corrective action'}
                </h2>
                <p className="mt-1 text-[12px] text-ink-secondary">{alert.kpi_name} · {alert.owner_name}</p>
              </div>
              <button type="button" className="btn btn-sm flex-none" aria-label="Close corrective action form" disabled={busy} onClick={closePlanForm}>Close</button>
            </header>
            <form key={editingAction?.id || 'new-action'} noValidate className="flex min-h-0 flex-col overflow-y-auto" onSubmit={createAction}>
              <div className="grid gap-x-4 gap-y-4 p-5 sm:grid-cols-2 sm:p-6">
                <div>
                  <label htmlFor="action-title" className="text-[12px] font-semibold text-ink-secondary">Plan title <span className="text-critical">*</span></label>
                  <input id="action-title" name="title" required minLength="3" maxLength="4000" defaultValue={editingAction?.title || ''} aria-invalid={Boolean(fieldErrors.title)} aria-describedby="action-title-feedback" onChange={() => clearFieldError('title')} className="field-input mt-1.5 h-11 w-full" />
                  <p id="action-title-feedback" className={`mt-1 min-h-4 text-[10.5px] ${fieldErrors.title ? 'text-critical' : 'text-ink-muted'}`}>{fieldErrors.title || 'Give the action a clear, specific title (3–4000 characters).'}</p>
                </div>
                <div>
                  <label htmlFor="action-owner" className="text-[12px] font-semibold text-ink-secondary">Responsible person and designation <span className="text-critical">*</span></label>
                  <select id="action-owner" name="responsibleUserId" required defaultValue={editingAction?.responsible_user_id || ''} aria-invalid={Boolean(fieldErrors.responsibleUserId)} aria-describedby="action-owner-feedback" onChange={() => clearFieldError('responsibleUserId')} className="field-input mt-1.5 h-11 w-full" disabled={usersLoading || users.length === 0}>
                    <option value="">{usersLoading ? 'Loading eligible people…' : 'Select a responsible person'}</option>
                    {users.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.title || USER_DESIGNATION[person.role] || person.role}</option>)}
                  </select>
                  <p id="action-owner-feedback" className={`mt-1 min-h-4 text-[10.5px] ${fieldErrors.responsibleUserId || assigneeError ? 'text-critical' : 'text-ink-muted'}`}>
                    {fieldErrors.responsibleUserId || assigneeError || (users.length ? 'The selected person’s designation is shown with their name.' : usersLoading ? 'Loading eligible people for this KPI.' : 'No eligible designated assignees are available. Contact an administrator.')}
                  </p>
                  {assigneeError && <button type="button" className="text-[10.5px] font-semibold text-accent-700 underline" onClick={() => { setUsersLoaded(false); void loadAssignees(); }}>Retry loading people</button>}
                </div>
                <div>
                  <label htmlFor="action-root-cause" className="text-[12px] font-semibold text-ink-secondary">Root cause <span className="text-critical">*</span></label>
                  <textarea id="action-root-cause" name="rootCause" required minLength="3" maxLength="4000" defaultValue={editingAction?.root_cause || ''} aria-invalid={Boolean(fieldErrors.rootCause)} aria-describedby="action-root-cause-feedback" onChange={() => clearFieldError('rootCause')} className="field-input mt-1.5 min-h-[112px] w-full resize-y" />
                  <p id="action-root-cause-feedback" className={`mt-1 min-h-4 text-[10.5px] ${fieldErrors.rootCause ? 'text-critical' : 'text-ink-muted'}`}>{fieldErrors.rootCause || 'Explain the underlying cause (3–4000 characters).'}</p>
                </div>
                <div>
                  <label htmlFor="action-intervention" className="text-[12px] font-semibold text-ink-secondary">Planned intervention <span className="text-critical">*</span></label>
                  <textarea id="action-intervention" name="intervention" required minLength="3" maxLength="4000" defaultValue={editingAction?.intervention || ''} aria-invalid={Boolean(fieldErrors.intervention)} aria-describedby="action-intervention-feedback" onChange={() => clearFieldError('intervention')} className="field-input mt-1.5 min-h-[112px] w-full resize-y" />
                  <p id="action-intervention-feedback" className={`mt-1 min-h-4 text-[10.5px] ${fieldErrors.intervention ? 'text-critical' : 'text-ink-muted'}`}>{fieldErrors.intervention || 'Describe the corrective steps (3–4000 characters).'}</p>
                </div>
                <div>
                  <label htmlFor="action-improvement" className="text-[12px] font-semibold text-ink-secondary">Expected improvement <span className="text-critical">*</span></label>
                  <input id="action-improvement" name="expectedImprovement" required minLength="3" maxLength="4000" defaultValue={editingAction?.expected_improvement || ''} aria-invalid={Boolean(fieldErrors.expectedImprovement)} aria-describedby="action-improvement-feedback" onChange={() => clearFieldError('expectedImprovement')} className="field-input mt-1.5 h-11 w-full" />
                  <p id="action-improvement-feedback" className={`mt-1 min-h-4 text-[10.5px] ${fieldErrors.expectedImprovement ? 'text-critical' : 'text-ink-muted'}`}>{fieldErrors.expectedImprovement || 'State the measurable result expected.'}</p>
                </div>
                <div>
                  <label htmlFor="action-due-date" className="text-[12px] font-semibold text-ink-secondary">Due date <span className="text-critical">*</span></label>
                  <input id="action-due-date" type="date" name="dueDate" required min={new Date().toISOString().slice(0, 10)} defaultValue={editingAction?.due_date || ''} aria-invalid={Boolean(fieldErrors.dueDate)} aria-describedby="action-due-date-feedback" onChange={() => clearFieldError('dueDate')} className="field-input mt-1.5 h-11 w-full" />
                  <p id="action-due-date-feedback" className={`mt-1 min-h-4 text-[10.5px] ${fieldErrors.dueDate ? 'text-critical' : 'text-ink-muted'}`}>{fieldErrors.dueDate || 'Choose a date that is today or later.'}</p>
                </div>
                {!editingAction && alert.escalations.length > 0 && (
                  <div className="sm:col-span-2">
                    <label htmlFor="action-escalation" className="text-[12px] font-semibold text-ink-secondary">Link to escalation <span className="font-normal text-ink-muted">(optional)</span></label>
                    <select id="action-escalation" name="escalationId" defaultValue="" className="field-input mt-1.5 h-11 w-full">
                      <option value="">Alert-level plan (no escalation linked)</option>
                      {alert.escalations.map((escalation) => <option key={escalation.id} value={escalation.id}>{escalation.reference_code} · Level {escalation.level}</option>)}
                    </select>
                    <p className="mt-1 min-h-4 text-[10.5px] text-ink-muted">Link this plan to a specific escalation if applicable.</p>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label htmlFor="action-resources" className="text-[12px] font-semibold text-ink-secondary">Resources required <span className="font-normal text-ink-muted">(optional)</span></label>
                  <textarea id="action-resources" name="resources" maxLength="4000" defaultValue={editingAction?.resources || ''} aria-describedby="action-resources-feedback" className="field-input mt-1.5 min-h-[88px] w-full resize-y" />
                  <p id="action-resources-feedback" className="mt-1 min-h-4 text-[10.5px] text-ink-muted">List staff, budget, or materials needed (up to 4000 characters).</p>
                </div>
                {error && <p role="alert" className="sm:col-span-2 rounded-lg border border-critical/20 bg-critical-soft px-3 py-2 text-[12px] text-critical">{error}</p>}
              </div>
              <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/60 px-5 py-4 sm:px-6">
                <p className="text-[11px] text-ink-muted"><span className="text-critical">*</span> Required fields · The plan will be saved as a draft for review.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={closePlanForm}>Cancel</button>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={busy || usersLoading || users.length === 0}>
                    {busy ? 'Saving…' : editingAction ? 'Save revised plan' : 'Create corrective action'}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
      {history && (
        <div className="mt-3 border-t border-line pt-3 text-[11px] space-y-1">
          {history.length ? history.map((entry) => (
            <p key={entry.id} className="text-ink-secondary">{entry.ts} · {entry.user_name || 'System'} · {entry.action}: {entry.detail}</p>
          )) : <p className="text-ink-muted">No workflow history has been recorded yet.</p>}
        </div>
      )}
    </article>
    {dialog && (
      <WorkflowDialog
        title={activeDialogTitle[0]}
        description={activeDialogTitle[1]}
        submitLabel={activeDialogTitle[2]}
        fields={dialogFields}
        onClose={() => setDialog(null)}
        onSubmit={submitWorkflowDialog}
      />
    )}
    </>
  );
}

function AlertMetric({ label, value, className }) {
  return (
    <div className={`card border-l-4 ${className} px-3 py-2.5`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted font-bold">{label}</div>
      <div className="font-display font-extrabold text-[20px] tabular-nums">{value}</div>
    </div>
  );
}

function WorkflowDialog({ title, description, submitLabel, fields, onClose, onSubmit }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, field.initialValue || ''])));
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  async function submit(event) {
    event.preventDefault();
    const errors = {};
    fields.forEach((field) => {
      const value = String(values[field.name] || '').trim();
      if (field.required && !value) errors[field.name] = `${field.label} is required.`;
      else if (value && field.minLength && value.length < field.minLength) {
        errors[field.name] = `${field.label} must be at least ${field.minLength} characters.`;
      } else if (value && field.maxLength && value.length > field.maxLength) {
        errors[field.name] = `${field.label} must be ${field.maxLength} characters or fewer.`;
      }
    });
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setSubmitError(err.message || 'The requested workflow update could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-dialog-title"
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line bg-sunken/50 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-accent-700">Progress / submission workflow</p>
            <h2 id="workflow-dialog-title" className="mt-1 font-display text-lg font-bold text-ink">{title}</h2>
            <p className="mt-1 text-[12px] text-ink-secondary">{description}</p>
          </div>
          <button type="button" className="btn btn-sm flex-none" aria-label="Close dialog" disabled={busy} onClick={onClose}>Close</button>
        </header>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-col overflow-y-auto">
          <div className="space-y-4 p-5 sm:p-6">
            {fields.map((field, index) => (
              <div key={field.name}>
                <label htmlFor={`workflow-field-${field.name}`} className="text-[12px] font-semibold text-ink-secondary">
                  {field.label} {field.required && <span className="text-critical">*</span>}
                </label>
                {field.type === 'textarea'
                  ? <textarea
                    id={`workflow-field-${field.name}`}
                    autoFocus={index === 0}
                    rows={4}
                    maxLength={field.maxLength}
                    value={values[field.name]}
                    aria-invalid={Boolean(fieldErrors[field.name])}
                    aria-describedby={`workflow-field-${field.name}-feedback`}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="field-input mt-1.5 min-h-[112px] w-full resize-y"
                  />
                  : field.type === 'select'
                    ? <select
                      id={`workflow-field-${field.name}`}
                      autoFocus={index === 0}
                      value={values[field.name]}
                      aria-invalid={Boolean(fieldErrors[field.name])}
                      aria-describedby={`workflow-field-${field.name}-feedback`}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="field-input mt-1.5 h-11 w-full"
                    >
                      <option value="">Choose an option</option>
                      {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    : <input
                      id={`workflow-field-${field.name}`}
                      autoFocus={index === 0}
                      type={field.type || 'text'}
                      value={values[field.name]}
                      aria-invalid={Boolean(fieldErrors[field.name])}
                      aria-describedby={`workflow-field-${field.name}-feedback`}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="field-input mt-1.5 h-11 w-full"
                    />}
                <p id={`workflow-field-${field.name}-feedback`} className={`mt-1 min-h-4 text-[10.5px] ${fieldErrors[field.name] ? 'text-critical' : 'text-ink-muted'}`}>
                  {fieldErrors[field.name] || field.hint}
                </p>
              </div>
            ))}
            {submitError && <p role="alert" className="rounded-lg border border-critical/20 bg-critical-soft px-3 py-2 text-[12px] text-critical">{submitError}</p>}
          </div>
          <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/60 px-5 py-4 sm:px-6">
            <p className="text-[11px] text-ink-muted"><span className="text-critical">*</span> Required before saving.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm" disabled={busy} onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Th({ children }) { return <th className="px-3 py-2.5 text-left">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2.5 ${className}`}>{children}</td>; }
