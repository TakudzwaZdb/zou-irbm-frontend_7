import { useApp } from '../context/AppContext.jsx';
import { isApprover, valueStatus } from '../lib/scope.js';
import ApprovalsTable, { TeamApprovalsTable, FeedbackTable } from '../components/ApprovalsTable.jsx';
import PeriodPicker from '../components/PeriodPicker.jsx';

export default function Approvals() {
  const { user, org, kpis, values, contributions, assignments, period } = useApp();
  // Single stage, every tier alike: one real approver per KPI (Individual
  // by its Unit Head, Unit by its Sub-programme Rep, Sub by its own
  // Programme Head, final — no further CPU stage in this cascade).
  const mine = kpis.filter((k) => isApprover(org, user, k));
  const statusOf = (k) => valueStatus(values[`${k.id}-${period.year}-${period.month}`]);

  // Pending: the KPIs THIS role is the approver of, sitting at 'submitted'.
  const pending = mine.filter((k) => statusOf(k) === 'submitted');
  const decided = mine.filter((k) => ['approved', 'returned'].includes(statusOf(k)));
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

      {pending.length > 0 && <ApprovalsTable kpis={pending} interactive />}

      {pendingContributionKpis.length > 0 && (
        <div className="mt-5">
          <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mb-2">
            Contributions from your team, awaiting your review
          </h2>
          <TeamApprovalsTable kpis={pendingContributionKpis} />
        </div>
      )}

      {decided.length > 0 && (
        <div className="mt-6">
          <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mb-2">Decided this period</h2>
          <ApprovalsTable kpis={decided} interactive={false} />
        </div>
      )}

      {notStarted.length > 0 && (
        <div className="mt-6">
          <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mb-2">Not yet submitted by the tier below you</h2>
          <ApprovalsTable kpis={notStarted} interactive={false} />
        </div>
      )}

      <FeedbackTable kpis={mine} />
    </div>
  );
}
