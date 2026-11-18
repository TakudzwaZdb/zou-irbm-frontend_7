import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import PaginatedRows from '../components/PaginatedRows.jsx';
import { yearRange } from '../lib/scope.js';

const STATUS_LABEL = { draft: 'Draft', returned: 'Returned', submitted: 'Submitted', approved: 'Approved' };

// A plan proposal's status column only ever stores draft/submitted/approved
// (same as kpi_values) — a return sets it back to draft with a comment
// attached — so this distinguishes "returned with feedback" for display,
// exactly like lib/scope.js's valueStatus does for KPI values.
function planStatus(p) {
  if (!p) return 'draft';
  if (p.status === 'draft' && p.return_comment) return 'returned';
  return p.status;
}
function fmtMoney(n) {
  if (n == null || n === '') return '—';
  const amount = Number(n);
  if (!Number.isFinite(amount)) return '—';
  return '$' + Math.round(amount).toLocaleString('en-US');
}

// The PDF uses the same scoped plan data as the page, and includes the
// narrative, targets, and requested budget for every submitted or approved
// proposal. Draft and returned proposals are not treated as actual plans.
async function downloadPlanPdf(data, cycleYear) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const navy = [22, 38, 62];
  const blue = [39, 105, 166];
  const pale = [244, 247, 250];
  const line = [220, 226, 233];
  const ink = [37, 46, 58];
  const muted = [101, 114, 129];
  const reportDate = new Date().toLocaleString();
  const submittedStatuses = new Set(['submitted', 'approved']);
  let y = 46;

  const rows = [];
  const planBudgetValues = [];
  const addProposal = (tier, name, proposal) => {
    if (!submittedStatuses.has(proposal?.status)) return;
    if (proposal.budget != null && Number.isFinite(Number(proposal.budget))) {
      planBudgetValues.push(Number(proposal.budget));
    }
    rows.push([
      `${proposal.plan_title || 'Untitled plan'}\n${tier}: ${name}`,
      STATUS_LABEL[proposal.status],
      proposal.submitted_at ? String(proposal.submitted_at).replace('T', ' ').slice(0, 16) : '—',
      proposal.narrative || '—',
      proposal.targets || '—',
      fmtMoney(proposal.budget),
    ]);
  };

  (data.university.proposals || (data.university.proposal ? [data.university.proposal] : []))
    .forEach((proposal) => addProposal('University', 'Annual Plan', proposal));
  data.programmes.forEach((programme) => {
    (programme.proposals || (programme.proposal ? [programme.proposal] : []))
      .forEach((proposal) => addProposal('Programme', programme.name, proposal));
    data.subs.filter((sub) => sub.programme_id === programme.id).forEach((sub) => {
      (sub.proposals || (sub.proposal ? [sub.proposal] : []))
        .forEach((proposal) => addProposal('Sub-programme', sub.name, proposal));
      data.units.filter((unit) => unit.sub_id === sub.id).forEach((unit) => {
        (unit.proposals || (unit.proposal ? [unit.proposal] : []))
          .forEach((proposal) => addProposal('Unit', unit.name, proposal));
      });
    });
  });

  const submittedCount = rows.filter((row) => row[1] === STATUS_LABEL.submitted).length;
  const approvedCount = rows.length - submittedCount;
  const targetCount = rows.filter((row) => row[4] !== '—').length;
  const planBudgetTotal = planBudgetValues.length
    ? fmtMoney(planBudgetValues.reduce((sum, budget) => sum + budget, 0))
    : '—';

  doc.setFillColor(...navy);
  doc.rect(0, 0, pageWidth, 86, 'F');
  doc.setFillColor(...blue);
  doc.roundedRect(marginX, 20, 38, 38, 7, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('ZOU', marginX + 19, 44, { align: 'center' });
  doc.setFontSize(17);
  doc.text('Annual Plan Submission Report', marginX + 50, 37);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(216, 226, 238);
  doc.text(`${cycleYear} cycle  ·  Submitted and approved proposals`, marginX + 50, 54);
  doc.text(`Generated ${reportDate}`, pageWidth - marginX, 54, { align: 'right' });

  const cardY = 103;
  const cardGap = 9;
  const cardWidth = (pageWidth - marginX * 2 - cardGap * 3) / 4;
  const summaryCards = [
    { label: 'AWAITING CPU', value: String(submittedCount), color: [180, 95, 20] },
    { label: 'APPROVED', value: String(approvedCount), color: [36, 125, 83] },
    { label: 'WITH TARGETS', value: String(targetCount), color: blue },
    { label: 'PLAN BUDGET TOTAL', value: planBudgetTotal, color: navy },
  ];
  summaryCards.forEach((card, index) => {
    const x = marginX + index * (cardWidth + cardGap);
    doc.setFillColor(...pale);
    doc.setDrawColor(...line);
    doc.roundedRect(x, cardY, cardWidth, 53, 5, 5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(card.label, x + 9, cardY + 15);
    doc.setFontSize(card.value.length > 12 ? 10 : 14);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 9, cardY + 38);
  });

  y = cardY + 74;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text('PROPOSAL DETAILS', marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...muted);
  doc.text('Draft and returned proposals are excluded. The summary totals submitted and approved budgets across tiers.', marginX, y + 14);
  y += 22;

  if (rows.length === 0) {
    doc.setFillColor(...pale);
    doc.setDrawColor(...line);
    doc.roundedRect(marginX, y, pageWidth - marginX * 2, 60, 5, 5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...ink);
    doc.text('No submitted or approved plans for this cycle', marginX + 14, y + 25);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...muted);
    doc.text('Once a plan is submitted, its narrative, targets, and budget will appear in this report.', marginX + 14, y + 42);
  } else {
    autoTable(doc, {
      startY: y,
      margin: { top: 58, bottom: 42, left: marginX, right: marginX },
      head: [['PLAN / TIER', 'STATUS', 'SUBMITTED (UTC)', 'PLAN NARRATIVE', 'TARGETS / OUTCOMES', 'BUDGET (USD)']],
      body: rows,
      styles: {
        font: 'helvetica', fontSize: 7.7, textColor: ink, cellPadding: 5,
        valign: 'top', overflow: 'linebreak', lineColor: line, lineWidth: 0.35,
      },
      alternateRowStyles: { fillColor: [249, 250, 252] },
      columnStyles: {
        0: { cellWidth: 84, fontStyle: 'bold' },
        1: { cellWidth: 50, fontStyle: 'bold', halign: 'center' },
        2: { cellWidth: 62 },
        3: { cellWidth: 118 },
        4: { cellWidth: 126 },
        5: { cellWidth: 75, halign: 'right', fontStyle: 'bold' },
      },
      headStyles: { fillColor: navy, textColor: 255, fontStyle: 'bold', fontSize: 7.5, cellPadding: 6 },
      didParseCell(cell) {
        if (cell.section === 'body' && cell.column.index === 1) {
          if (cell.cell.raw === STATUS_LABEL.submitted) {
            cell.cell.styles.fillColor = [255, 244, 224];
            cell.cell.styles.textColor = [142, 80, 14];
          } else if (cell.cell.raw === STATUS_LABEL.approved) {
            cell.cell.styles.fillColor = [228, 245, 235];
            cell.cell.styles.textColor = [36, 112, 74];
          }
        }
      },
      didDrawPage() {
        const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
        if (pageNumber > 1) {
          doc.setFillColor(...navy);
          doc.rect(0, 0, pageWidth, 42, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(255, 255, 255);
          doc.text('ZOU  |  ANNUAL PLAN SUBMISSION REPORT', marginX, 26);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(216, 226, 238);
          doc.text(`${cycleYear} cycle`, pageWidth - marginX, 26, { align: 'right' });
        }
      },
    });
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...line);
    doc.line(marginX, pageHeight - 31, pageWidth - marginX, pageHeight - 31);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text('ZOU Strategic Plan Monitor  ·  Annual Plan & Budget', marginX, pageHeight - 18);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX, pageHeight - 18, { align: 'right' });
  }

  doc.save(`zou-annual-plan-${cycleYear}.pdf`);
}

