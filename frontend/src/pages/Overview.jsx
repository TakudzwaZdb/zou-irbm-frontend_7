import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import {
  relevantKpis, computeRag, canEnterData, canContribute, performanceRollup, varianceRollup, VARIANCE_ATTENTION_THRESHOLD, valueStatus, scopeBreadcrumb, MONTHS,
  byId, subsOfProgramme, unitsOfSub, individualsOfUnit, nodeOwnKpis, nodeAncestryChain, defaultNodeForRole, canDrillToKind, ownerName, ownerKindLabel,
} from '../lib/scope.js';
import { labelFor } from '../lib/period.js';
import KpiCard from '../components/KpiCard.jsx';
import RagBarChart from '../components/RagBarChart.jsx';
import RagPieChart from '../components/RagPieChart.jsx';
import VarianceChart from '../components/VarianceChart.jsx';
import VarianceAlerts from '../components/VarianceAlerts.jsx';
import PeriodTypePicker from '../components/PeriodTypePicker.jsx';

const KIND_LABEL = { programme: 'Programme', sub: 'Sub-programme', unit: 'Unit', individual: 'Individual' };

export default function Overview() {
  const { user, org, kpis, values, contributions, settings, period, assignments, selNode, selectNode, clearSelNode } = useApp();
  const isGlobal = ['cpu', 'exec', 'ictadmin', 'council'].includes(user.role);

  // The node the drill-down is actually showing: whatever's explicitly
  // selected (clicked in the sidebar tree or a card below), falling back to
  // a scoped role's own place in the structure, or — for a global role with
  // nothing selected — null, meaning "All Programmes". See lib/scope.js's
  // defaultNodeForRole and AppContext's selNode/selectNode.
  const forced = defaultNodeForRole(user);
  const effectiveNode = selNode || forced;

  // Anything YOU can act on that came back with feedback — a KPI you
  // strictly own, or (for an Individual) your own contribution toward a
  // shared Unit KPI your Unit Head assigned to you and then returned.
  const allRelevant = relevantKpis(org, kpis, user);
  const myReturned = allRelevant.filter((k) => canEnterData(user, k) && valueStatus(values[`${k.id}-${period.year}-${period.month}`]) === 'returned');
  const myReturnedContributions = allRelevant.filter((k) => {
    if (!canContribute(user, k, assignments)) return false;
    const row = contributions.find((c) => c.kpi_id === k.id && c.individual_id === user.scope_id);
    return valueStatus(row) === 'returned';
  });
  const totalReturned = myReturned.length + myReturnedContributions.length;

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Overview</h1>
          <p className="text-[13px] text-ink-secondary">{user.name} · {user.title || user.role}</p>
        </div>
        {!isGlobal && !effectiveNode && (
          <div className="text-[11.8px] text-ink-secondary text-right">
            {scopeBreadcrumb(org, user)?.join(' › ') || 'Showing KPIs within your reporting scope'}
          </div>
        )}
      </div>

      {totalReturned > 0 && (
        <div className="mb-4 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5 font-semibold">
          {totalReturned} of your submission{totalReturned > 1 ? 's were' : ' was'} returned with feedback — head to My Data Entry to review and resubmit.
        </div>
      )}

      {effectiveNode
        ? <NodeView node={effectiveNode} onHome={clearSelNode} onSelect={selectNode} />
        : <AllProgrammesView onSelect={selectNode} />}
    </div>
  );
}

