import { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
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
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

// A genuine downloadable document for the Annual Plan & Budget, mirroring
// Reports.jsx's downloadPdf exactly: built client-side from the very same
// `data` object (already scoped to the caller's role/jurisdiction by
// GET /plans?year= — see backend/src/routes/plans.js) that the on-screen
// panels above render, so the PDF can never drift from what's on screen.
// One table per tier (University -> Programmes -> Sub-programmes -> Units),
// each row carrying its status, approved budget, and (where the live sum
// applies) provisional budget, plus every tier's own planning narrative
// beneath its table so the document reads as a real plan, not just a
// budget ledger.
function downloadPlanPdf(data, cycleYear) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  const pageBottom = 780;
  let y = 46;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('ZOU Strategic Plan Monitor — Annual Plan & Budget', marginX, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(`${cycleYear} cycle · Generated ${new Date().toLocaleString()}`, marginX, y);
  y += 20;

  const uni = data.university;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('University Annual Plan', marginX, y);
  y += 8;
  autoTable(doc, {
    startY: y + 6,
    margin: { left: marginX, right: marginX },
    head: [['Status', 'Approved budget', 'Provisional budget']],
    body: [[STATUS_LABEL[uni.proposal?.status || 'draft'], fmtMoney(uni.approvedBudget), fmtMoney(uni.provisionalBudget)]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [21, 20, 15], textColor: 255 },
  });
  y = doc.lastAutoTable.finalY + 12;
  if (uni.proposal?.narrative) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(uni.proposal.narrative, 515);
    doc.text(lines, marginX, y);
    y += lines.length * 11 + 16;
  } else {
    y += 10;
  }

  const body = [];
  data.programmes.forEach((p) => {
    body.push([
      { content: p.name, styles: { fontStyle: 'bold', fillColor: [240, 239, 236] } },
      { content: STATUS_LABEL[p.proposal?.status || 'draft'], styles: { fillColor: [240, 239, 236] } },
      { content: fmtMoney(p.approvedBudget), styles: { fillColor: [240, 239, 236] } },
      { content: fmtMoney(p.provisionalBudget), styles: { fillColor: [240, 239, 236] } },
    ]);
    data.subs.filter((s) => s.programme_id === p.id).forEach((s) => {
      body.push([`   ${s.name}`, STATUS_LABEL[planStatus(s.proposal)], fmtMoney(s.approvedBudget), fmtMoney(s.provisionalBudget)]);
      data.units.filter((u) => u.sub_id === s.id).forEach((u) => {
        body.push([`      ${u.name}`, STATUS_LABEL[planStatus(u.proposal)], fmtMoney(u.proposal?.budget), '—']);
      });
    });
  });

  if (y > pageBottom - 100) { doc.addPage(); y = 46; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Programme, Sub-programme & Unit proposals', marginX, y);
  autoTable(doc, {
    startY: y + 10,
    margin: { left: marginX, right: marginX },
    head: [['Programme / Sub-programme / Unit', 'Status', 'Approved budget', 'Provisional budget']],
    body,
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: [21, 20, 15], textColor: 255 },
  });
  y = doc.lastAutoTable.finalY + 20;

  const narrated = data.programmes.filter((p) => p.proposal?.narrative);
  if (narrated.length > 0) {
    if (y > pageBottom - 60) { doc.addPage(); y = 46; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Programme narratives', marginX, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    narrated.forEach((p) => {
      if (y > pageBottom - 40) { doc.addPage(); y = 46; }
      doc.setFont('helvetica', 'bold');
      doc.text(p.name, marginX, y);
      y += 12;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(p.proposal.narrative, 515);
      doc.text(lines, marginX, y);
      y += lines.length * 11 + 14;
    });
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`ZOU IRBM Strategic Plan Monitor · Page ${i} of ${pageCount}`, marginX, 815);
    doc.setTextColor(0);
  }

  doc.save(`zou-annual-plan-${cycleYear}.pdf`);
}

