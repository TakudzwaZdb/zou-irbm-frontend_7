import { Fragment, useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { nodeOwnKpis, performanceRollup, varianceRollup, ownerName, VARIANCE_ATTENTION_THRESHOLD, VARIANCE_AHEAD_THRESHOLD, valueStatus, MONTHS } from '../lib/scope.js';
import { labelFor } from '../lib/period.js';
import RagByProgrammeChart from '../components/RagByProgrammeChart.jsx';
import RagPieChart from '../components/RagPieChart.jsx';
import VarianceChart from '../components/VarianceChart.jsx';
import VarianceAlerts from '../components/VarianceAlerts.jsx';
import PeriodTypePicker from '../components/PeriodTypePicker.jsx';

const FLOW_ACTIONS = { submit: 'Submitted', approve: 'Approved', return: 'Returned' };
const FLOW_STYLE = { submit: 'bg-accent-50 text-accent-600', approve: 'bg-good-soft text-good', return: 'bg-warning-soft text-warning' };

export default function Reports() {
  const { org, kpis, values, period, settings, perfPeriod, perfValues, hasPerm } = useApp();

  // An automated appraisal result at every institutional tier — Unit/
  // Department/Faculty/Region, Sub-programme, and Programme — computed live
  // from real KPI progress at whatever cadence is selected above, no manual
  // scoring involved. A full cascade (see lib/scope.js's nodeOwnKpis): a
  // real Individual's own number moves their Unit's score, which moves
  // their Sub-programme's, which moves their Programme's — never siloed at
  // the tier it was entered, so CPU's oversight view is always built from
  // the same real numbers an Individual's own Overview page shows them.
  const unitRows = org.units.map((u) => {
    const unitKpis = nodeOwnKpis(org, kpis, 'unit', u.id);
    return { unit: u, ...performanceRollup(unitKpis, perfValues, settings) };
  });
  const subRows = org.subs.map((s) => {
    const subKpis = nodeOwnKpis(org, kpis, 'sub', s.id);
    return { sub: s, units: unitRows.filter((r) => r.unit.sub_id === s.id), ...performanceRollup(subKpis, perfValues, settings) };
  });
  const programmeRows = org.programmes.map((p) => {
    const progKpis = nodeOwnKpis(org, kpis, 'programme', p.id);
    return {
      p, subs: subRows.filter((r) => r.sub.programme_id === p.id),
      ...performanceRollup(progKpis, perfValues, settings),
      variance: varianceRollup(progKpis, perfValues, settings),
    };
  });

  // RagByProgrammeChart's {p, count, counts} shape — now the exact same
  // cascade as programmeRows above (a Programme's full subtree), so this is
  // just a reshape rather than a second, separately-scoped computation that
  // could quietly drift from the table.
  const chartRows = programmeRows.map((r) => ({ p: r.p, count: r.count, counts: r.counts }));

  const periodLabel = labelFor(perfPeriod.type, perfPeriod.year, perfPeriod.idx, MONTHS);

  // Variance analysis (see lib/scope.js's varianceRollup): each KPI's actual
  // progress vs. the pace expected as of the month its own latest value was
  // recorded in — never a single date for the whole page, so switching the
  // cadence above never falsely penalizes a KPI just because the calendar
  // year it's read against hasn't finished yet. Every KPI in the system,
  // Individual-owned ones included (they cascade into performance now too —
  // see nodeOwnKpis), so this is the one place a reviewer sees every
  // flagged KPI at once, not one node at a time like Overview.
  const orgWideKpis = kpis;
  const orgVariance = varianceRollup(orgWideKpis, perfValues, settings);
  const programmeVarianceData = programmeRows.map((r) => ({
    name: r.p.name, actual: r.avgPct ?? 0, expected: r.variance.avgExpectedPct ?? 0,
    variance: r.variance.avgVariance,
    flag: r.variance.avgVariance == null ? 'none' : r.variance.avgVariance <= VARIANCE_ATTENTION_THRESHOLD ? 'attention' : r.variance.avgVariance >= VARIANCE_AHEAD_THRESHOLD ? 'ahead' : 'on-pace',
  }));
  const orgRagCounts = chartRows.reduce((acc, r) => {
    acc.green += r.counts.green; acc.amber += r.counts.amber; acc.red += r.counts.red; acc.none += r.counts.none;
    return acc;
  }, { green: 0, amber: 0, red: 0, none: 0 });

  // The submission-flow snapshot below is always about the current month's
  // data-entry cycle (see Entry.jsx) — it doesn't move with the performance
  // period picker above, since "who has submitted yet" is inherently monthly.
  const flow = { none: 0, draft: 0, returned: 0, submitted: 0, approved: 0 };
  kpis.forEach((k) => { flow[valueStatus(values[`${k.id}-${period.year}-${period.month}`])]++; });

  // The report is already regenerated from live data the instant a period is
  // picked above — this just captures that same computed table as a real,
  // downloadable artifact for the selected cadence, not a separately typed-up
  // document that could drift from the numbers on screen.
  function downloadCsv() {
    const rows = [['Tier', 'Name', 'KPIs', 'Avg. progress %', 'On track', 'At risk', 'Off track', 'No data']];
    programmeRows.forEach((r) => {
      rows.push(['Programme', r.p.name, r.count, r.avgPct ?? '', r.counts.green, r.counts.amber, r.counts.red, r.counts.none]);
      r.subs.forEach((sr) => {
        rows.push(['Sub-programme', sr.sub.name, sr.count, sr.avgPct ?? '', sr.counts.green, sr.counts.amber, sr.counts.red, sr.counts.none]);
        sr.units.forEach((ur) => {
          rows.push(['Unit', ur.unit.name, ur.count, ur.avgPct ?? '', ur.counts.green, ur.counts.amber, ur.counts.red, ur.counts.none]);
        });
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zou-performance-report-${periodLabel.replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // A genuine document — a real PDF file, generated client-side from the
  // exact same computed `programmeRows`/`orgVariance`/`orgRagCounts` this
  // page already renders on screen, at whatever cadence (Monthly/Quarterly/
  // Bi-annual/Annual) is currently selected above — never a second
  // computation of its own that could quietly drift from the live view, and
  // never dependent on a person remembering to "print to PDF" themselves.
  function downloadPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 40;
    const pageBottom = 780;
    let y = 46;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('ZOU Strategic Plan Monitor — Performance Appraisal Report', marginX, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text(`${periodLabel} · Generated ${new Date().toLocaleString()}`, marginX, y);
    y += 22;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Programme, Sub-programme & Unit performance appraisal`, marginX, y);
    y += 10;

    const body = [];
    programmeRows.forEach((r) => {
      body.push([
        { content: r.p.name, styles: { fontStyle: 'bold', fillColor: [240, 239, 236] } },
        { content: String(r.count), styles: { fontStyle: 'bold', fillColor: [240, 239, 236] } },
        { content: r.avgPct != null ? `${r.avgPct}%` : '—', styles: { fontStyle: 'bold', fillColor: [240, 239, 236] } },
        { content: String(r.counts.green), styles: { fillColor: [240, 239, 236] } },
        { content: String(r.counts.amber), styles: { fillColor: [240, 239, 236] } },
        { content: String(r.counts.red), styles: { fillColor: [240, 239, 236] } },
        { content: String(r.counts.none), styles: { fillColor: [240, 239, 236] } },
      ]);
      r.subs.forEach((sr) => {
        body.push([`   ${sr.sub.name}`, sr.count, sr.avgPct != null ? `${sr.avgPct}%` : '—', sr.counts.green, sr.counts.amber, sr.counts.red, sr.counts.none]);
        sr.units.forEach((ur) => {
          body.push([`      ${ur.unit.name}`, ur.count, ur.avgPct != null ? `${ur.avgPct}%` : '—', ur.counts.green, ur.counts.amber, ur.counts.red, ur.counts.none]);
        });
      });
    });

    autoTable(doc, {
      startY: y + 6,
      margin: { left: marginX, right: marginX },
      head: [['Programme / Sub-programme / Unit', 'KPIs', 'Avg. progress', 'On track', 'At risk', 'Off track', 'No data']],
      body,
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [21, 20, 15], textColor: 255 },
    });

    y = doc.lastAutoTable.finalY + 26;
    if (y > pageBottom - 100) { doc.addPage(); y = 46; }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Variance analysis`, marginX, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Actual progress vs. the pace expected by this point (${orgVariance.avgExpectedPct ?? '—'}% of the year elapsed).`, marginX, y);
    y += 14;

    const flagged = orgVariance.items.filter((it) => it.flag === 'attention' || it.flag === 'ahead');
    if (flagged.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [['KPI', 'Owner', 'Actual %', 'Expected %', 'Variance (pts)', 'Flag']],
        body: flagged.map((it) => [
          it.kpi.name, ownerName(org, it.kpi), `${it.actualPct}%`, `${it.expectedPct}%`, it.variance,
          it.flag === 'attention' ? 'Behind pace' : 'Ahead of pace',
        ]),
        styles: { fontSize: 8.5, cellPadding: 4 },
        headStyles: { fillColor: [21, 20, 15], textColor: 255 },
      });
      y = doc.lastAutoTable.finalY + 22;
    } else {
      doc.setFontSize(9.5);
      doc.text('No KPI is currently flagged for variance.', marginX, y + 8);
      y += 28;
    }

    if (y > pageBottom - 80) { doc.addPage(); y = 46; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`RAG distribution, org-wide`, marginX, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(
      `On track: ${orgRagCounts.green}      At risk: ${orgRagCounts.amber}      Off track: ${orgRagCounts.red}      No data: ${orgRagCounts.none}`,
      marginX, y
    );

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`ZOU IRBM Strategic Plan Monitor · Page ${i} of ${pageCount}`, marginX, 815);
      doc.setTextColor(0);
    }

    doc.save(`zou-performance-report-${periodLabel.replace(/\s+/g, '-')}.pdf`);
  }

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Reports</h1>
          <p className="text-[13px] text-ink-secondary">Automated performance appraisals — {periodLabel}.</p>
        </div>
        <div className="no-print flex gap-2 flex-wrap items-center">
          <PeriodTypePicker />
          <button className="btn btn-sm" onClick={downloadCsv}>Download CSV</button>
          <button className="btn btn-sm btn-primary" onClick={downloadPdf}>Download PDF</button>
          <button className="btn btn-sm" onClick={() => window.print()}>Print report</button>
        </div>
      </div>

      <h2 className="font-display font-bold text-[14.5px] mb-2.5">
        Programme, Sub-programme &amp; Unit performance appraisal — {periodLabel}
      </h2>
      <div className="rounded-xl border border-line bg-surface overflow-x-auto mb-5">
        <table className="w-full text-[12.6px]">
          <thead>
            <tr className="bg-sunken text-[10.8px] uppercase tracking-wide text-ink-muted font-bold">
              <Th>Programme / Sub-programme / Unit</Th><Th>KPIs</Th><Th>Avg. progress</Th><Th>On track</Th><Th>At risk</Th><Th>Off track</Th><Th>No data</Th>
            </tr>
          </thead>
          <tbody>
            {programmeRows.map((r) => (
              <Fragment key={`p${r.p.id}`}>
                <tr className="border-t border-line bg-sunken/60">
                  <Td className="font-bold">{r.p.name}</Td>
                  <Td className="tabular-nums font-semibold">{r.count}</Td>
                  <Td className="tabular-nums font-semibold">{r.avgPct != null ? `${r.avgPct}%` : '—'}</Td>
                  <Td><span className="chip chip-rag-green">{r.counts.green}</span></Td>
                  <Td><span className="chip chip-rag-amber">{r.counts.amber}</span></Td>
                  <Td><span className="chip chip-rag-red">{r.counts.red}</span></Td>
                  <Td><span className="chip chip-rag-none">{r.counts.none}</span></Td>
                </tr>
                {r.subs.map((sr) => (
                  <Fragment key={`s${sr.sub.id}`}>
                    <tr className="border-t border-line bg-sunken/25">
                      <Td className="pl-7 text-ink-secondary font-semibold">↳ {sr.sub.name}</Td>
                      <Td className="tabular-nums">{sr.count}</Td>
                      <Td className="tabular-nums">{sr.avgPct != null ? `${sr.avgPct}%` : '—'}</Td>
                      <Td><span className="chip chip-rag-green">{sr.counts.green}</span></Td>
                      <Td><span className="chip chip-rag-amber">{sr.counts.amber}</span></Td>
                      <Td><span className="chip chip-rag-red">{sr.counts.red}</span></Td>
                      <Td><span className="chip chip-rag-none">{sr.counts.none}</span></Td>
                    </tr>
                    {sr.units.map((ur) => (
                      <tr key={`u${ur.unit.id}`} className="border-t border-line">
                        <Td className="pl-12 text-ink-secondary">↳ {ur.unit.name}</Td>
                        <Td className="tabular-nums">{ur.count}</Td>
                        <Td className="tabular-nums">{ur.avgPct != null ? `${ur.avgPct}%` : '—'}</Td>
                        <Td><span className="chip chip-rag-green">{ur.counts.green}</span></Td>
                        <Td><span className="chip chip-rag-amber">{ur.counts.amber}</span></Td>
                        <Td><span className="chip chip-rag-red">{ur.counts.red}</span></Td>
                        <Td><span className="chip chip-rag-none">{ur.counts.none}</span></Td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-ink-muted mb-6">
        Each row's appraisal is the average progress of its own KPIs AND everything beneath it in the structure —
        a full cascade, at whatever cadence is selected above (data entry itself always stays monthly — this is a
        read-only rollup lens). A real Individual's monthly number moves their Unit's average, which moves their
        Sub-programme's, which moves their Programme's — the same real figure at every tier, never a separate
        re-scoring.
      </p>

      <div className="card mb-5">
        <RagByProgrammeChart rows={chartRows} />
      </div>

      <h2 className="font-display font-bold text-[14.5px] mb-2.5">
        Variance analysis — {periodLabel} <span className="text-ink-muted font-normal text-[12px]">(actual progress vs. the pace expected by this point — {orgVariance.avgExpectedPct ?? '—'}% of the year elapsed)</span>
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-2">
        <div className="card">
          <h3 className="text-[11.5px] uppercase tracking-wide text-ink-muted font-bold mb-1.5">RAG distribution, org-wide — {periodLabel}</h3>
          <RagPieChart counts={orgRagCounts} height={240} />
        </div>
        <div className="card">
          <h3 className="text-[11.5px] uppercase tracking-wide text-ink-muted font-bold mb-1.5">Actual vs. expected pace, by Programme — {periodLabel}</h3>
          <VarianceChart data={programmeVarianceData} height={240} />
        </div>
      </div>
      <VarianceAlerts items={orgVariance.items} periodLabel={periodLabel} />

      <div className="card mb-5">
        <h2 className="font-display font-bold text-[14.5px] mb-2.5">Submission flow — {MONTHS[period.month]} {period.year} <span className="text-[11.8px] font-normal text-ink-muted">(current month, regardless of the period above)</span></h2>
        <div className="flex flex-wrap gap-2">
          <FlowStat label="Not started" value={flow.none + flow.draft} className="bg-sunken text-ink-secondary" />
          <FlowStat label="Returned" value={flow.returned} className="bg-warning-soft text-warning" />
          <FlowStat label="Awaiting review" value={flow.submitted} className="bg-accent-50 text-accent-600" />
          <FlowStat label="Approved" value={flow.approved} className="bg-good-soft text-good" />
        </div>
      </div>

      {hasPerm('view_audit') && <RecentActivity />}
    </div>
  );
}

// A live feed of the last few submit/approve/return actions — the part of
// the flow that Reports otherwise has no visibility into at all. Only shown
// to roles that already hold view_audit (the same people who can see the
// full Audit Log page), so this is a convenience view, not a new permission.
function RecentActivity() {
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    api('/audit?limit=50').then((r) => setEntries(r.entries.filter((e) => FLOW_ACTIONS[e.action]).slice(0, 8))).catch(() => setEntries([]));
  }, []);

  return (
    <div className="card">
      <h2 className="font-display font-bold text-[14.5px] mb-2.5">Recent activity</h2>
      {entries === null && <div className="text-[12.5px] text-ink-muted">Loading…</div>}
      {entries?.length === 0 && <div className="text-[12.5px] text-ink-muted">No submissions, approvals, or returns yet.</div>}
      {entries?.map((e) => (
        <div key={e.id} className="flex items-start gap-2.5 py-1.5 border-t border-line first:border-0 text-[12.6px]">
          <span className={`chip ${FLOW_STYLE[e.action]}`}>{FLOW_ACTIONS[e.action]}</span>
          <span className="flex-1 text-ink-secondary">{e.detail}</span>
          <span className="text-ink-muted text-[11.3px] whitespace-nowrap">{e.user_name || 'System'} · {e.ts}</span>
        </div>
      ))}
    </div>
  );
}

function FlowStat({ label, value, className }) {
  return (
    <div className={`rounded-lg px-3.5 py-2.5 flex-1 min-w-[120px] ${className}`}>
      <div className="text-[10.5px] uppercase tracking-wide font-bold opacity-80">{label}</div>
      <div className="font-display font-extrabold text-[22px] tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children }) { return <th className="px-3 py-2.5 text-left">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2.5 ${className}`}>{children}</td>; }
