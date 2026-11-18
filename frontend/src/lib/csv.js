export function csvReportPreamble(title, { period, month, year, scope } = {}) {
  return [
    ['ZOU IRBM | STRATEGIC PLAN MONITOR'],
    [title],
    [],
    ['REPORT DETAILS'],
    ['Reporting period', period || 'Not specified'],
    ['Reporting month', month || 'Not specified'],
    ['Reporting year', year ?? 'Not specified'],
    ...(scope ? [['Organisation scope', scope]] : []),
    ['Exported at (UTC)', new Date().toISOString()],
    [],
  ];
}

export function downloadCsvFile(filename, rows) {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const csv = `\uFEFF${rows
    .map((row) => Array.from({ length: columnCount }, (_, index) => `"${String(row[index] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