// The annual planning & budget cycle: Units enter their own budget request,
// Sub-programme Reps approve those and add a sub-level narrative (its budget
// is always the live sum of its units, never typed in), CPU compiles each
// Programme and finally the University Annual Plan — see backend/src/routes/plans.js.
export default function Planning() {
  const { user } = useApp();
  const toast = useToast();
  const now = new Date().getFullYear();
  const [cycleYear, setCycleYear] = useState(now + 1);
  const [data, setData] = useState(null);

  async function load(year) {
    try { setData(await api(`/plans?year=${year ?? cycleYear}`)); } catch (err) { toast(err.message, 'err'); }
  }
  useEffect(() => { load(cycleYear); }, [cycleYear]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Annual Plan &amp; Budget</h1>
          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            The next-cycle plan proposal, built bottom-up: each Unit/Department/Faculty/Region enters its own
            budget request; every tier above it is the live sum of what's beneath it, never a separately typed figure.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select className="field-input w-auto" value={cycleYear} onChange={(e) => setCycleYear(Number(e.target.value))}>
            {yearRange(now).map((y) => <option key={y} value={y}>{y} cycle</option>)}
          </select>
          <button className="btn btn-sm btn-primary" disabled={!data} onClick={() => downloadPlanPdf(data, cycleYear)}>
            Download PDF
          </button>
        </div>
      </div>

      {!data && <div className="text-ink-muted text-[13px]">Loading…</div>}
      {data && user.role === 'unithead' && <UnitPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && user.role === 'rep' && <RepPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && user.role === 'programme' && <ProgrammeHeadPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && user.role === 'cpu' && <CpuPanel data={data} cycleYear={cycleYear} reload={() => load()} />}
      {data && ['exec', 'ictadmin', 'individual'].includes(user.role) && <ReadOnlyPanel data={data} />}
    </div>
  );
}