// The annual planning & budget cycle: scoped users can create and batch-submit
// multiple named plan rows with independent budgets and measurable targets;
// CPU approves each submitted row — see
// backend/src/routes/plans.js.
export default function Planning() {
  const { user } = useApp();
  const toast = useToast();
  const now = new Date().getFullYear();
  const [cycleYear, setCycleYear] = useState(now + 1);
  const [data, setData] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function load(year) {
    try { setData(await api(`/plans?year=${year ?? cycleYear}`)); } catch (err) { toast(err.message, 'err'); }
  }
  useEffect(() => { load(cycleYear); }, [cycleYear]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onDownloadPdf() {
    setPdfBusy(true);
    try { await downloadPlanPdf(data, cycleYear); }
    catch { toast('Could not generate the PDF. Check your connection and try again.', 'err'); }
    finally { setPdfBusy(false); }
  }

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Annual Plan &amp; Budget</h1>
          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            Create separate named plans for this cycle, with a plan narrative, budget and/or measurable targets.
            Select several draft rows to save and submit them together; CPU reviews and approves each submitted plan.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select className="field-input w-auto" value={cycleYear} onChange={(e) => setCycleYear(Number(e.target.value))}>
            {yearRange(now).map((y) => <option key={y} value={y}>{y} cycle</option>)}
          </select>
          <button className="btn btn-sm btn-primary" disabled={!data || pdfBusy} onClick={onDownloadPdf}>
            {pdfBusy ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {!data && <div className="text-ink-muted text-[13px]">Loading…</div>}
      {data && user.role === 'unithead' && <UnitPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && user.role === 'rep' && <RepPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && user.role === 'programme' && <ProgrammeHeadPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && user.role === 'cpu' && <CpuPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && user.role === 'council' && <CouncilPanel data={data} cycleYear={cycleYear} />}
      {data && ['exec', 'vc', 'ictadmin', 'employee'].includes(user.role) && <ReadOnlyPanel data={data} />}
    </div>
  );
}

function UnitPanel({ data, cycleYear, reload }) {
  const { user } = useApp();
  const unit = data.units.find((u) => u.id === user.scope_id);
  if (!unit) return <div className="card text-center text-ink-muted py-8">Your unit couldn't be found in the org structure.</div>;
  return (
    <PlanItemsEditor ownerType="unit" ownerId={unit.id} ownerName={unit.name} proposals={unit.proposals || (unit.proposal ? [unit.proposal] : [])} cycleYear={cycleYear} reload={reload} />
  );
}

function RepPanel({ data, cycleYear, reload }) {
  const { user } = useApp();
  const sub = data.subs.find((s) => s.id === user.scope_id);
  const myUnits = data.units.filter((u) => u.sub_id === user.scope_id);

  if (!sub) return <div className="card text-center text-ink-muted py-8">Your sub-programme couldn't be found in the org structure.</div>;

  return (
    <div>
      <div className="card mb-4">
        <h2 className="font-display font-bold text-[14.5px] mb-2.5">Unit plans in {sub.name} — {cycleYear}</h2>
        {myUnits.length === 0
          ? <p className="text-[12.5px] text-ink-muted">No units under your sub-programme yet.</p>
          : myUnits.map((unit) => (
            <div key={unit.id} className="mb-4 last:mb-0">
              <h3 className="font-semibold text-[13px] mb-1">{unit.name}</h3>
              <ReadOnlyPlanRows proposals={unit.proposals || (unit.proposal ? [unit.proposal] : [])} />
            </div>
          ))}
      </div>
      <PlanItemsEditor ownerType="sub" ownerId={sub.id} ownerName={sub.name} proposals={sub.proposals || (sub.proposal ? [sub.proposal] : [])} cycleYear={cycleYear} reload={reload} />
    </div>
  );
}

function PlanItemsEditor({ ownerType, ownerId, ownerName, proposals, cycleYear, reload }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [drafts, setDrafts] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tableOpen, setTableOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newPlan, setNewPlan] = useState({ planTitle: '', narrative: '', budget: '', targets: '' });

  useEffect(() => {
    setDrafts(Object.fromEntries(proposals.map((proposal) => [proposal.id, {
      id: proposal.id,
      planTitle: proposal.plan_title || '',
      narrative: proposal.narrative || '',
      budget: proposal.budget ?? '',
      targets: proposal.targets || '',
    }])));
    setSelected(new Set());
  }, [proposals]);

  function updateDraft(id, field, value) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  function itemDraft(proposal) {
    return drafts[proposal.id] || {
      id: proposal.id,
      planTitle: proposal.plan_title || '',
      narrative: proposal.narrative || '',
      budget: proposal.budget ?? '',
      targets: proposal.targets || '',
    };
  }

  function openAddModal() {
    setNewPlan((current) => current.planTitle.trim()
      ? current
      : { planTitle: `Plan ${proposals.length + 1}`, narrative: '', budget: '', targets: '' });
    setAddOpen(true);
  }

  function closeAddModal() {
    setAddOpen(false);
    setTableOpen(true);
  }

  async function addPlan(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api('/plans/items', {
        method: 'POST',
        body: { ownerType, ownerId, cycleYear, ...newPlan },
      });
      const item = { id: result.proposal.id, ...newPlan };
      await api('/plans/items/drafts', { method: 'PUT', body: { items: [item] } });
      setDrafts((current) => ({ ...current, [item.id]: item }));
      setExpandedId(null);
      setTableOpen(true);
      setNewPlan({ planTitle: '', narrative: '', budget: '', targets: '' });
      toast('Draft plan added. You can add another or close this window.');
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  async function saveDrafts() {
    const items = proposals.filter((proposal) => proposal.status === 'draft').map(itemDraft);
    if (!items.length) { toast('There are no draft plans to save.', 'err'); return; }
    setBusy(true);
    try {
      await api('/plans/items/drafts', { method: 'PUT', body: { items } });
      toast(`Saved ${items.length} draft plan${items.length === 1 ? '' : 's'}.`);
      await reload();
    }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  async function submitSelected() {
    const items = proposals.filter((proposal) => selected.has(proposal.id) && proposal.status === 'draft').map(itemDraft);
    if (!items.length) { toast('Select at least one draft plan to submit.', 'err'); return; }
    setBusy(true);
    try {
      await api('/plans/items/submit', { method: 'POST', body: { items } });
      toast(`Submitted ${items.length} plan${items.length === 1 ? '' : 's'} to CPU.`);
      setSelected(new Set());
      setExpandedId(null);
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  async function deleteDraft(proposal) {
    const confirmed = await confirm({
      title: 'Delete draft plan?',
      message: `Delete "${proposal.plan_title || 'Untitled plan'}"? This cannot be undone.`,
      confirmLabel: 'Delete draft',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/plans/items/${proposal.id}`, { method: 'DELETE' });
      toast('Draft plan deleted.');
      setExpandedId(null);
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  function toggleSelected(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllDrafts() {
    const draftIds = proposals.filter((proposal) => proposal.status === 'draft').map((proposal) => proposal.id);
    setSelected((current) => current.size === draftIds.length ? new Set() : new Set(draftIds));
  }

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="font-display font-bold text-[14.5px]">{ownerName} plans — {cycleYear}</h2>
          <p className="text-[11.8px] text-ink-secondary mt-1">Add separate plans, then select and submit multiple drafts together. Each submitted row is reviewed by CPU.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={openAddModal}>Add plans</button>
          <button type="button" className="btn btn-sm" onClick={() => setTableOpen((open) => !open)}
            aria-expanded={tableOpen} aria-controls={`plans-table-${ownerType}-${ownerId}`}>
            {tableOpen ? 'Hide plans' : `Show plans (${proposals.length})`}
          </button>
        </div>
      </div>
      <div id={`plans-table-${ownerType}-${ownerId}`}>
        {tableOpen && (
          <>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <button className="btn btn-sm" disabled={busy || !proposals.some((proposal) => proposal.status === 'draft')} onClick={selectAllDrafts}>
              {selected.size ? 'Clear selection' : 'Select all drafts'}
            </button>
            <button className="btn btn-sm" disabled={busy || !proposals.some((proposal) => proposal.status === 'draft')} onClick={saveDrafts}>Save all drafts</button>
            <button className="btn btn-sm btn-primary" disabled={busy || selected.size === 0} onClick={submitSelected}>
              {busy ? 'Working…' : `Save & submit selected${selected.size ? ` (${selected.size})` : ''}`}
            </button>
          </div>

          <div className="max-h-[62vh] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[1000px] text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-sunken text-[10px] uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2 w-10">Select</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2 w-28">Status</th>
                  <th className="px-3 py-2 w-36">Budget (USD)</th>
                  <th className="px-3 py-2 min-w-[320px]">Targets / outcomes</th>
                  <th className="px-3 py-2 w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <PaginatedRows items={proposals} colSpan={6} emptyMessage="No plans yet. Add a plan row to begin." renderRow={(proposal) => {
                  const status = planStatus(proposal);
                  const item = itemDraft(proposal);
                  const expanded = expandedId === proposal.id;
                  return (
                    <FragmentPlanItemRow
                      key={proposal.id}
                      proposal={proposal}
                      item={item}
                      status={status}
                      expanded={expanded}
                      selected={selected.has(proposal.id)}
                      busy={busy}
                      onToggle={() => setExpandedId(expanded ? null : proposal.id)}
                      onSelect={() => toggleSelected(proposal.id)}
                      onChange={(field, value) => updateDraft(proposal.id, field, value)}
                      onDelete={() => deleteDraft(proposal)}
                    />
                  );
                }} />
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-sm" onClick={closeAddModal}
          role="dialog" aria-modal="true" aria-labelledby={`add-plan-title-${ownerType}-${ownerId}`}>
          <div className="w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl bg-surface border border-line shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="px-5 py-4 border-b border-line bg-sunken/50 flex items-start justify-between gap-4 flex-none">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent-100 text-xl font-bold text-accent-700">+</span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent-700">New plan draft</p>
                  <h2 id={`add-plan-title-${ownerType}-${ownerId}`} className="mt-0.5 font-display text-lg font-bold text-ink">Add plans</h2>
                  <p className="mt-0.5 text-[12px] text-ink-secondary">{ownerName} <span className="mx-1 text-ink-muted">·</span> {cycleYear} cycle</p>
                </div>
              </div>
              <button type="button" className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-surface text-ink-muted hover:bg-sunken hover:text-ink"
                onClick={closeAddModal} aria-label="Close">✕</button>
            </div>
            <form onSubmit={addPlan} className="flex min-h-0 flex-col overflow-y-auto">
              <div className="space-y-5 p-5 sm:p-6">
                <div className="rounded-xl border border-line-strong bg-sunken p-4 shadow-sm">
                  <label className="field-label mb-1.5 block">Plan title <span className="text-critical">*</span></label>
                  <input required autoFocus placeholder="e.g. Upgrade laboratory equipment" className="field-input plan-title-input bg-surface" value={newPlan.planTitle}
                    onChange={(event) => setNewPlan((current) => ({ ...current, planTitle: event.target.value }))} />
                  <p className="mt-1.5 text-[11px] text-ink-muted">Use a short, descriptive title so CPU can identify this plan in the review queue.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="field-label">Plan narrative</label>
                  <textarea rows={4} placeholder="Describe the planned work and its expected outcome…" className="field-input w-full min-h-[112px]" value={newPlan.narrative}
                    onChange={(event) => setNewPlan((current) => ({ ...current, narrative: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="field-label">Budget <span className="font-normal text-ink-muted">(USD, optional)</span></label>
                  <input type="number" min="0" step="any" placeholder="0.00" className="field-input w-full" value={newPlan.budget}
                    onChange={(event) => setNewPlan((current) => ({ ...current, budget: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="field-label">Targets / measurable outcomes</label>
                  <textarea rows={4} placeholder="Add measurable targets or outcomes…" className="field-input w-full min-h-[112px]" value={newPlan.targets}
                    onChange={(event) => setNewPlan((current) => ({ ...current, targets: event.target.value }))} />
                </div>
                <div className="flex gap-2 rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-[11.5px] text-ink-secondary">
                  <span className="font-bold text-accent-700">i</span>
                  <p>Save drafts as you add them. Before submission, each plan needs a narrative and either a budget or measurable targets.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/40 px-5 py-4 sm:px-6">
                <p className="text-[11.5px] text-ink-muted">{proposals.filter((proposal) => proposal.status === 'draft').length} draft(s) already in the table</p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={closeAddModal}>Close</button>
                  <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !newPlan.planTitle.trim()}>
                    {busy ? 'Adding…' : 'Add draft plan'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function FragmentPlanItemRow({ proposal, item, status, expanded, selected, busy, onToggle, onSelect, onChange, onDelete }) {
  const editable = proposal.status === 'draft';
  return (
    <>
      <tr className="hover:bg-sunken/60">
        <td className="px-3 py-2 align-top">
          <input type="checkbox" aria-label={`Select ${item.planTitle || 'untitled plan'}`}
            checked={selected} disabled={!editable} onChange={onSelect} />
        </td>
        <td className="px-3 py-2 align-top">
          <button type="button" className="text-left font-semibold text-accent-700 hover:underline" aria-expanded={expanded} onClick={onToggle}>
            {item.planTitle || 'Untitled plan'} <span className="text-ink-muted">{expanded ? '−' : '+'}</span>
          </button>
        </td>
        <td className="px-3 py-2 align-top"><span className={`chip chip-st-${status}`}>{STATUS_LABEL[status]}</span></td>
        <td className="px-3 py-2 align-top whitespace-nowrap font-semibold tabular-nums">{fmtMoney(item.budget)}</td>
        <td className="px-3 py-2 align-top max-w-[360px] whitespace-pre-wrap break-words" title={item.targets || ''}>{item.targets || '—'}</td>
        <td className="px-3 py-2 align-top">
          {editable
            ? <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={onDelete}>Delete draft</button>
            : <span className="text-ink-muted">—</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-sunken/40">
          <td colSpan="6" className="px-4 py-3">
            {proposal.return_comment && status === 'returned' && (
              <p className="mb-2 rounded bg-warning-soft px-3 py-2 text-warning"><b>CPU feedback:</b> {proposal.return_comment}</p>
            )}
            {editable ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <label className="field-label">Plan title</label>
                  <input className="field-input" value={item.planTitle} onChange={(e) => onChange('planTitle', e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="field-label">Plan narrative</label>
                  <textarea rows={3} className="field-input" value={item.narrative} onChange={(e) => onChange('narrative', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="field-label">Budget (USD)</label>
                  <input type="number" min="0" step="any" className="field-input" value={item.budget} onChange={(e) => onChange('budget', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="field-label">Targets / measurable outcomes</label>
                  <textarea rows={2} className="field-input" value={item.targets} onChange={(e) => onChange('targets', e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 text-[12.5px]">
                <div className="md:col-span-2"><b>Plan narrative:</b><p className="mt-1 whitespace-pre-wrap">{proposal.narrative || '—'}</p></div>
                <div><b>Budget:</b> {fmtMoney(proposal.budget)}</div>
                <div><b>Targets / outcomes:</b><p className="mt-1 whitespace-pre-wrap">{proposal.targets || '—'}</p></div>
                {proposal.submitted_at && <div className="text-ink-muted">Submitted: {proposal.submitted_at}</div>}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ReadOnlyPlanRows({ proposals }) {
  if (!proposals.length) return <p className="text-[11.8px] text-ink-muted">No plans entered.</p>;
  return (
    <div className="max-h-56 overflow-auto rounded border border-line">
      <table className="w-full min-w-[540px] text-left text-[11.8px]">
        <thead className="sticky top-0 bg-sunken text-[10px] uppercase text-ink-muted">
          <tr><th className="px-2.5 py-1.5">Plan</th><th className="px-2.5 py-1.5">Status</th><th className="px-2.5 py-1.5">Budget</th><th className="px-2.5 py-1.5">Targets</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          <PaginatedRows items={proposals} colSpan={4} emptyMessage="No plans entered." renderRow={(proposal) => (
            <tr key={proposal.id}>
              <td className="px-2.5 py-2 font-medium">{proposal.plan_title}</td>
              <td className="px-2.5 py-2"><span className={`chip chip-st-${planStatus(proposal)}`}>{STATUS_LABEL[planStatus(proposal)]}</span></td>
              <td className="px-2.5 py-2 tabular-nums">{fmtMoney(proposal.budget)}</td>
              <td className="px-2.5 py-2 max-w-xs truncate" title={proposal.targets || ''}>{proposal.targets || '—'}</td>
            </tr>
          )} />
        </tbody>
      </table>
    </div>
  );
}

function CpuPanel({ data, cycleYear, reload }) {
  const proposals = [
    ...data.units.flatMap((unit) => (unit.proposals || (unit.proposal ? [unit.proposal] : [])).map((proposal) => ({
      ...proposal, ownerType: 'Unit', ownerName: unit.name,
    }))),
    ...data.subs.flatMap((sub) => (sub.proposals || (sub.proposal ? [sub.proposal] : [])).map((proposal) => ({
      ...proposal, ownerType: 'Sub-programme', ownerName: sub.name,
    }))),
    ...data.programmes.flatMap((programme) => (programme.proposals || (programme.proposal ? [programme.proposal] : [])).map((proposal) => ({
      ...proposal, ownerType: 'Programme', ownerName: programme.name,
    }))),
  ];

  return (
    <div>
      <CpuPlanReviewTable proposals={proposals} cycleYear={cycleYear} reload={reload} />
      <UniversityPlanCard data={data} cycleYear={cycleYear} reload={reload} />
    </div>
  );
}

function CpuPlanReviewTable({ proposals, cycleYear, reload }) {
  const toast = useToast();
  const visible = proposals.filter((proposal) => ['submitted', 'approved'].includes(proposal.status));
  const pending = visible.filter((proposal) => proposal.status === 'submitted');
  const waiting = pending.length;
  const [selected, setSelected] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tableOpen, setTableOpen] = useState(true);

  useEffect(() => {
    setSelected((current) => new Set(Array.from(current).filter((id) =>
      proposals.some((proposal) => proposal.id === id && proposal.status === 'submitted'))));
  }, [proposals]);

  function toggleSelection(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPending() {
    setSelected((current) => current.size === pending.length ? new Set() : new Set(pending.map((proposal) => proposal.id)));
  }

  async function approveSelected() {
    if (!selected.size) return;
    setBusy(true);
    try {
      await api('/plans/items/approve', { method: 'POST', body: { proposalIds: Array.from(selected) } });
      toast(`Approved ${selected.size} plan${selected.size === 1 ? '' : 's'}.`);
      setSelected(new Set());
      setExpandedId(null);
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }
  return (
    <section className="card mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="font-display font-bold text-[15px]">Plan approvals — {cycleYear}</h2>
          <p className="text-[11.8px] text-ink-secondary mt-1">{waiting} awaiting CPU approval · click a plan row to review details</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip chip-st-submitted">{waiting} pending</span>
          <button type="button" className="btn btn-sm" onClick={() => setTableOpen((open) => !open)}
            aria-expanded={tableOpen} aria-controls="cpu-plan-approval-table">
            {tableOpen ? 'Hide table' : 'Show table'}
          </button>
        </div>
      </div>
      <div id="cpu-plan-approval-table">
        {tableOpen && (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <button className="btn btn-sm" disabled={!pending.length || busy} onClick={selectAllPending}>
                {selected.size ? 'Clear selection' : 'Select all pending'}
              </button>
              <button className="btn btn-sm btn-primary" disabled={!selected.size || busy} onClick={approveSelected}>
                {busy ? 'Approving…' : `Approve selected${selected.size ? ` (${selected.size})` : ''}`}
              </button>
            </div>
            <div className="max-h-[65vh] overflow-auto rounded-lg border border-line">
              <table className="w-full min-w-[980px] text-left text-[12px]">
                <thead className="sticky top-0 z-10 bg-sunken text-[10px] uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 w-10">Select</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Owner / tier</th>
                    <th className="px-3 py-2 w-28">Status</th>
                    <th className="px-3 py-2 w-32">Budget (USD)</th>
                    <th className="px-3 py-2">Targets / outcomes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <PaginatedRows items={visible} colSpan={6} emptyMessage="No submitted plans are waiting for review in this cycle." renderRow={(proposal) => {
                    const expanded = expandedId === proposal.id;
                    return (
                      <FragmentCpuPlanRow
                        key={proposal.id}
                        proposal={proposal}
                        expanded={expanded}
                        selected={selected.has(proposal.id)}
                        busy={busy}
                        onToggle={() => setExpandedId(expanded ? null : proposal.id)}
                        onSelect={() => toggleSelection(proposal.id)}
                        cycleYear={cycleYear}
                        reload={reload}
                      />
                    );
                  }} />
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function FragmentCpuPlanRow({ proposal, expanded, selected, busy, onToggle, onSelect, cycleYear, reload }) {
  return (
    <>
      <tr className="hover:bg-sunken/60">
        <td className="px-3 py-2 align-top">
          <input type="checkbox" aria-label={`Select ${proposal.plan_title}`}
            checked={selected} disabled={proposal.status !== 'submitted' || busy} onChange={onSelect} />
        </td>
        <td className="px-3 py-2 align-top">
          <button type="button" className="text-left font-semibold text-accent-700 hover:underline" aria-expanded={expanded} onClick={onToggle}>
            {proposal.plan_title || 'Untitled plan'} <span className="text-ink-muted">{expanded ? '−' : '+'}</span>
          </button>
        </td>
        <td className="px-3 py-2 align-top">{proposal.ownerType}: {proposal.ownerName}</td>
        <td className="px-3 py-2 align-top"><span className={`chip chip-st-${proposal.status}`}>{STATUS_LABEL[proposal.status]}</span></td>
        <td className="px-3 py-2 align-top whitespace-nowrap font-semibold tabular-nums">{fmtMoney(proposal.budget)}</td>
        <td className="px-3 py-2 align-top max-w-[360px] whitespace-pre-wrap break-words" title={proposal.targets || ''}>{proposal.targets || '—'}</td>
      </tr>
      {expanded && (
        <tr className="bg-sunken/40">
          <td colSpan="6" className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2 text-[12.5px]">
              <div className="md:col-span-2"><b>Plan narrative:</b><p className="mt-1 whitespace-pre-wrap">{proposal.narrative || '—'}</p></div>
              <div><b>Targets / outcomes:</b><p className="mt-1 whitespace-pre-wrap">{proposal.targets || '—'}</p></div>
              <div><b>Budget:</b> {fmtMoney(proposal.budget)}</div>
              {proposal.submitted_at && <div className="text-ink-muted">Submitted: {proposal.submitted_at}</div>}
              {proposal.status === 'submitted' && (
                <div className="md:col-span-2"><CpuPlanItemActions proposal={proposal} cycleYear={cycleYear} reload={reload} /></div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CpuPlanItemActions({ proposal, cycleYear, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState('');

  async function approve() {
    setBusy(true);
    try {
      await api(`/plans/items/${proposal.id}/approve`, { method: 'POST' });
      toast('Plan approved by CPU.');
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  async function returnPlan() {
    if (!comment.trim()) { toast('A reason is required when returning a plan.', 'err'); return; }
    setBusy(true);
    try {
      await api(`/plans/items/${proposal.id}/return`, { method: 'POST', body: { comment: comment.trim() } });
      toast('Plan returned to its submitter.');
      setReturning(false);
      setComment('');
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={approve}>Approve</button>
      <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setReturning((current) => !current)}>Return…</button>
      {returning && (
        <div className="basis-full space-y-2">
          <textarea rows={2} className="field-input" placeholder="Reason for returning this plan" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={returnPlan}>Confirm return</button>
        </div>
      )}
    </div>
  );
}

// A Programme Head sees their own branch, prepares their Programme's plan,
// and submits it to CPU. CPU alone approves or returns plan proposals.
function ProgrammeHeadPanel({ data, cycleYear, reload }) {
  const { user } = useApp();
  const programme = data.programmes.find((p) => p.id === user.scope_id);
  if (!programme) return <div className="card text-center text-ink-muted py-8">Your programme couldn't be found in the org structure.</div>;

  return (
    <div>
      <div className="card mb-4">
        <div className="flex justify-between items-start gap-3 flex-wrap mb-2.5">
          <div>
            <h2 className="font-display font-bold text-[15px]">{programme.name}</h2>
            <p className="text-[11.8px] text-ink-muted">{programme.subCount} Sub-programme{programme.subCount === 1 ? '' : 's'} in your Programme</p>
          </div>
          <p className="text-[11.8px] text-ink-secondary">
            Approved: <b>{fmtMoney(programme.approvedBudget)}</b> · Provisional: <b>{fmtMoney(programme.provisionalBudget)}</b>
          </p>
        </div>
        {data.subs.filter((s) => s.programme_id === programme.id).map((s) => (
          <SubApprovalRow key={s.id} s={s} units={data.units.filter((u) => u.sub_id === s.id)} />
        ))}
      </div>
      <PlanItemsEditor ownerType="programme" ownerId={programme.id} ownerName={programme.name} proposals={programme.proposals || (programme.proposal ? [programme.proposal] : [])} cycleYear={cycleYear} reload={reload} />
    </div>
  );
}

function SubApprovalRow({ s, units }) {
  return (
    <div className="pl-3 border-l-2 border-line mb-4">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-[13px]">{s.name}</p>
        </div>
      </div>
      <ReadOnlyPlanRows proposals={s.proposals || (s.proposal ? [s.proposal] : [])} />
      <div className="mt-3 space-y-2">
        {units.map((u) => (
          <div key={u.id} className="pl-3">
            <p className="text-[11.8px] font-medium mb-1">{u.name}</p>
            <ReadOnlyPlanRows proposals={u.proposals || (u.proposal ? [u.proposal] : [])} />
          </div>
        ))}
      </div>
    </div>
  );
}

function UniversityPlanCard({ data, cycleYear, reload }) {
  const proposal = data.university.proposal;
  const status = planStatus(proposal);

  const allProgrammesSubmitted = data.programmes.length > 0 && data.programmes.every((programme) => {
    const proposals = programme.proposals || (programme.proposal ? [programme.proposal] : []);
    return proposals.length > 0 && proposals.every((item) => item.status === 'submitted' || item.status === 'approved');
  });

  return (
    <div id="plan-university" className="card mt-2 border-2 border-accent-500/20 scroll-mt-4">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h2 className="font-display font-bold text-[15px]">University Annual Plan — {cycleYear}</h2>
        <span className={`chip chip-st-${status}`}>{STATUS_LABEL[status]}</span>
      </div>
      {status === 'approved' && (
        <div className="mb-3 rounded-lg bg-good-soft text-good text-[12.8px] px-3.5 py-2.5 font-semibold">
          ✓ Approved by CPU — this is the official Annual Plan in effect for {cycleYear}.
        </div>
      )}
      {proposal?.return_comment && status === 'returned' && (
        <div className="mb-3 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5">
          <b>Returned by CPU:</b> {proposal.return_comment}
        </div>
      )}
      <p className="text-[12px] text-ink-secondary mb-3">
        Total budget — approved: <b>{fmtMoney(data.university.approvedBudget)}</b>,
        including not-yet-approved submissions: <b>{fmtMoney(data.university.provisionalBudget)}</b>.
        {!allProgrammesSubmitted && <span className="block mt-1 text-warning font-semibold">Not every Programme's plan has been submitted yet.</span>}
      </p>
      {proposal?.narrative && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-ink-muted mb-1">University-wide planning narrative</p>
          <p className="text-[12.5px] text-ink-secondary whitespace-pre-wrap">{proposal.narrative}</p>
        </div>
      )}
      {proposal?.targets && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-ink-muted mb-1">Targets / outcomes</p>
          <p className="text-[12.5px] text-ink-secondary whitespace-pre-wrap">{proposal.targets}</p>
        </div>
      )}
      <div className="flex gap-2">
        <CpuApprovalActions proposal={proposal} endpoint="/plans/university" cycleYear={cycleYear} reload={reload} label="University Annual Plan" />
      </div>
    </div>
  );
}

// The University Council has read-only visibility; CPU alone approves plans.
function CouncilPanel({ data, cycleYear }) {
  const universityProposals = data.university.proposals || (data.university.proposal ? [data.university.proposal] : []);

  return (
    <div>
      <p className="text-[12.5px] text-ink-secondary mb-4 max-w-[70ch]">
        This is a read-only view of the annual plan and its supporting Programme, Sub-programme, and Unit proposals.
        CPU is the sole approver for plans and budgets at every tier.
      </p>
      {data.programmes.map((p) => (
        <div key={p.id} className="card mb-3">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <p className="font-bold text-[14px]">{p.name}</p>
          </div>
          <p className="text-[11.8px] text-ink-secondary mt-1">
            Approved: <b>{fmtMoney(p.approvedBudget)}</b> · Provisional: <b>{fmtMoney(p.provisionalBudget)}</b>
            {' · '}{data.subs.filter((s) => s.programme_id === p.id).length} Sub-programme(s),{' '}
            {data.units.filter((u) => data.subs.some((s) => s.programme_id === p.id && s.id === u.sub_id)).length} Unit(s)
          </p>
          <div className="mt-2">
            <ReadOnlyPlanRows proposals={p.proposals || (p.proposal ? [p.proposal] : [])} />
            {data.subs.filter((s) => s.programme_id === p.id).map((s) => (
              <div key={s.id} className="mt-3 pl-3 border-l-2 border-line">
                <p className="font-semibold text-[12px] mb-1">{s.name}</p>
                <ReadOnlyPlanRows proposals={s.proposals || (s.proposal ? [s.proposal] : [])} />
                {data.units.filter((u) => u.sub_id === s.id).map((u) => (
                  <div key={u.id} className="mt-2 pl-3">
                    <p className="text-[11.8px] font-medium mb-1">{u.name}</p>
                    <ReadOnlyPlanRows proposals={u.proposals || (u.proposal ? [u.proposal] : [])} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="card border-2 border-accent-500/20">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h2 className="font-display font-bold text-[15px]">University Annual Plan — {cycleYear}</h2>
        </div>
        <p className="text-[12px] text-ink-secondary mb-2">
          Total — approved: <b>{fmtMoney(data.university.approvedBudget)}</b> · provisional: <b>{fmtMoney(data.university.provisionalBudget)}</b>
        </p>
        {universityProposals.length
          ? <ReadOnlyPlanRows proposals={universityProposals} />
          : <p className="text-[12.6px] text-ink-muted mt-2">Not yet compiled by CPU for this cycle.</p>}
      </div>
    </div>
  );
}

function CpuApprovalActions({ proposal, endpoint, cycleYear, reload, label }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState('');
  if (proposal?.status !== 'submitted') return null;

  async function approve() {
    setBusy(true);
    try {
      await api(`${endpoint}/approve`, { method: 'POST', body: { cycleYear } });
      toast(`${label} approved by CPU.`);
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }
  async function doReturn() {
    if (!comment.trim()) { toast('A reason is required to return a proposal.', 'err'); return; }
    setBusy(true);
    try {
      await api(`${endpoint}/return`, { method: 'POST', body: { cycleYear, comment: comment.trim() } });
      toast(`${label} returned to draft.`);
      setReturning(false);
      setComment('');
      await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={approve}>Approve</button>
      <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setReturning((value) => !value)}>Return…</button>
      {returning && (
        <div className="basis-full space-y-1.5">
          <textarea rows={2} className="field-input" placeholder="Reason for returning this proposal"
            value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={doReturn}>Confirm return</button>
        </div>
      )}
    </div>
  );
}

function ReadOnlyPanel({ data }) {
  return (
    <div>
      {data.programmes.map((p) => (
        <div key={p.id} className="card mb-3">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <p className="font-bold text-[14px]">{p.name}</p>
          </div>
          <p className="text-[11.8px] text-ink-secondary mt-1">
            Approved: <b>{fmtMoney(p.approvedBudget)}</b> · Provisional: <b>{fmtMoney(p.provisionalBudget)}</b>
          </p>
          <ReadOnlyPlanRows proposals={p.proposals || (p.proposal ? [p.proposal] : [])} />
        </div>
      ))}
      <div className="card border-2 border-accent-500/20">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h2 className="font-display font-bold text-[15px]">University Annual Plan</h2>
        </div>
        <p className="text-[12px] text-ink-secondary">
          Approved: <b>{fmtMoney(data.university.approvedBudget)}</b> · Provisional: <b>{fmtMoney(data.university.provisionalBudget)}</b>
        </p>
        {(data.university.proposals || (data.university.proposal ? [data.university.proposal] : [])).length
          ? <ReadOnlyPlanRows proposals={data.university.proposals || [data.university.proposal]} />
          : <p className="text-[12.6px] text-ink-muted mt-2">Not yet compiled by CPU for this cycle.</p>}
      </div>
    </div>
  );
}
