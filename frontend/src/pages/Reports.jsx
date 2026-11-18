import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';
import { nodeOwnKpis, institutionalRollup, performanceRollup, varianceRollup, ownerName, employeesOfUnit, VARIANCE_ATTENTION_THRESHOLD, VARIANCE_AHEAD_THRESHOLD, valueStatus, MONTHS } from '../lib/scope.js';
import { labelFor } from '../lib/period.js';
import { employeePosition } from '../lib/orgDisplay.js';
import RagByProgrammeChart from '../components/RagByProgrammeChart.jsx';
import RagPieChart from '../components/RagPieChart.jsx';
import VarianceChart from '../components/VarianceChart.jsx';
import VarianceAlerts from '../components/VarianceAlerts.jsx';
import PeriodTypePicker from '../components/PeriodTypePicker.jsx';
import PageSectionTabs from '../components/PageSectionTabs.jsx';
import FocusedReportSection from '../components/FocusedReportSection.jsx';
import PaginatedRows from '../components/PaginatedRows.jsx';
import { csvReportPreamble, downloadCsvFile } from '../lib/csv.js';

const FLOW_ACTIONS = { submit: 'Submitted', approve: 'Approved', return: 'Returned' };
const FLOW_STYLE = { submit: 'bg-accent-50 text-accent-600', approve: 'bg-good-soft text-good', return: 'bg-warning-soft text-warning' };