// The automated Monthly/Quarterly/Bi-annual/Annual appraisal — every
// role sees this, for whatever's currently in view (their own place in the
// structure by default, "All Programmes" for a global role, or wherever
// they've drilled to): a live rollup of the SAME KPI value data as the
// monthly figures below it, just read at a coarser cadence via the
// performance lens (see lib/period.js's rangeFor/latestInRange — a
// quarter's "performance" is the latest actual value filed within it, not
// a separately-typed number). Changing the period here changes it
// everywhere else that reads perfPeriod too (every card's RAG dot, the
// sidebar tree's RAG dots). Nothing here is simulated — it's the exact
// same real kpi_values rows the monthly view reads, just aggregated by a
// wider date range.
function AppraisalCard({ kpiList, heading }) {
  const { org, settings, perfPeriod, perfValues } = useApp();
  if (kpiList.length === 0) return null;
  const appraisal = performanceRollup(kpiList, perfValues, settings);
  const label = labelFor(perfPeriod.type, perfPeriod.year, perfPeriod.idx, MONTHS);
  const variance = varianceRollup(kpiList, perfValues, settings);
  // Every KPI with a value gets its own bar here — never cut short by
  // chart width — labeled with both its own name AND who owns it (see
  // ownerName), since "Digital Theses Uploaded" means something different
  // depending on whether it's the Library's KPI or a named individual's.
  // VarianceChart scrolls horizontally once there are more KPIs than fit,
  // rather than squeezing bars until they're unreadable.
  // Full, untruncated name/owner — VarianceChart does its own short
  // truncation for the cramped on-chart label, but keeps the complete text
  // for its hover tooltip, so nothing is ever permanently cut off, only
  // shortened where space is genuinely tight.
  const varianceData = variance.items
    .filter((i) => i.actualPct != null)
    .map((i) => ({
      name: i.kpi.name, owner: ownerName(org, i.kpi), ownerKind: ownerKindLabel(i.kpi),
      actual: i.actualPct, expected: i.expectedPct, variance: i.variance, flag: i.flag,
    }));

  return (
    <div className="card mb-6">
      <div className="flex justify-between gap-4 flex-wrap items-start mb-2">
        <h2 className="font-display font-bold text-[14.5px]">{heading} — {label}</h2>
        <div className="no-print"><PeriodTypePicker /></div>
      </div>
      <div className="flex items-end gap-6 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-muted font-bold mb-0.5">Avg. progress</div>
          <div className="font-display font-extrabold text-[30px] tabular-nums">{appraisal.avgPct != null ? `${appraisal.avgPct}%` : '—'}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-muted font-bold mb-0.5">Avg. variance vs. pace</div>
          <div className={`font-display font-extrabold text-[30px] tabular-nums ${variance.avgVariance == null ? '' : variance.avgVariance <= VARIANCE_ATTENTION_THRESHOLD ? 'text-critical' : variance.avgVariance >= 10 ? 'text-good' : ''}`}>
            {variance.avgVariance == null ? '—' : `${variance.avgVariance > 0 ? '+' : ''}${variance.avgVariance}pts`}
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap pb-1.5">
          <span className="chip chip-rag-green">{appraisal.counts.green} on track</span>
          <span className="chip chip-rag-amber">{appraisal.counts.amber} at risk</span>
          <span className="chip chip-rag-red">{appraisal.counts.red} off track</span>
          {appraisal.counts.none > 0 && <span className="chip chip-rag-none">{appraisal.counts.none} no data</span>}
          {variance.attentionCount > 0 && <span className="chip bg-critical text-white">⚠ {variance.attentionCount} need attention</span>}
        </div>
      </div>
      <p className="text-[11.3px] text-ink-muted mt-2 mb-4">
        Automated from {appraisal.count} KPI{appraisal.count > 1 ? 's' : ''} — data entry stays monthly, this is
        just a rollup lens: switch Monthly/Quarterly/Bi-annual/Annual above and it recomputes from the real
        submitted values, live. Variance compares each KPI's actual progress to the pace expected as of the
        month its own latest value was recorded in{variance.avgExpectedPct != null ? ` (avg. ${variance.avgExpectedPct}% of the way there)` : ''} —
        a KPI on a straight line from baseline to target would read 0. Anything 10+ points behind that pace is
        flagged for attention below; 10+ points ahead is flagged too, just not as an alert.
      </p>

      {varianceData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-2">
          <div>
            <h3 className="text-[11.5px] uppercase tracking-wide text-ink-muted font-bold mb-1.5">RAG distribution — {label}</h3>
            <RagPieChart counts={appraisal.counts} height={220} />
          </div>
          <div>
            <h3 className="text-[11.5px] uppercase tracking-wide text-ink-muted font-bold mb-1.5">Actual vs. expected pace — {label}</h3>
            <VarianceChart data={varianceData} height={220} />
          </div>
        </div>
      )}

      <VarianceAlerts items={variance.items} periodLabel={label} />
    </div>
  );
}

