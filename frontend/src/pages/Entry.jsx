import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { canEnterData, canContribute, individualUnitId, valueStatus } from '../lib/scope.js';
import ContributionCard from '../components/ContributionCard.jsx';
import DataEntryTable from '../components/DataEntryTable.jsx';
import PeriodPicker from '../components/PeriodPicker.jsx';
import SubmissionWindowBanner from '../components/SubmissionWindowBanner.jsx';

// Grouped so the flow reads as a queue rather than one flat list: anything
// returned with feedback or never started needs action right now, what's
// submitted is out of your hands, and what's approved is done for the period.
//
// Two distinct kinds of "mine" now, shown as two distinct kinds of card:
// KPIs you strictly own (canEnterData — the classic value-entry form), and
// KPIs you've been assigned as a contributor to (canContribute — a shared
// Unit KPI several people submit their own figure toward, reviewed by your
// Unit Head before it's summed into the KPI's real value). Same queue
// shape either way, since "needs action / submitted / approved" reads the
// same regardless of which kind it is.
export default function Entry() {
  const { user, org, kpis, templates, values, contributions, period, assignments } = useApp();
  const mine = kpis.filter((k) => canEnterData(user, k));
  const contributed = kpis.filter((k) => canContribute(user, k, assignments));
  const statusOf = (k) => valueStatus(values[`${k.id}-${period.year}-${period.month}`]);
  const contribRowFor = (k) => contributions.find((c) => c.kpi_id === k.id && c.individual_id === user.scope_id) || null;
  const contribStatusOf = (k) => valueStatus(contribRowFor(k));

  // The Unit-scoped "KPI for individuals" pool that applies to this
  // person's own unit and that they haven't picked up yet (see
  // AppContext's `templates` / routes/kpiTemplates.js) — genuinely created
  // FOR individuals, unlike a Unit-owned KPI which belongs to the Unit
  // itself. Picking one up (POST /kpi-templates/:id/pick) creates a real,
  // independent KPI owned by this person alone — not a shared figure like
  // the contribution pipeline above.
  const myUnitId = user.role === 'individual' ? individualUnitId(org, user.scope_id) : null;
  const pickable = myUnitId != null
    ? templates.filter((t) => t.unit_id === myUnitId && !mine.some((k) => k.template_id === t.id))
    : [];

  const needsAction = mine.filter((k) => ['returned', 'none', 'draft'].includes(statusOf(k)));
  const submitted = mine.filter((k) => statusOf(k) === 'submitted');
  const approved = mine.filter((k) => statusOf(k) === 'approved');

  const contribNeedsAction = contributed.filter((k) => ['returned', 'none', 'draft'].includes(contribStatusOf(k)));
  const contribSubmitted = contributed.filter((k) => contribStatusOf(k) === 'submitted');
  const contribApproved = contributed.filter((k) => contribStatusOf(k) === 'approved');

  const totalNeedsAction = needsAction.length + contribNeedsAction.length;
  const totalSubmitted = submitted.length + contribSubmitted.length;
  const totalApproved = approved.length + contribApproved.length;
  const totalReturned = mine.filter((k) => statusOf(k) === 'returned').length + contributed.filter((k) => contribStatusOf(k) === 'returned').length;
  const totalCount = mine.length + contributed.length;

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">My Data Entry</h1>
          <p className="text-[13px] text-ink-secondary">
            {totalCount === 0
              ? 'No KPIs are assigned to you for direct data entry.'
              : `${totalNeedsAction} need action · ${totalSubmitted} awaiting review · ${totalApproved} approved this period`}
          </p>
        </div>
        <PeriodPicker />
      </div>

      <SubmissionWindowBanner />

      {totalReturned > 0 && (
        <div className="mb-4 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5 font-semibold">
          {totalReturned} submission{totalReturned > 1 ? 's were' : ' was'} returned with feedback — see below.
        </div>
      )}

      {needsAction.length > 0 && (
        <TableSection title="Needs your action" kpis={needsAction} interactive />
      )}
      {contribNeedsAction.length > 0 && (
        <ContribSection title="Your contributions needing action" kpis={contribNeedsAction} rowFor={contribRowFor} />
      )}
      {submitted.length > 0 && (
        <TableSection title="Submitted — awaiting review" kpis={submitted} interactive={false} collapsible />
      )}
      {contribSubmitted.length > 0 && (
        <ContribSection title="Your contributions — awaiting your Unit Head's review" kpis={contribSubmitted} rowFor={contribRowFor} collapsible />
      )}
      {approved.length > 0 && (
        <TableSection title="Approved this period" kpis={approved} interactive={false} collapsible />
      )}
      {contribApproved.length > 0 && (
        <ContribSection title="Your contributions — approved this period" kpis={contribApproved} rowFor={contribRowFor} collapsible />
      )}
      {totalCount === 0 && pickable.length === 0 && <div className="card text-center text-ink-muted py-10">No KPIs are assigned to you for direct data entry.</div>}

      {pickable.length > 0 && <TemplatesSection templates={pickable} />}
    </div>
  );
}