export default function Reports({ setRoute }) {
  const { org, kpis, values, period, settings, perfPeriod, perfValues, hasPerm, user } = useApp();
  // Individual performance reports are oversight-only by deliberate policy
  // (see FocusedReportSection's own header note) — a plain Employee account
  // never gets a per-staff breakdown here either, even one that happens to
  // include their own row alongside others in their unit.
  const canSeeStaffRows = user.role !== 'employee';
  const [showStaff, setShowStaff] = useState(false);
  const [designationFilter, setDesignationFilter] = useState('');
  const [alertReport, setAlertReport] = useState(null);
  const [alertReportError, setAlertReportError] = useState(null);
  // jsPDF + jspdf-autotable are a genuinely heavy pair (see the "before"
  // bundle stats in README) that only this button ever needs — every other
  // role/page was paying for them in the main bundle on every load whether
  // they ever opened Reports or not. Dynamic import() pulls them into their
  // own chunk that only downloads the first time someone actually clicks
  // Download PDF, so the busy state below just covers that one-time fetch.
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setAlertReport(null);
    setAlertReportError(null);
    api(`/performance-alerts/report/summary?year=${period.year}&month=${period.month}`)
      .then((result) => { if (active) setAlertReport(result); })
      .catch((err) => { if (active) setAlertReportError(err.message || 'Alert reporting could not be loaded.'); });
    return () => { active = false; };
  }, [period.year, period.month]);

  // An automated appraisal result at every institutional tier — Unit/
  // Department/Faculty/Region, Sub-programme, and Programme — computed live
  // from real KPI progress at whatever cadence is selected above, no manual
  // scoring involved. A full cascade (see lib/scope.js's nodeOwnKpis): a
  // real Employee's own number moves their Unit's score, which moves
  // their Sub-programme's, which moves their Programme's — never siloed at
  // the tier it was entered, so CPU's oversight view is always built from
  // the same real numbers an Employee's own Overview page shows them.
  const unitRows = org.units.map((u) => {
    const unitKpis = nodeOwnKpis(org, kpis, 'unit', u.id);
    // Each staff member's OWN KPIs only (nodeOwnKpis('employee', ...) never
    // cascades anything further down — nothing sits below an Employee) —
    // never a second, separately-scoped computation from the Unit row's own
    // cascaded total just above, so the two can never quietly disagree.
    const employees = employeesOfUnit(org, u.id).map((e) => ({
      employee: e, ...performanceRollup(nodeOwnKpis(org, kpis, 'employee', e.id), perfValues, settings),
    }));
    return { unit: u, employees, ...performanceRollup(unitKpis, perfValues, settings) };
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
  const reportRows = programmeRows.flatMap((programme) => [
    { key: `p${programme.p.id}`, name: programme.p.name, level: 0, ...programme },
    ...programme.subs.flatMap((sub) => [
      { key: `s${sub.sub.id}`, name: sub.sub.name, level: 1, ...sub },
      ...sub.units.flatMap((unit) => [
        { key: `u${unit.unit.id}`, name: unit.unit.name, level: 2, ...unit },
        ...(showStaff && canSeeStaffRows
          ? unit.employees
            .filter((employee) => !designationFilter || employeePosition(employee.employee) === designationFilter)
            .map((employee) => ({
              key: `e${employee.employee.id}`,
              name: employeePosition(employee.employee),
              level: 3,
              ...employee,
            }))
          : []),
      ]),
    ]),
  ]);

  const periodLabel = labelFor(perfPeriod.type, perfPeriod.year, perfPeriod.idx, MONTHS);

  // Variance analysis (see lib/scope.js's varianceRollup): each KPI's actual
  // progress vs. the pace expected as of the month its own latest value was
  // recorded in — never a single date for the whole page, so switching the
  // cadence above never falsely penalizes a KPI just because the calendar
  // year it's read against hasn't finished yet. Every KPI in the system,
  // Employee-owned ones included (they cascade into performance now too —
  // see nodeOwnKpis), so this is the one place a reviewer sees every
  // flagged KPI at once, not one node at a time like Overview.
  const orgWideKpis = kpis;
  const orgVariance = varianceRollup(orgWideKpis, perfValues, settings);
  const overallRollup = institutionalRollup(org, orgWideKpis, perfValues, settings).performance;
  const designations = [...new Set(org.employees.map(employeePosition))].sort((a, b) => a.localeCompare(b));
  const programmeVarianceData = programmeRows.map((r) => ({
    name: r.p.name, actual: r.avgPct ?? 0, expected: r.variance.avgExpectedPct ?? 0,
    variance: r.variance.avgVariance,
    flag: r.variance.avgVariance == null ? 'none' : r.variance.avgRawVariance <= VARIANCE_ATTENTION_THRESHOLD ? 'attention' : r.variance.avgRawVariance < 0 ? 'behind' : r.variance.avgRawVariance >= VARIANCE_AHEAD_THRESHOLD ? 'ahead' : 'on-pace',
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
    const reportMonth = perfPeriod.type === 'monthly'
      ? new Date(Date.UTC(perfPeriod.year, perfPeriod.idx - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })
      : `Not applicable (${perfPeriod.type} reporting)`;
    const rows = [
      ...csvReportPreamble('ORGANISATIONAL PERFORMANCE REPORT', {
        period: periodLabel,
        month: reportMonth,
        year: perfPeriod.year,
      }),
      ['Submission and alerts month', `${MONTHS[period.month]} ${period.year}`],
      [],
      ['Section 1 | Organisational Performance Summary'],
      ['Tier', 'Organisation / designation', 'KPIs', 'Avg. progress %', 'On track', 'At risk', 'Off track', 'No data'],
    ];
    if (programmeRows.length === 0) rows.push(['', 'No organisational performance data is available for this period.']);
    programmeRows.forEach((r) => {
      rows.push(['Programme', r.p.name, r.count, r.avgPct ?? '', r.counts.green, r.counts.amber, r.counts.red, r.counts.none]);
      r.subs.forEach((sr) => {
        rows.push(['Sub-programme', sr.sub.name, sr.count, sr.avgPct ?? '', sr.counts.green, sr.counts.amber, sr.counts.red, sr.counts.none]);
        sr.units.forEach((ur) => {
          rows.push(['Unit', ur.unit.name, ur.count, ur.avgPct ?? '', ur.counts.green, ur.counts.amber, ur.counts.red, ur.counts.none]);
          if (showStaff && canSeeStaffRows) {
            ur.employees.forEach((er) => {
              if (!designationFilter || employeePosition(er.employee) === designationFilter) {
                rows.push(['Designation', employeePosition(er.employee), er.count, er.avgPct ?? '', er.counts.green, er.counts.amber, er.counts.red, er.counts.none]);
              }
            });
          }
        });
      });
    });
    if (alertReport) {
      rows.push([]);
      rows.push(['Section 2 | Performance Alerts and Escalations']);
      rows.push(['Reporting month', `${MONTHS[period.month]} ${period.year}`]);
      rows.push(['Category', 'Status / severity', 'Count']);
      rows.push(['Alerts', 'Total', alertReport.totalAlerts]);
      rows.push(['Alerts', 'Critical', alertReport.bySeverity.red]);
      rows.push(['Alerts', 'Warning', alertReport.bySeverity.amber]);
      rows.push(['Alerts', 'Missing', alertReport.bySeverity.missing]);
      rows.push(['Escalations', 'Open', alertReport.byEscalationStatus.open]);
      rows.push(['Escalations', 'Acknowledged', alertReport.byEscalationStatus.acknowledged]);
      rows.push(['Escalations', 'In progress', alertReport.byEscalationStatus.in_progress]);
      rows.push(['Escalations', 'Resolved', alertReport.byEscalationStatus.resolved]);
      rows.push(['Corrective actions', 'Open', alertReport.byActionStatus.submitted + alertReport.byActionStatus.approved + alertReport.byActionStatus.in_progress]);
      rows.push(['Corrective actions', 'Completed', alertReport.byActionStatus.completed]);
      rows.push(['Corrective actions', 'Overdue', alertReport.byActionStatus.overdue]);
      rows.push([]);
      rows.push(['Section 3 | Monthly Alert Trend']);
      rows.push(['Month', 'Active alerts', 'Critical', 'Warning', 'Missing']);
      alertReport.trends.forEach((point) => rows.push([
        `${MONTHS[point.month]} ${point.year}`, point.active, point.red, point.amber, point.missing,
      ]));
    }
    downloadCsvFile(`zou-performance-report-${periodLabel.replace(/\s+/g, '-')}.csv`, rows);
  }

  // A genuine document — a real PDF file, generated client-side from the
  // exact same computed `programmeRows`/`orgVariance`/`orgRagCounts` this
  // page already renders on screen, at whatever cadence (Monthly/Quarterly/
  // Bi-annual/Annual) is currently selected above — never a second
  // computation of its own that could quietly drift from the live view, and
  // never dependent on a person remembering to "print to PDF" themselves.
  async function downloadPdf() {
    setPdfBusy(true);
    let jsPDF, autoTable;
    try {
      [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    } catch {
      setPdfBusy(false);
      window.alert('Could not load the PDF generator. Check your connection and try again.');
      return;
    }
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 40;
    const contentWidth = doc.internal.pageSize.getWidth() - marginX * 2;
    const pageBottom = 780;
    let y = 104;

    doc.setFillColor(25, 34, 48);
    doc.roundedRect(marginX, 26, contentWidth, 62, 8, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('ZOU Strategic Plan Monitor', marginX + 14, 50);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`Performance appraisal · ${periodLabel} · Generated ${new Date().toLocaleString()}`, marginX + 14, 70);
    doc.setTextColor(0, 0, 0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Performance summary by organisation', marginX, y);
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
          if (showStaff && canSeeStaffRows) {
            ur.employees.forEach((er) => {
              if (!designationFilter || employeePosition(er.employee) === designationFilter) {
                body.push([`         ${employeePosition(er.employee)}`, er.count, er.avgPct != null ? `${er.avgPct}%` : '—', er.counts.green, er.counts.amber, er.counts.red, er.counts.none]);
              }
            });
          }
        });
      });
    });

    autoTable(doc, {
      startY: y + 6,
      margin: { left: marginX, right: marginX },
      head: [['Programme / Sub-programme / Unit / Designation', 'KPIs', 'Avg. progress', 'On track', 'At risk', 'Off track', 'No data']],
      body,
      styles: { fontSize: 9, cellPadding: 4.5, lineColor: [218, 223, 230], lineWidth: 0.35, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [25, 34, 48], textColor: 255, fontStyle: 'bold', fontSize: 8.8 },
      alternateRowStyles: { fillColor: [248, 249, 251] },
      columnStyles: {
        0: { cellWidth: 185 },
        1: { cellWidth: 38, halign: 'right' },
        2: { cellWidth: 62, halign: 'right' },
        3: { cellWidth: 55, halign: 'right' },
        4: { cellWidth: 55, halign: 'right' },
        5: { cellWidth: 55, halign: 'right' },
        6: { cellWidth: 55, halign: 'right' },
      },
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

    const flagged = orgVariance.items.filter((it) => it.flag === 'attention' || it.flag === 'behind' || it.flag === 'ahead');
    if (flagged.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        head: [['KPI', 'Owner', 'Actual %', 'Expected %', 'Variance (pts)', 'Flag']],
        body: flagged.map((it) => [
          it.kpi.name, reportOwnerLabel(org, it.kpi), `${it.actualPct}%`, `${it.expectedPct}%`, it.variance,
          it.flag === 'attention' || it.flag === 'behind' ? 'Behind pace' : 'Ahead of pace',
        ]),
        styles: { fontSize: 8.5, cellPadding: 4, lineColor: [224, 226, 230], lineWidth: 0.3 },
        headStyles: { fillColor: [25, 34, 48], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 249, 251] },
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
    y += 28;
    if (alertReport && y > pageBottom - 130) { doc.addPage(); y = 46; }
    if (alertReport) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(`Alerts, escalations & corrective actions · ${MONTHS[period.month]} ${period.year}`, marginX, y);
      y += 10;
      autoTable(doc, {
        startY: y + 6,
        margin: { left: marginX, right: marginX },
        head: [['Category', 'Count', 'Category', 'Count']],
        body: [
          ['Critical alerts', alertReport.bySeverity.red, 'Warning alerts', alertReport.bySeverity.amber],
          ['Missing reports', alertReport.bySeverity.missing, 'Total alerts', alertReport.totalAlerts],
          ['Open escalations', alertReport.byEscalationStatus.open, 'Resolved escalations', alertReport.byEscalationStatus.resolved],
          ['In-progress actions', alertReport.byActionStatus.in_progress, 'Overdue actions', alertReport.byActionStatus.overdue],
        ],
        styles: { fontSize: 9, cellPadding: 5, lineColor: [218, 223, 230], lineWidth: 0.35 },
        headStyles: { fillColor: [25, 34, 48], textColor: 255 },
      });
      y = doc.lastAutoTable.finalY + 18;
      doc.setFont('helvetica', 'bold');
      doc.text('12-month active alert trend', marginX, y);
      y += 14;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(alertReport.trends.map((point) => `${MONTHS[point.month].slice(0, 3)} ${String(point.year).slice(-2)}: ${point.active}`).join('   '), marginX, y, { maxWidth: contentWidth });
    }

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`ZOU IRBM Strategic Plan Monitor · Page ${i} of ${pageCount}`, marginX, 815);
      doc.setTextColor(0);
    }

    doc.save(`zou-performance-report-${periodLabel.replace(/\s+/g, '-')}.pdf`);
    setPdfBusy(false);
  }

  return (
    <div>
      <div className="card mb-4 border-l-4 border-l-accent-500">
        <div className="flex justify-between gap-4 flex-wrap items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold">Progress reports</h1>
              <span className="chip bg-accent-50 text-accent-600">{periodLabel}</span>
            </div>
            <p className="text-[13px] text-ink-secondary">
              Live performance, risk, and submission reporting across your reporting scope.
            </p>
          </div>
          <div className="no-print flex gap-2 flex-wrap items-center">
            <PeriodTypePicker />
            <button className="btn btn-sm" onClick={downloadCsv}>Download CSV</button>
            <button className="btn btn-sm btn-primary" disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? 'Preparing…' : 'Download PDF'}</button>
            <button className="btn btn-sm" onClick={() => window.print()}>Print report</button>
          </div>
        </div>
      </div>
      <PageSectionTabs parent="reports" currentRoute="reports" onNavigate={setRoute} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        <ReportMetric label="KPIs in scope" value={overallRollup.count} accent="border-l-line" />
        <ReportMetric label="Average progress" value={overallRollup.avgPct != null ? `${overallRollup.avgPct}%` : '—'} accent="border-l-accent-500" />
        <ReportMetric label="On track" value={overallRollup.counts.green} accent="border-l-good" />
        <ReportMetric label="At risk" value={overallRollup.counts.amber} accent="border-l-warning" />
        <ReportMetric label="Off track" value={overallRollup.counts.red} accent="border-l-critical" />
      </div>

      {alertReportError
        ? <p role="alert" className="card mb-5 border-l-4 border-l-critical text-[12px] text-critical">{alertReportError}</p>
        : alertReport && <AlertOperationsReport data={alertReport} />}

      <FocusedReportSection org={org} kpis={kpis} perfValues={perfValues} settings={settings} user={user} periodLabel={periodLabel} />

      <div className="card mb-3">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h2 className="font-display font-bold text-[14.5px]">
              Organisational performance
            </h2>
            <p className="text-[11.8px] text-ink-muted">Programme, sub-programme, unit, and designation rollups for {periodLabel}.</p>
          </div>
          {canSeeStaffRows && (
            <div className="no-print flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[12px] font-semibold select-none">
                <input type="checkbox" checked={showStaff} onChange={(e) => setShowStaff(e.target.checked)} />
                Show designation rows
              </label>
              <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
                <span>Designation</span>
                <select className="field-input py-1.5 w-auto max-w-[220px]" aria-label="Filter employee rows by designation" value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)}>
                  <option value="">All designations</option>
                  {designations.map((designation) => <option key={designation} value={designation}>{designation}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      </div>

      <h2 className="hidden print:block font-display font-bold text-[14.5px] mb-2.5">
        Organisational performance — {periodLabel}
      </h2>
      <div className="rounded-xl border border-line bg-surface shadow-sm overflow-x-auto max-h-[65vh] overflow-y-auto mb-5">
        <table className="report-table w-full min-w-[900px] text-[13px]">
          <caption className="sr-only">Organisational performance results for {periodLabel}</caption>
          <thead className="sticky top-0 z-10 shadow-sm">
            <tr className="bg-sunken text-[11px] uppercase tracking-wide text-ink-secondary font-bold border-b border-line-strong">
              <Th>Programme / Sub-programme / Unit / Designation</Th><Th>KPIs</Th><Th>Avg. progress</Th><Th>On track</Th><Th>At risk</Th><Th>Off track</Th><Th>No data</Th>
            </tr>
          </thead>
          <tbody>
            <PaginatedRows items={reportRows} colSpan={7} emptyMessage="No organisational performance records to display." renderRow={(row) => (
              <tr
                key={row.key}
                className={`border-t border-line ${row.level === 0 ? 'bg-sunken/75' : row.level === 1 ? 'bg-sunken/45' : 'hover:bg-sunken/30'}`}
              >
                <Td className={`${row.level === 0 ? 'font-bold' : row.level === 1 ? 'text-ink-secondary font-semibold' : row.level === 2 ? 'text-ink-secondary' : 'text-ink-muted text-[12px]'} ${row.level === 1 ? 'pl-7' : row.level === 2 ? 'pl-12' : row.level === 3 ? 'pl-16' : ''}`}>
                  {row.level > 0 ? '↳ ' : ''}{row.name}
                </Td>
                <Td className={`tabular-nums ${row.level === 0 ? 'font-semibold' : ''}`}>{row.count}</Td>
                <Td className={`tabular-nums ${row.level === 0 ? 'font-semibold' : ''}`}>{row.avgPct != null ? `${row.avgPct}%` : '—'}</Td>
                <Td><span className="chip chip-rag-green">{row.counts.green}</span></Td>
                <Td><span className="chip chip-rag-amber">{row.counts.amber}</span></Td>
                <Td><span className="chip chip-rag-red">{row.counts.red}</span></Td>
                <Td><span className="chip chip-rag-none">{row.counts.none}</span></Td>
              </tr>
            )} />
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-ink-muted mb-6">
        Each row's appraisal is the average progress of its own KPIs AND everything beneath it in the structure —
        a full cascade, at whatever cadence is selected above (data entry itself always stays monthly — this is a
        read-only rollup lens). A real Employee's monthly number moves their Unit's average, which moves their
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
      <VarianceAlerts items={orgVariance.items} periodLabel={periodLabel} hidePersonNames />

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
          <span className="flex-1 text-ink-secondary">KPI submission workflow</span>
          <span className="text-ink-muted text-[11.3px] whitespace-nowrap">{e.ts}</span>
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

function AlertOperationsReport({ data }) {
  const maxActive = Math.max(1, ...data.trends.map((point) => point.active));
  const openActions = data.byActionStatus.submitted + data.byActionStatus.approved + data.byActionStatus.in_progress;
  return (
    <section className="card mb-5" aria-labelledby="alert-operations-report">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 id="alert-operations-report" className="font-display font-bold text-[14.5px]">Alerts, escalations &amp; corrective actions</h2>
          <p className="text-[11.5px] text-ink-muted">Current reporting month · {MONTHS[data.period.month]} {data.period.year}</p>
        </div>
        <span className="text-[11px] text-ink-muted">The 12-month trend counts unresolved alerts in the authorised reporting scope.</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <ReportMetric label="Critical alerts" value={data.bySeverity.red} accent="border-l-critical" />
        <ReportMetric label="Warning alerts" value={data.bySeverity.amber} accent="border-l-warning" />
        <ReportMetric label="Missing reports" value={data.bySeverity.missing} accent="border-l-line-strong" />
        <ReportMetric label="Open / active actions" value={`${openActions} · ${data.byActionStatus.overdue} overdue`} accent="border-l-good" />
      </div>
      <h3 className="text-[10.8px] uppercase tracking-wide text-ink-muted font-bold mb-2">Active alert trend</h3>
      <div className="space-y-1.5">
        {data.trends.map((point) => (
          <div key={`${point.year}-${point.month}`} className="grid grid-cols-[78px_1fr_34px] items-center gap-2 text-[10.5px]">
            <span className="text-ink-muted">{MONTHS[point.month].slice(0, 3)} {point.year}</span>
            <div className="h-2 rounded-full bg-sunken overflow-hidden" aria-label={`${point.active} active alerts`}>
              <div className="h-full bg-critical" style={{ width: `${(point.active / maxActive) * 100}%` }} />
            </div>
            <span className="text-right tabular-nums text-ink-secondary">{point.active}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[10.5px]">
        <span className="chip bg-sunken text-ink-secondary">Escalations: {Object.values(data.byEscalationStatus).reduce((sum, count) => sum + count, 0)}</span>
        <span className="chip bg-sunken text-ink-secondary">Resolved actions: {data.byActionStatus.completed}</span>
        <span className="chip bg-sunken text-ink-secondary">Rejected actions: {data.byActionStatus.rejected}</span>
      </div>
    </section>
  );
}

function ReportMetric({ label, value, accent }) {
  return (
    <div className={`card border-l-4 ${accent} px-3.5 py-3`}>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-bold">{label}</div>
      <div className="font-display font-extrabold text-[22px] tabular-nums text-ink">{value}</div>
    </div>
  );
}

function reportOwnerLabel(org, kpi) {
  if (kpi.owner_type === 'employee') {
    const employee = org.employees.find((item) => item.id === kpi.owner_id);
    return employee ? employeePosition(employee) : 'Employee';
  }
  return ownerName(org, kpi);
}

function Th({ children }) { return <th className="px-3 py-3 text-left">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-3 ${className}`}>{children}</td>; }
