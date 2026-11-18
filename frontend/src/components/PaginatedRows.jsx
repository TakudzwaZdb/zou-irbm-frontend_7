import { useState } from 'react';

export const TABLE_PAGE_SIZE = 10;

export default function PaginatedRows({ items, colSpan, renderRow, emptyMessage = 'No records to display.' }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * TABLE_PAGE_SIZE;
  const pageItems = items.slice(start, start + TABLE_PAGE_SIZE);

  return (
    <>
      {items.length === 0
        ? <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-ink-muted">{emptyMessage}</td></tr>
        : pageItems.map((item, index) => renderRow(item, start + index))}
      {items.length > TABLE_PAGE_SIZE && (
        <tr className="border-t border-line bg-surface">
          <td colSpan={colSpan} className="px-3 py-2.5">
            <nav aria-label="Table pagination" className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
              <span className="text-ink-secondary">
                Showing {start + 1}–{Math.min(start + TABLE_PAGE_SIZE, items.length)} of {items.length} · 10 per page
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className="btn btn-sm" aria-label="First page" disabled={currentPage === 0} onClick={() => setPage(0)}>First</button>
                <button type="button" className="btn btn-sm" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
                <span aria-live="polite" className="px-2 font-semibold text-ink">Page {currentPage + 1} of {pageCount}</span>
                <button type="button" className="btn btn-sm" aria-label="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button>
                <button type="button" className="btn btn-sm" aria-label="Last page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>Last</button>
              </div>
            </nav>
          </td>
        </tr>
      )}
    </>
  );
}