function AllProgrammesView({ onSelect }) {
  const { org, kpis, values, settings, period, perfValues } = useApp();
  const list = kpis; // global default view — every KPI, every tier
  const counts = { draft: 0, submitted: 0, approved: 0, none: 0, returned: 0 };
  const ragCounts = { green: 0, amber: 0, red: 0, none: 0 };
  list.forEach((k) => {
    const v = values[`${k.id}-${period.year}-${period.month}`];
    counts[valueStatus(v)]++;
    ragCounts[computeRag(k, v, settings).cls.replace('chip-rag-', '')]++;
  });
  // "All Programmes" is the university-wide root of the same cascade every
  // other node uses (see lib/scope.js's nodeOwnKpis) — every KPI in the
  // system belongs to exactly one Programme's subtree, so this is simply
  // every KPI there is. This is also, genuinely, "overall institutional
  // performance" — not a separately computed figure, the exact same live
  // rollup every Programme/Sub-programme/Unit card below already uses, just
  // read at the top of the whole tree instead of one branch of it.
  const appraisalKpis = kpis;
  const owner = org.executiveOwner;

  return (
    <>
      {owner && (
        <div className="mb-4 rounded-lg bg-accent-50 text-accent-600 text-[12px] px-3.5 py-2.5">
          <b>Executive Owner: {owner.name}</b>{owner.title ? ` — ${owner.title}` : ''} is accountable for overall
          institutional performance against the Plan — the appraisal below, aggregated across every Programme.
        </div>
      )}
      <AppraisalCard kpiList={appraisalKpis} heading="Overall Institutional Performance — All Programmes" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        <Stat label="KPIs in view" value={list.length} />
        <Stat label={`Approved (${MONTHS[period.month]} ${period.year})`} value={counts.approved} className="text-good" />
        <Stat label="Awaiting review" value={counts.submitted} className="text-accent-500" />
        <Stat label="Returned / not started" value={counts.returned + counts.draft + counts.none} className={counts.returned > 0 ? 'text-warning' : 'text-ink-muted'} />
      </div>

      <div className="card mb-6">
        <h2 className="font-display font-bold text-[14.5px] mb-2">RAG distribution — {MONTHS[period.month]} {period.year}</h2>
        <RagBarChart counts={ragCounts} />
      </div>

      <h2 className="font-display font-bold text-[14.5px] mb-2.5">Programmes</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {org.programmes.map((p) => (
          <NodeCard key={p.id} kind="programme" node={p} subtitle={p.head} org={org} kpis={kpis} perfValues={perfValues} settings={settings} onSelect={onSelect} />
        ))}
      </div>
    </>
  );
}

