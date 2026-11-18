import { useCallback, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import PerformanceAgainstTarget from '../components/PerformanceAgainstTarget.jsx';
import PageSectionTabs from '../components/PageSectionTabs.jsx';
import { GLOBAL_REPORT_ROLES } from '../lib/scope.js';
import PaginatedRows from '../components/PaginatedRows.jsx';
import { csvReportPreamble, downloadCsvFile } from '../lib/csv.js';

function statusLabel(status) {
  return ({
    achieved: 'On track',
    approaching: 'At risk',
    'below-target': 'Off track',
    missing: 'No reported actuals',
    pending: 'Awaiting approval',
    returned: 'Returned for correction',
    'not-calculable': 'Not calculable',
    'no-kpis': 'No assigned KPIs',
  })[status] || status || 'No reported actuals';
}

function periodLabel(data) {
  if (!data) return 'Loading report…';
  const typeNames = { monthly: 'Monthly', quarterly: 'Quarterly', biannual: 'Bi-annual', annual: 'Annual' };
  const periodName = data.periodType === 'monthly'
    ? new Date(Date.UTC(data.cycleYear, data.periodIndex - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })
    : data.periodType === 'quarterly' ? `Q${data.periodIndex}`
      : data.periodType === 'biannual' ? `H${data.periodIndex}` : 'Full year';
  return `${typeNames[data.periodType] || data.periodType} · ${periodName} ${data.cycleYear}`;
}

function reportRows(data) {
  return (data?.nodes || []).map((node) => [
    node.tier,
    node.name,
    node.totalKpis,
    node.achieved,
    node.approaching,
    node.offTrack,
    node.missingActual,
    node.averagePerformance == null ? '' : `${node.averagePerformance}%`,
    statusLabel(node.status),
  ]);
}

export default function ReportsPerformance({ setRoute }) {
  const { user, hasPerm } = useApp();
  const [data, setData] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const allowed = !GLOBAL_REPORT_ROLES.includes(user.role) || hasPerm('view_institutional_performance');
  const handleDataLoaded = useCallback((nextData) => setData(nextData), []);
  const selectedPeriod = periodLabel(data);

  function downloadCsv() {
    if (!data) return;
    const rows = [
      ...csvReportPreamble('KPI PERFORMANCE AGAINST TARGET REPORT', {
        period: selectedPeriod,
        month: data.periodType === 'monthly'
          ? new Date(Date.UTC(data.cycleYear, data.periodIndex - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })
          : `Not applicable (${data.periodType} reporting)`,
        year: data.cycleYear,
      }),
      ['Section 1 | Organisational Performance Summary'],
      ['Organisational tier', 'Organisational unit', 'Assigned KPIs', 'On track', 'At risk', 'Off track', 'Missing actual', 'Average performance against target', 'Status'],
      ...(data.nodes.length ? reportRows(data) : [['', 'No organisational units match the selected filters.']]),
      [],
      ['Section 2 | KPI Target Performance and Pace Detail'],
      ['KPI', 'Owner tier', 'Owner', 'Actual', 'Target', 'Target performance %', 'Expected pace %', 'Pace variance (points)', 'Weight', 'Status'],
      ...((data.kpis || []).length ? data.kpis.map((kpi) => [
        kpi.name,
        kpi.ownerTier,
        [kpi.ownerName, kpi.ownerUnitName].filter(Boolean).join(' · '),
        kpi.actual == null ? '' : `${kpi.actual}${kpi.measure ? ` ${kpi.measure}` : ''}`,
        kpi.target == null ? '' : `${kpi.target}${kpi.measure ? ` ${kpi.measure}` : ''}`,
        kpi.performancePct ?? '',
        kpi.expectedPacePct,
        kpi.paceVariancePct ?? '',
        kpi.weight,
        statusLabel(kpi.status),
      ]) : [['', 'No KPI detail is available for this reporting period.']]),
    ];
    downloadCsvFile(`zou-target-performance-${selectedPeriod.replace(/[^\w-]+/g, '-')}.csv`, rows);
  }

  async function downloadPdf() {
    if (!data) return;
    setPdfBusy(true);
    setExportError(null);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const margin = 36;
      const width = doc.internal.pageSize.getWidth() - margin * 2;
      doc.setFillColor(25, 34, 48);
      doc.roundedRect(margin, 24, width, 54, 8, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text('ZOU Strategic Plan Monitor', margin + 14, 47);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Performance against target · ${selectedPeriod}`, margin + 14, 65);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(`Summary · ${data.summaryName}`, margin, 104);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`KPIs: ${data.summary.totalKpis}    On track: ${data.summary.achieved}    At risk: ${data.summary.approaching}    Off track: ${data.summary.offTrack}    Missing actual: ${data.summary.missingActual}    Weighted performance: ${data.summary.averagePerformance == null ? '—' : `${data.summary.averagePerformance}%`}`, margin, 122);
      autoTable(doc, {
        startY: 140,
        margin: { left: margin, right: margin },
        head: [['Tier', 'Organisational unit', 'KPIs', 'On track', 'At risk', 'Off track', 'Missing actual', 'Performance', 'Status']],
        body: reportRows(data),
        styles: { fontSize: 8.5, cellPadding: 5, lineColor: [218, 223, 230], lineWidth: 0.35 },
        headStyles: { fillColor: [25, 34, 48], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 249, 251] },
        columnStyles: { 0: { cellWidth: 75 }, 1: { cellWidth: 155 } },
      });
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 22,
        margin: { left: margin, right: margin },
        head: [['KPI / owner', 'Actual', 'Target', 'Target performance', 'Expected pace', 'Pace variance', 'Weight', 'Status']],
        body: (data.kpis || []).map((kpi) => [
          `${kpi.name}\n${[kpi.ownerTier, kpi.ownerName, kpi.ownerUnitName].filter(Boolean).join(' · ')}`,
          kpi.actual == null ? '—' : `${kpi.actual}${kpi.measure ? ` ${kpi.measure}` : ''}`,
          kpi.target == null ? '—' : `${kpi.target}${kpi.measure ? ` ${kpi.measure}` : ''}`,
          kpi.performancePct == null ? '—' : `${kpi.performancePct}%`,
          `${kpi.expectedPacePct}%`,
          kpi.paceVariancePct == null ? '—' : `${kpi.paceVariancePct} pts`,
          String(kpi.weight ?? '—'),
          statusLabel(kpi.status),
        ]),
        styles: { fontSize: 7.5, cellPadding: 4, lineColor: [218, 223, 230], lineWidth: 0.35, overflow: 'linebreak' },
        headStyles: { fillColor: [25, 34, 48], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 249, 251] },
        columnStyles: { 0: { cellWidth: 175 }, 1: { cellWidth: 68 }, 2: { cellWidth: 68 }, 3: { cellWidth: 74 }, 4: { cellWidth: 68 }, 5: { cellWidth: 68 }, 6: { cellWidth: 42 }, 7: { cellWidth: 75 } },
      });
      const pageCount = doc.internal.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text(`Generated ${new Date().toLocaleString()} · Page ${page} of ${pageCount}`, margin, doc.internal.pageSize.getHeight() - 18);
      }
      doc.save(`zou-target-performance-${selectedPeriod.replace(/[^\w-]+/g, '-')}.pdf`);
    } catch (error) {
      setExportError(error.message || 'The PDF report could not be generated.');
    } finally {
      setPdfBusy(false);
    }
  }

  if (!allowed) {
    return (
      <div>
        <div className="card mb-4 border-l-4 border-l-accent-500">
          <h1 className="text-xl font-bold mb-1">Reports · Performance</h1>
          <p className="text-[13px] text-ink-secondary">Target-performance reporting across your authorised scope.</p>
        </div>
        <PageSectionTabs parent="reports" currentRoute="reportsPerformance" onNavigate={setRoute} />
        <div role="alert" className="card text-[13px] text-ink-secondary">
          Institutional performance reports are not available to your account. Contact an administrator if you need access.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-4 border-l-4 border-l-accent-500">
        <div className="flex justify-between gap-4 flex-wrap items-start">
          <div>
            <h1 className="text-xl font-bold mb-1">Reports · Performance</h1>
            <p className="text-[13px] text-ink-secondary">
              Target-based summary, tier comparison and organisational drill-down for {selectedPeriod}.
            </p>
          </div>
          <div className="no-print flex gap-2 flex-wrap">
            <button type="button" className="btn btn-sm" disabled={!data} onClick={downloadCsv}>Download CSV</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!data || pdfBusy} onClick={downloadPdf}>
              {pdfBusy ? 'Preparing…' : 'Download PDF'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => window.print()}>Print report</button>
          </div>
        </div>
      </div>
      <PageSectionTabs parent="reports" currentRoute="reportsPerformance" onNavigate={setRoute} />
      {exportError && <p role="alert" className="card mb-4 text-[12px] text-critical">{exportError}</p>}
      <PerformanceAgainstTarget eyebrow="REPORTS" onDataLoaded={handleDataLoaded} />
      {data && (
        <>
          <div className="card mt-5 mb-3">
            <div className="flex justify-between gap-3 flex-wrap items-start">
              <div>
                <h2 className="font-display font-bold text-[14.5px]">Organisational target-performance detail</h2>
                <p className="text-[11.5px] text-ink-muted mt-1">
                  {data.summaryName} · {selectedPeriod} · each row is scoped to the current tier and unit filters.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface shadow-sm overflow-x-auto max-h-[65vh] overflow-y-auto mb-4">
            <table className="w-full min-w-[980px] text-[12px]">
              <caption className="sr-only">Target performance by organisational unit for {selectedPeriod}</caption>
              <thead className="sticky top-0 z-10">
                <tr className="bg-sunken text-[10px] uppercase tracking-wide text-ink-secondary font-bold border-b border-line-strong">
                  <th className="px-3 py-3 text-left">Organisational tier</th>
                  <th className="px-3 py-3 text-left">Organisational unit</th>
                  <th className="px-3 py-3 text-right">Assigned KPIs</th>
                  <th className="px-3 py-3 text-right">On track</th>
                  <th className="px-3 py-3 text-right">At risk</th>
                  <th className="px-3 py-3 text-right">Off track</th>
                  <th className="px-3 py-3 text-right">Missing actual</th>
                  <th className="px-3 py-3 text-right">Average target performance</th>
                  <th className="px-3 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                <PaginatedRows items={data.nodes} colSpan={9} emptyMessage="No organisational units match these filters." renderRow={(node) => (
                  <tr key={node.key} className="border-t border-line hover:bg-sunken/30">
                    <td className="px-3 py-2.5 text-ink-secondary">{node.tier}</td>
                    <td className="px-3 py-2.5 font-semibold">{node.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{node.totalKpis}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-good">{node.achieved}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-warning">{node.approaching}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-critical">{node.offTrack}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{node.missingActual}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{node.averagePerformance == null ? '—' : `${node.averagePerformance}%`}</td>
                    <td className="px-3 py-2.5">{statusLabel(node.status)}</td>
                  </tr>
                )} />
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-ink-muted">
            Parent rows include subordinate KPI results; do not sum overlapping parent and child rows. Institutional results are weighted from individual KPIs, and missing actuals are not counted as zero.
          </p>
        </>
      )}
    </div>
  );
}