// The Individual-KPI pool: every KPI genuinely created for this person's
// own unit's individuals (see Framework.jsx's "Individuals (under a unit)"
// owner type / routes/kpiTemplates.js) that they haven't picked up yet.
// Deliberately NOT "every KPI the unit owns" any more — that was the old
// self-claim behavior, and it let an Individual volunteer into their Unit
// Head's own aggregate KPI just by browsing it. Picking one here instead
// calls POST /kpi-templates/:id/pick, which creates a brand-new KPI owned
// solely by this person — their own independent figure, never summed with
// anyone else's — and it appears above under "Needs your action" the
// moment the core data reloads.
function TemplatesSection({ templates }) {
  const { reloadCore } = useApp();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  async function pick(t) {
    setBusyId(t.id);
    try {
      await api(`/kpi-templates/${t.id}/pick`, { method: 'POST' });
      toast(`"${t.name}" added — it's now your own personal KPI to enter data for.`);
      await reloadCore();
    } catch (err) { toast(err.message, 'err'); } finally { setBusyId(null); }
  }

  return (
    <div className="mb-5">
      <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mb-2">KPIs for individuals in your unit</h2>
      <p className="text-[12px] text-ink-muted mb-2.5 max-w-[60ch]">
        Created for people in your unit — add one if it's part of what you do. Each one becomes your own personal KPI
        with its own figure; nothing here is shared with anyone else in your unit.
      </p>
      {templates.map((t) => (
        <div key={t.id} className="card mb-2.5 flex justify-between gap-3 items-center flex-wrap">
          <div>
            <p className="font-bold text-[13.6px] mb-1">{t.name}</p>
            <span className="chip chip-tag">{t.type}</span>
          </div>
          <button className="btn btn-sm btn-primary" disabled={busyId === t.id} onClick={() => pick(t)}>
            This is mine — add it
          </button>
        </div>
      ))}
    </div>
  );
}

// collapsible: same hideable pattern as ApprovalsTable's FeedbackTable —
// used on the "Submitted"/"Approved" sections (a settled record you check
// back on sometimes, not something needing action) so a long-running
// period's queue doesn't force scrolling past done work to reach what
// still needs it. "Needs your action" never gets this prop, so it always
// stays visible.
function TableSection({ title, kpis, interactive, collapsible }) {
  const [visible, setVisible] = useState(!collapsible);
  return (
    <div className="mb-5">
      <SectionHeading title={title} count={kpis.length} collapsible={collapsible} visible={visible} onToggle={() => setVisible((v) => !v)} />
      {visible && <DataEntryTable kpis={kpis} interactive={interactive} />}
    </div>
  );
}

function ContribSection({ title, kpis, rowFor, collapsible }) {
  const [visible, setVisible] = useState(!collapsible);
  return (
    <div className="mb-5">
      <SectionHeading title={title} count={kpis.length} collapsible={collapsible} visible={visible} onToggle={() => setVisible((v) => !v)} />
      {visible && kpis.map((k) => <ContributionCard key={k.id} kpi={k} contributionRow={rowFor(k)} />)}
    </div>
  );
}

function SectionHeading({ title, count, collapsible, visible, onToggle }) {
  if (!collapsible) {
    return <h2 className="font-display font-bold text-[13.5px] text-ink-secondary mb-2">{title}</h2>;
  }
  return (
    <button
      className="font-display font-bold text-[13.5px] text-ink-secondary mb-2 flex items-center gap-1.5 hover:text-accent-600"
      onClick={onToggle}
    >
      {visible ? '▾' : '▸'} {title} ({count}) {visible ? '— hide' : '— show'}
    </button>
  );
}