// One node's drill-down: its own breadcrumb, its own headline stats, its
// own-tier KPIs in full (KpiCard, read-only — data entry happens on My Data
// Entry, never here), and its children one click further in.
function NodeView({ node, onHome, onSelect }) {
  const { org, kpis, values, settings, period, perfValues, user, hiddenKpiIds } = useApp();
  const [showHidden, setShowHidden] = useState(false);
  const { kind, id } = node;
  const entity =
    kind === 'programme' ? byId(org.programmes, id) :
    kind === 'sub' ? byId(org.subs, id) :
    kind === 'unit' ? byId(org.units, id) :
    byId(org.individuals, id);

  if (!entity) {
    return <div className="card text-center text-ink-muted py-10">That part of the structure is no longer available.</div>;
  }

  const chain = nodeAncestryChain(org, kind, id);
  const ownKpis = nodeOwnKpis(org, kpis, kind, id);
  // See the comment further down — an Individual landing on their OWN
  // record also gets their Unit's KPIs shown, read-only, beneath their own.
  const isOwnIndividualNode = kind === 'individual' && user.role === 'individual' && id === user.scope_id;
  const unitKpisForContext = isOwnIndividualNode ? nodeOwnKpis(org, kpis, 'unit', entity.unit_id) : [];
  // A personal declutter, never a data change — the headline stats/RAG
  // chart above still read from the FULL ownKpis list (see below), so
  // hiding something never makes this node's real, shared numbers look
  // different to anyone. Only the actual list of cards rendered is
  // filtered, and only for the person who chose to hide them.
  const ownKpisVisible = showHidden ? ownKpis : ownKpis.filter((k) => !hiddenKpiIds.has(k.id));
  const ownKpisHiddenCount = ownKpis.length - ownKpis.filter((k) => !hiddenKpiIds.has(k.id)).length;
  const unitKpisVisible = showHidden ? unitKpisForContext : unitKpisForContext.filter((k) => !hiddenKpiIds.has(k.id));
  const unitKpisHiddenCount = unitKpisForContext.length - unitKpisForContext.filter((k) => !hiddenKpiIds.has(k.id)).length;
  const counts = { draft: 0, submitted: 0, approved: 0, none: 0, returned: 0 };
  const ragCounts = { green: 0, amber: 0, red: 0, none: 0 };
  ownKpis.forEach((k) => {
    const v = values[`${k.id}-${period.year}-${period.month}`];
    counts[valueStatus(v)]++;
    ragCounts[computeRag(k, v, settings).cls.replace('chip-rag-', '')]++;
  });

  const subtitle =
    kind === 'programme' ? entity.head :
    kind === 'sub' ? `${entity.unit_label || 'Unit'}-level sub-programme · ${entity.head}` :
    kind === 'unit' ? entity.head :
    entity.role_title;
  const kindLabel = kind === 'unit' ? (entity.kind || 'Unit') : KIND_LABEL[kind];

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-ink-muted mb-2">
        <button className="hover:text-accent-500 hover:underline" onClick={onHome}>Home</button>
        <span>/</span>
        <span>All Programmes</span>
        {chain.slice(0, -1).map((c) => (
          <span key={`${c.kind}-${c.id}`} className="flex items-center gap-1.5">
            <span>/</span>
            <span>{c.name}</span>
          </span>
        ))}
        {chain.length > 0 && <span className="flex items-center gap-1.5"><span>/</span><b className="text-ink-secondary">{chain[chain.length - 1].name}</b></span>}
      </div>

      <div className="flex justify-between gap-4 flex-wrap items-start mb-4">
        <div>
          <h2 className="text-lg font-bold mb-0.5">{entity.name}</h2>
          <p className="text-[12.5px] text-ink-secondary">{kindLabel} · {subtitle}</p>
        </div>
      </div>

      <AppraisalCard kpiList={ownKpis} heading="Performance appraisal" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        <Stat label={kind === 'individual' ? 'Own KPIs' : 'KPIs (incl. below)'} value={ownKpis.length} />
        <Stat label={`Approved (${MONTHS[period.month]} ${period.year})`} value={counts.approved} className="text-good" />
        <Stat label="Awaiting review" value={counts.submitted} className="text-accent-500" />
        <Stat label="Returned / not started" value={counts.returned + counts.draft + counts.none} className={counts.returned > 0 ? 'text-warning' : 'text-ink-muted'} />
      </div>

      {ownKpis.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-display font-bold text-[14.5px] mb-2">RAG distribution</h2>
          <RagBarChart counts={ragCounts} />
        </div>
      )}

      {kind === 'programme' && (
        <div className="mb-4 rounded-lg bg-accent-50 text-accent-600 text-[12px] px-3.5 py-2.5">
          A Programme's score is the combined average of everything beneath it — its Sub-programmes' own KPIs, and every
          Unit's and Individual's KPI within them — a Programme never owns KPIs directly.
        </div>
      )}
      {kind === 'sub' && (
        <div className="mb-4 rounded-lg bg-accent-50 text-accent-600 text-[12px] px-3.5 py-2.5">
          A Sub-programme's score is the combined average of its own KPIs plus every Unit's and Individual's KPI beneath it.
        </div>
      )}
      {kind === 'unit' && (
        <div className="mb-4 rounded-lg bg-accent-50 text-accent-600 text-[12px] px-3.5 py-2.5">
          A Unit's score is the combined average of its own KPIs plus every Individual's KPI within it.
        </div>
      )}
      {kind === 'individual' && (
        <div className="mb-4 rounded-lg bg-accent-50 text-accent-600 text-[12px] px-3.5 py-2.5">
          Individual targets are the 4th tier of the hierarchy (Programme → Sub-programme → Unit → Individual) — a real
          number here moves their Unit's score, which moves their Sub-programme's, which moves their Programme's.
        </div>
      )}

      {ownKpis.length > 0 && (
        <>
          <div className="flex justify-between items-center gap-2 flex-wrap mb-2.5">
            <h2 className="font-display font-bold text-[14.5px]">
              {kind === 'individual' ? 'Individual KPIs' : `KPIs in this ${KIND_LABEL[kind]}`}
            </h2>
            {ownKpisHiddenCount > 0 && (
              <button className="text-[11.5px] text-accent-500 hover:underline" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? 'Hide the ones you hid again' : `${ownKpisHiddenCount} hidden from your view — show`}
              </button>
            )}
          </div>
          {ownKpisVisible.map((k) => <KpiCard key={k.id} kpi={k} mode="readOnly" allowHide />)}
        </>
      )}

      {/* An Individual lands here by default on their own record — also show
          their own Unit/Department/Faculty/Regional-Campus's KPIs, read-only,
          so "what is my unit being measured on" is visible without an extra
          click (this is the same scope Entry/Approvals/alerts already treat
          as relevant to them — see lib/scope.js's relevantKpis). Landing on
          someone ELSE's individual record (drilled in from their Unit) skips
          this — it's their own personal targets you're looking at, not a
          detour back into the whole unit. */}
      {unitKpisForContext.length > 0 && (
        <>
          <div className="flex justify-between items-center gap-2 flex-wrap mt-6 mb-2.5">
            <h2 className="font-display font-bold text-[14.5px]">Your Unit's KPIs</h2>
            {unitKpisHiddenCount > 0 && (
              <button className="text-[11.5px] text-accent-500 hover:underline" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? 'Hide the ones you hid again' : `${unitKpisHiddenCount} hidden from your view — show`}
              </button>
            )}
          </div>
          {unitKpisVisible.map((k) => <KpiCard key={k.id} kpi={k} mode="readOnly" allowHide />)}
        </>
      )}

      {kind === 'sub' && (canDrillToKind(user, 'unit')
        ? <ChildCards kind="unit" items={unitsOfSub(org, id)} subtitleFn={(u) => `${u.kind || 'Unit'} · ${u.head}`} onSelect={onSelect} />
        : <OverviewRestrictedNote label="Unit" />)}
      {kind === 'unit' && (canDrillToKind(user, 'individual')
        ? <ChildCards kind="individual" items={individualsOfUnit(org, id)} subtitleFn={(i) => i.role_title} onSelect={onSelect} />
        : <OverviewRestrictedNote label="Individual" />)}
      {kind === 'programme' && (canDrillToKind(user, 'sub')
        ? <ChildCards kind="sub" items={subsOfProgramme(org, id)} subtitleFn={(s) => s.head} onSelect={onSelect} />
        : <OverviewRestrictedNote label="Sub-programme" />)}

      {kind === 'individual' && ownKpis.length === 0 && unitKpisForContext.length === 0 && (
        <div className="card text-center text-ink-muted py-10">No KPIs recorded for this individual yet.</div>
      )}
    </div>
  );
}

