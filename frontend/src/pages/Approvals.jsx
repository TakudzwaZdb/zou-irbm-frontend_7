import { useApp } from '../context/AppContext.jsx';
import { isApprover, valueStatus } from '../lib/scope.js';
import KpiCard from '../components/KpiCard.jsx';
import PeriodPicker from '../components/PeriodPicker.jsx';

export default function Approvals() {
  const { user, org, kpis, values, contributions, assignments, period } = useApp();
  // A Sub-programme's own KPI now has TWO different approvers depending on
  // stage (Programme Head at 'submitted', CPU at 'programme_approved') — so
  // "is this KPI mine at all" has to check both stages, not just the one
  // this role happens to act on right now. Individual/Unit-owned KPIs have
  // only ever had one approver, so both calls agree and this is a no-op for
  // them.
  const mine = kpis.filter((k) => isApprover(org, user, k, 'submitted') || isApprover(org, user, k, 'programme_approved'));
  const statusOf = (k) => valueStatus(values[`${k.id}-${period.year}-${period.month}`]);

  // Pending: only the KPIs THIS role is the approver of for the value row's
  // ACTUAL current stage — a Programme Head sees sub-owned submissions at
  // 'submitted', never at 'programme_approved' (that one's already moved on
  // to CPU); CPU sees the reverse.
  const pending = mine.filter((k) => {
    const st = statusOf(k);
    return (st === 'submitted' || st === 'programme_approved') && isApprover(org, user, k, st);
  });
  // A Programme Head's own past decision also includes having forwarded a
  // submission on to CPU — that's not "not yet submitted" or "still
  // pending my review", it's genuinely decided from their seat, even though
  // the KPI as a whole isn't fully approved yet.
  const decidedStatuses = user.role === 'programme' ? ['approved', 'returned', 'programme_approved'] : ['approved', 'returned'];
  const decided = mine.filter((k) => decidedStatuses.includes(statusOf(k)));
  const notStarted = mine.filter((k) => ['none', 'draft'].includes(statusOf(k)));

  // A Unit Head's OWN review queue, one tier below the `mine` section above:
  // not "is my role the approver of this KPI's value" (that's the Sub
  // Rep, for a Unit KPI), but "did I assign this KPI to people who've now
  // submitted THEIR figure to me". Every shared Unit KPI this Unit Head
  // owns that has at least one contribution awaiting them this period.
  const myUnitKpis = user.role === 'unithead'
    ? kpis.filter((k) => k.owner_type === 'unit' && k.owner_id === user.scope_id)
    : [];
  const pendingContributionKpis = myUnitKpis.filter((k) =>
    assignments.some((a) => a.kpi_id === k.id) &&
    contributions.some((c) => c.kpi_id === k.id && c.status === 'submitted')
  );

  const totalPending = pending.length + pendingContributionKpis.length;

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Approvals Queue</h1>
          <p className="text-[13px] text-ink-secondary">
            {totalPending === 0
              ? 'Nothing awaiting your review right now.'
              : `${totalPending} submission${totalPending > 1 ? 's' : ''} from the tier below you, awaiting your decision.`}
          </p>
        </div>
        <PeriodPicker />
      </div>

      {totalPending === 0 && pending.length === 0 && pendingContributionKpis.length === 0 && (
        <div className="card text-center text-ink-muted py-10">Nothing awaiting your review for this period.</div>
      )}

      {pending.map((k) => <KpiCard key={k.id} kpi={k} mode="approver" />)}

      {pendingContributionKpis.length > 0 && (
        <>
          <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mt-2 mb-2">
            Contributions from your team, awaiting your review
          </h2>
          {pendingContributionKpis.map((k) => <KpiCard key={`c${k.id}`} kpi={k} mode="owner" context="approvals" />)}
        </>
      )}

      {decided.length > 0 && (
        <>
          <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mt-6 mb-2">Decided this period</h2>
          {decided.map((k) => <KpiCard key={k.id} kpi={k} mode="readOnly" />)}
        </>
      )}

      {notStarted.length > 0 && (
        <>
          <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mt-6 mb-2">Not yet submitted by the tier below you</h2>
          {notStarted.map((k) => <KpiCard key={k.id} kpi={k} mode="readOnly" />)}
        </>
      )}
    </div>
  );
}