function UnitPanel({ data, cycleYear, reload }) {
  const { user } = useApp();
  const toast = useToast();
  const unit = data.units.find((u) => u.id === user.scope_id);
  const proposal = unit?.proposal;
  const [narrative, setNarrative] = useState(proposal?.narrative || '');
  const [budget, setBudget] = useState(proposal?.budget ?? '');
  const [busy, setBusy] = useState(false);
  const locked = proposal && proposal.status !== 'draft';

  useEffect(() => { setNarrative(proposal?.narrative || ''); setBudget(proposal?.budget ?? ''); }, [proposal?.narrative, proposal?.budget]);

  if (!unit) return <div className="card text-center text-ink-muted py-8">Your unit couldn't be found in the org structure.</div>;

  async function saveDraft() {
    setBusy(true);
    try {
      await api(`/plans/units/${unit.id}`, { method: 'PUT', body: { cycleYear, narrative, budget: budget === '' ? null : Number(budget) } });
      toast('Draft saved.'); await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true);
    try {
      await api(`/plans/units/${unit.id}/submit`, { method: 'POST', body: { cycleYear } });
      toast('Plan proposal submitted.'); await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="card max-w-xl">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="font-display font-bold text-[14.5px]">{unit.name}'s plan proposal — {cycleYear}</h2>
        <span className={`chip chip-st-${planStatus(proposal)}`}>{STATUS_LABEL[planStatus(proposal)]}</span>
      </div>
      {proposal?.return_comment && planStatus(proposal) === 'returned' && (
        <div className="mb-3 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5">
          <b>Feedback from your Sub-programme Rep:</b> {proposal.return_comment}
        </div>
      )}
      <div className="space-y-1 mb-3">
        <label className="field-label">Planning narrative</label>
        <textarea rows={3} disabled={locked} className="field-input"
          placeholder="What does this unit plan to do next cycle?"
          value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      </div>
      <div className="space-y-1 mb-3">
        <label className="field-label">Requested budget (USD)</label>
        <input type="number" step="any" disabled={locked} className="field-input w-48"
          value={budget} onChange={(e) => setBudget(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button className="btn btn-sm" disabled={locked || busy} onClick={saveDraft}>Save draft</button>
        <button className="btn btn-sm btn-primary" disabled={locked || busy || !narrative.trim() || budget === ''} onClick={submit}>Submit</button>
      </div>
    </div>
  );
}

function RepPanel({ data, cycleYear, reload }) {
  const { user } = useApp();
  const toast = useToast();
  const sub = data.subs.find((s) => s.id === user.scope_id);
  const myUnits = data.units.filter((u) => u.sub_id === user.scope_id);
  const [busyId, setBusyId] = useState(null);
  const [returnFor, setReturnFor] = useState(null);
  const [comment, setComment] = useState('');

  async function approve(unitId) {
    setBusyId(unitId);
    try { await api(`/plans/units/${unitId}/approve`, { method: 'POST', body: { cycleYear } }); toast('Approved.'); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusyId(null); }
  }
  async function doReturn(unitId) {
    if (!comment.trim()) { toast('A reason is required to return a proposal.', 'err'); return; }
    setBusyId(unitId);
    try {
      await api(`/plans/units/${unitId}/return`, { method: 'POST', body: { cycleYear, comment: comment.trim() } });
      toast('Returned to unit.'); setReturnFor(null); setComment(''); await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusyId(null); }
  }

  if (!sub) return <div className="card text-center text-ink-muted py-8">Your sub-programme couldn't be found in the org structure.</div>;

  return (
    <div>
      <h2 className="font-display font-bold text-[14.5px] mb-2.5">Units in {sub.name} — {cycleYear}</h2>
      {myUnits.length === 0 && <div className="card text-center text-ink-muted py-8 mb-4">No units under your sub-programme yet.</div>}
      {myUnits.map((u) => {
        const p = u.proposal;
        return (
          <div key={u.id} className="card mb-2.5">
            <div className="flex justify-between gap-3 items-start flex-wrap">
              <div>
                <p className="font-bold text-[13.6px] mb-1">{u.name}</p>
                {p?.narrative && <p className="text-[12.6px] text-ink-secondary mb-1.5 max-w-[52ch]">{p.narrative}</p>}
                <div className="flex gap-1.5 items-center flex-wrap">
                  <span className={`chip chip-st-${planStatus(p)}`}>{STATUS_LABEL[planStatus(p)]}</span>
                  <span className="chip chip-tag">Requested: {fmtMoney(p?.budget)}</span>
                </div>
              </div>
              {p?.status === 'submitted' && (
                <div className="flex gap-2 flex-wrap">
                  <button className="btn btn-sm btn-primary" disabled={busyId === u.id} onClick={() => approve(u.id)}>Approve</button>
                  <button className="btn btn-sm btn-danger" onClick={() => setReturnFor(returnFor === u.id ? null : u.id)}>Return…</button>
                </div>
              )}
            </div>
            {returnFor === u.id && (
              <div className="mt-2.5 space-y-1.5">
                <textarea rows={2} className="field-input" placeholder="Reason for returning this proposal"
                  value={comment} onChange={(e) => setComment(e.target.value)} />
                <button className="btn btn-sm btn-danger" disabled={busyId === u.id} onClick={() => doReturn(u.id)}>Confirm return</button>
              </div>
            )}
          </div>
        );
      })}

      <SubProposalCard sub={sub} cycleYear={cycleYear} reload={reload} />
    </div>
  );
}

function SubProposalCard({ sub, cycleYear, reload }) {
  const toast = useToast();
  const proposal = sub.proposal;
  const [narrative, setNarrative] = useState(proposal?.narrative || '');
  const [busy, setBusy] = useState(false);
  const locked = proposal && proposal.status !== 'draft';
  useEffect(() => { setNarrative(proposal?.narrative || ''); }, [proposal?.narrative]);

  async function saveDraft() {
    setBusy(true);
    try { await api(`/plans/subs/${sub.id}`, { method: 'PUT', body: { cycleYear, narrative } }); toast('Draft saved.'); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true);
    try { await api(`/plans/subs/${sub.id}/submit`, { method: 'POST', body: { cycleYear } }); toast('Sub-programme plan submitted to CPU.'); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="card max-w-xl mt-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h2 className="font-display font-bold text-[14.5px]">{sub.name}'s plan proposal — {cycleYear}</h2>
        <span className={`chip chip-st-${planStatus(proposal)}`}>{STATUS_LABEL[planStatus(proposal)]}</span>
      </div>
      <p className="text-[11.8px] text-ink-secondary mb-3">
        Budget is the sum of your units' own requests — approved: <b>{fmtMoney(sub.approvedBudget)}</b>,
        including not-yet-approved submissions: <b>{fmtMoney(sub.provisionalBudget)}</b>.
      </p>
      {proposal?.return_comment && planStatus(proposal) === 'returned' && (
        <div className="mb-3 rounded-lg bg-warning-soft text-warning text-[12.8px] px-3.5 py-2.5">
          <b>Feedback from CPU:</b> {proposal.return_comment}
        </div>
      )}
      <div className="space-y-1 mb-3">
        <label className="field-label">Sub-programme planning narrative</label>
        <textarea rows={3} disabled={locked} className="field-input"
          value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button className="btn btn-sm" disabled={locked || busy} onClick={saveDraft}>Save draft</button>
        <button className="btn btn-sm btn-primary" disabled={locked || busy || !narrative.trim()} onClick={submit}>Submit to CPU</button>
      </div>
    </div>
  );
}

function CpuPanel({ data, cycleYear, reload }) {
  return (
    <div>
      {data.programmes.map((p) => (
        <div key={p.id} className="card mb-4">
          <div className="flex justify-between items-start gap-3 flex-wrap mb-2.5">
            <p className="font-bold text-[14px]">{p.name}</p>
            <p className="text-[11.8px] text-ink-secondary">
              Approved: <b>{fmtMoney(p.approvedBudget)}</b> · Provisional: <b>{fmtMoney(p.provisionalBudget)}</b>
            </p>
          </div>
          {data.subs.filter((s) => s.programme_id === p.id).map((s) => (
            <SubApprovalRow key={s.id} s={s} units={data.units.filter((u) => u.sub_id === s.id)} cycleYear={cycleYear} reload={reload} />
          ))}
          <ProgrammeCompileForm programme={p} cycleYear={cycleYear} reload={reload} />
        </div>
      ))}

      <UniversityPlanCard data={data} cycleYear={cycleYear} reload={reload} />
    </div>
  );
}

// A Programme Head's own view: read-only oversight of every Sub-programme's
// plan proposal within their own Programme only (never another Programme —
// data.subs is filtered to programme.id below, mirroring the same
// "own branch only" shape as RepPanel/UnitPanel), plus the two real actions
// that belong to their tier: approving/returning a Sub-programme's proposal
// (see SubApprovalRow — the same real, scope-checked
// POST /plans/subs/:id/approve|return CPU also uses) and compiling &
// submitting their own Programme's plan once ready.
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
          <SubApprovalRow key={s.id} s={s} units={data.units.filter((u) => u.sub_id === s.id)} cycleYear={cycleYear} reload={reload} />
        ))}
        <ProgrammeCompileForm programme={programme} cycleYear={cycleYear} reload={reload} />
      </div>
    </div>
  );
}