// Shown instead of a tier's ChildCards when this account's Overview
// navigation is capped short of it (see lib/scope.js's canDrillToKind /
// users.overview_limit) — transparent about WHY nothing further is
// clickable here, rather than the section just silently not appearing.
function OverviewRestrictedNote({ label }) {
  return (
    <div className="mt-6 rounded-lg bg-sunken text-ink-muted text-[11.8px] px-3.5 py-2.5">
      🔒 {label}-level detail is restricted for your account by your ICT System Administrator — you can see this
      tier's own rollup above, but not drill further in.
    </div>
  );
}

function ChildCards({ kind, items, subtitleFn, onSelect }) {
  const { org, kpis, perfValues, settings } = useApp();
  if (items.length === 0) return null;
  const heading = kind === 'unit' ? 'Units' : kind === 'individual' ? 'Individuals' : 'Sub-programmes';
  return (
    <>
      <h2 className="font-display font-bold text-[14.5px] mt-6 mb-2.5">
        {heading} <span className="text-ink-muted font-normal text-[12px]">— shown for context, not summed into the score above</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {items.map((item) => (
          <NodeCard key={item.id} kind={kind} node={item} subtitle={subtitleFn(item)} org={org} kpis={kpis} perfValues={perfValues} settings={settings} onSelect={onSelect} />
        ))}
      </div>
    </>
  );
}

