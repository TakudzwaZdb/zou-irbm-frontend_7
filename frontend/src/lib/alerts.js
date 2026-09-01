// Computed client-side from data the user already has full read access to
// (their own real KPIs/values), using the exact same scope rules as the
// backend (see lib/scope.js) — not a separate notifications system, just a
// live summary of things already true in the real data.
import { canEnterData, canContribute, isApprover, computeRag, relevantKpis, ownerName } from './scope.js';

export function computeAlerts(org, kpis, values, settings, user, period, assignments, contributions = []) {
  const alerts = [];
  const key = (k) => `${k.id}-${period.year}-${period.month}`;

  kpis.forEach((k) => {
    const v = values[key(k)];
    if (canEnterData(user, k) && v?.return_comment && v.status === 'draft') {
      alerts.push({
        id: `returned-${k.id}`, kind: 'returned', route: 'entry',
        message: `"${k.name}" was returned to you: ${v.return_comment}`,
      });
    }
    // 'submitted' and 'programme_approved' are both "pending review"
    // statuses — the latter only ever applies to a Sub-programme's own KPI
    // once its Programme Head has forwarded it on to CPU. Passing v?.status
    // through to isApprover is what keeps this alert going to the RIGHT
    // person for whichever of the two stages the submission is actually at.
    if (['submitted', 'programme_approved'].includes(v?.status) && isApprover(org, user, k, v.status)) {
      alerts.push({
        id: `pending-${k.id}`, kind: 'pending', route: 'approvals',
        message: `"${k.name}" from ${ownerName(org, k)} is waiting on your review.`,
      });
    }
    // Your own contribution toward a shared Unit KPI was sent back by your
    // Unit Head — same "returned" alert as a normal KPI, one tier down.
    if (canContribute(user, k, assignments)) {
      const c = contributions.find((row) => row.kpi_id === k.id && row.individual_id === user.scope_id);
      if (c?.return_comment && c.status === 'draft') {
        alerts.push({
          id: `returned-contrib-${k.id}`, kind: 'returned', route: 'entry',
          message: `Your contribution to "${k.name}" was returned: ${c.return_comment}`,
        });
      }
    }
    // A Unit Head's own review queue, one tier below isApprover above: has
    // someone they assigned this KPI to submitted a figure that's waiting
    // on them specifically (not the Sub-programme Rep, who only sees the
    // combined total once the Unit Head submits it onward)?
    if (user.role === 'unithead' && k.owner_type === 'unit' && k.owner_id === user.scope_id) {
      const pendingContributor = contributions.find((row) => row.kpi_id === k.id && row.year === period.year && row.month === period.month && row.status === 'submitted');
      if (pendingContributor) {
        alerts.push({
          id: `pending-contrib-${k.id}`, kind: 'pending', route: 'approvals',
          message: `A contribution to "${k.name}" is waiting on your review.`,
        });
      }
    }
  });

  relevantKpis(org, kpis, user).forEach((k) => {
    const v = values[key(k)];
    if (!v || v.value == null) return;
    if (computeRag(k, v, settings).cls === 'chip-rag-red') {
      alerts.push({
        id: `offtrack-${k.id}`, kind: 'offtrack', route: 'overview',
        message: `"${k.name}" (${ownerName(org, k)}) is off track against its target.`,
      });
    }
  });

  return alerts;
}