// One Sub-programme's plan row — its own narrative/status/budget, the
// Programme-tier approve/return actions (real POST /plans/subs/:id/approve
// and /return calls — CPU and this Sub's own Programme Head are both
// authorized server-side, see routes/plans.js's isProgrammeHeadOwner), and
// its own Units listed underneath for context. Shared by CpuPanel (every
// Programme) and ProgrammeHeadPanel (their one Programme only).
function SubApprovalRow({ s, units, cycleYear, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState('');

  async function approve() {
    setBusy(true);
    try { await api(`/plans/subs/${s.id}/approve`, { method: 'POST', body: { cycleYear } }); toast('Approved.'); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }
  async function doReturn() {
    if (!comment.trim()) { toast('A reason is required to return a proposal.', 'err'); return; }
    setBusy(true);
    try {
      await api(`/plans/subs/${s.id}/return`, { method: 'POST', body: { cycleYear, comment: comment.trim() } });
      toast('Returned to Sub-programme Rep.'); setReturning(false); setComment(''); await reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="pl-3 border-l-2 border-line mb-3">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-[13px]">{s.name}</p>
          {s.proposal?.narrative && <p className="text-[12.3px] text-ink-secondary max-w-[52ch]">{s.proposal.narrative}</p>}
          <div className="flex gap-1.5 items-center flex-wrap mt-1">
            <span className={`chip chip-st-${planStatus(s.proposal)}`}>{STATUS_LABEL[planStatus(s.proposal)]}</span>
            <span className="chip chip-tag">Approved: {fmtMoney(s.approvedBudget)}</span>
            <span className="chip chip-tag">Provisional: {fmtMoney(s.provisionalBudget)}</span>
          </div>
        </div>
        {s.proposal?.status === 'submitted' && (
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={approve}>Approve</button>
            <button className="btn btn-sm btn-danger" onClick={() => setReturning((v) => !v)}>Return…</button>
          </div>
        )}
      </div>
      {returning && (
        <div className="mt-2 space-y-1.5">
          <textarea rows={2} className="field-input" placeholder="Reason for returning this proposal"
            value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={doReturn}>Confirm return</button>
        </div>
      )}
      <div className="mt-2 space-y-1">
        {units.map((u) => (
          <div key={u.id} className="text-[11.8px] text-ink-secondary flex items-center gap-2 flex-wrap">
            <span>• {u.name}</span>
            <span className={`chip chip-st-${planStatus(u.proposal)}`}>{STATUS_LABEL[planStatus(u.proposal)]}</span>
            <span className="tabular-nums">{fmtMoney(u.proposal?.budget)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgrammeCompileForm({ programme, cycleYear, reload }) {
  const toast = useToast();
  const proposal = programme.proposal;
  const [narrative, setNarrative] = useState(proposal?.narrative || '');
  const [busy, setBusy] = useState(false);
  const locked = proposal?.status === 'submitted';
  useEffect(() => { setNarrative(proposal?.narrative || ''); }, [proposal?.narrative]);

  async function saveDraft() {
    setBusy(true);
    try { await api(`/plans/programmes/${programme.id}`, { method: 'PUT', body: { cycleYear, narrative } }); toast('Draft saved.'); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true);
    try { await api(`/plans/programmes/${programme.id}/submit`, { method: 'POST', body: { cycleYear } }); toast('Programme plan submitted.'); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="mt-2 pt-3 border-t border-line">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <h3 className="font-display font-bold text-[13px]">Compile {programme.name}'s plan</h3>
        <span className={`chip chip-st-${proposal?.status || 'draft'}`}>{STATUS_LABEL[proposal?.status || 'draft']}</span>
      </div>
      <textarea rows={2} disabled={locked} className="field-input mb-2" placeholder="Programme-level planning narrative"
        value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn btn-sm" disabled={locked || busy} onClick={saveDraft}>Save draft</button>
        <button className="btn btn-sm btn-primary" disabled={locked || busy || !narrative.trim()} onClick={submit}>Submit</button>
      </div>
    </div>
  );
}

function UniversityPlanCard({ data, cycleYear, reload }) {
  const toast = useToast();
  const proposal = data.university.proposal;
  const [narrative, setNarrative] = useState(proposal?.narrative || '');
  const [busy, setBusy] = useState(false);
  const locked = proposal?.status === 'submitted';
  useEffect(() => { setNarrative(proposal?.narrative || ''); }, [proposal?.narrative]);

  const allProgrammesSubmitted = data.programmes.length > 0 && data.programmes.every((p) => p.proposal?.status === 'submitted');

  async function saveDraft() {
    setBusy(true);
    try { await api('/plans/university', { method: 'PUT', body: { cycleYear, narrative } }); toast('Draft saved.'); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true);
    try { await api('/plans/university/submit', { method: 'POST', body: { cycleYear } }); toast(`University Annual Plan for ${cycleYear} submitted.`); await reload(); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="card mt-2 border-2 border-accent-500/20">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h2 className="font-display font-bold text-[15px]">University Annual Plan — {cycleYear}</h2>
        <span className={`chip chip-st-${proposal?.status || 'draft'}`}>{STATUS_LABEL[proposal?.status || 'draft']}</span>
      </div>
      <p className="text-[12px] text-ink-secondary mb-3">
        Total budget — approved: <b>{fmtMoney(data.university.approvedBudget)}</b>,
        including not-yet-approved submissions: <b>{fmtMoney(data.university.provisionalBudget)}</b>.
        {!allProgrammesSubmitted && <span className="block mt-1 text-warning font-semibold">Not every Programme's plan has been submitted yet.</span>}
      </p>
      <textarea rows={3} disabled={locked} className="field-input mb-3" placeholder="Compiled university-wide planning narrative for this cycle"
        value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn btn-sm" disabled={locked || busy} onClick={saveDraft}>Save draft</button>
        <button className="btn btn-sm btn-primary" disabled={locked || busy || !narrative.trim()} onClick={submit}>
          Submit University Annual Plan
        </button>
      </div>
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
            <span className={`chip chip-st-${p.proposal?.status || 'draft'}`}>{STATUS_LABEL[p.proposal?.status || 'draft']}</span>
          </div>
          <p className="text-[11.8px] text-ink-secondary mt-1">
            Approved: <b>{fmtMoney(p.approvedBudget)}</b> · Provisional: <b>{fmtMoney(p.provisionalBudget)}</b>
          </p>
          {p.proposal?.narrative && <p className="text-[12.6px] mt-2">{p.proposal.narrative}</p>}
        </div>
      ))}
      <div className="card border-2 border-accent-500/20">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h2 className="font-display font-bold text-[15px]">University Annual Plan</h2>
          <span className={`chip chip-st-${data.university.proposal?.status || 'draft'}`}>{STATUS_LABEL[data.university.proposal?.status || 'draft']}</span>
        </div>
        <p className="text-[12px] text-ink-secondary">
          Approved: <b>{fmtMoney(data.university.approvedBudget)}</b> · Provisional: <b>{fmtMoney(data.university.provisionalBudget)}</b>
        </p>
        {data.university.proposal?.narrative && <p className="text-[12.6px] mt-2">{data.university.proposal.narrative}</p>}
        {!data.university.proposal && <p className="text-[12.6px] text-ink-muted mt-2">Not yet compiled by CPU for this cycle.</p>}
      </div>
    </div>
  );
}