function NodeCard({ kind, node, subtitle, org, kpis, perfValues, settings, onSelect }) {
  const roll = performanceRollup(nodeOwnKpis(org, kpis, kind, node.id), perfValues, settings);
  return (
    <button
      onClick={() => onSelect(kind, node.id)}
      className="card text-left hover:border-accent-300 transition-colors"
    >
      <div className="flex justify-between gap-2 items-start">
        <div className="min-w-0">
          <div className="font-display font-bold text-[13.5px] truncate">{node.name}</div>
          <div className="text-[11px] text-ink-muted truncate mt-0.5">{subtitle}</div>
        </div>
        <RagChip rollup={roll} settings={settings} />
      </div>
      <div className="h-1.5 rounded-full bg-sunken overflow-hidden mt-3">
        <div
          className={`h-full ${roll.avgPct == null ? 'bg-sunken' : roll.avgPct >= Number(settings.ragGreen ?? 80) ? 'bg-good' : roll.avgPct >= Number(settings.ragAmber ?? 50) ? 'bg-warning' : 'bg-critical'}`}
          style={{ width: `${Math.max(2, Math.min(100, roll.avgPct || 0))}%` }}
        />
      </div>
      <div className="text-[11px] text-ink-muted mt-1.5">
        {roll.avgPct != null ? `${roll.avgPct}% average progress` : 'No data yet'} · {roll.counts.green} green · {roll.counts.amber} amber · {roll.counts.red} red
      </div>
    </button>
  );
}

function RagChip({ rollup, settings }) {
  const cls = rollup.avgPct == null ? 'chip-rag-none' : rollup.avgPct >= Number(settings.ragGreen ?? 80) ? 'chip-rag-green' : rollup.avgPct >= Number(settings.ragAmber ?? 50) ? 'chip-rag-amber' : 'chip-rag-red';
  return <span className={`chip ${cls} flex-none`}>{rollup.avgPct != null ? `${rollup.avgPct}%` : '—'}</span>;
}

function Stat({ label, value, className = '' }) {
  return (
    <div className="card flex flex-col gap-1">
      <span className="text-[11.5px] uppercase tracking-wide text-ink-muted font-bold">{label}</span>
      <span className={`font-display font-extrabold text-[26px] tabular-nums ${className}`}>{value}</span>
    </div>
  );
}
