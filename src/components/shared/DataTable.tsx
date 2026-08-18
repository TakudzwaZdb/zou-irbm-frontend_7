import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { TableSkeleton } from "./Skeleton";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
}

export function DataTable<T extends { id: string }>({
  columns, rows, pageSize = 8, emptyTitle = "No records found", loading,
}: { columns: Column<T>[]; rows: T[]; pageSize?: number; emptyTitle?: string; loading?: boolean }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice(page * pageSize, page * pageSize + pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  if (loading) return <TableSkeleton columns={columns.length} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => c.sortValue && toggleSort(c.key)}
                  className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 ${c.sortValue ? "cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200" : ""} ${c.align === "right" ? "text-right" : "text-left"}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sortKey === c.key && (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 text-slate-700 dark:text-slate-300 ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <p className="text-xs text-slate-400">Page {page + 1} of {totalPages} · {sorted.length} records</p>
          <div className="flex gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-md border border-slate-200 p-1 text-slate-500 disabled:opacity-30 dark:border-slate-700 dark:text-slate-400">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} className="rounded-md border border-slate-200 p-1 text-slate-500 disabled:opacity-30 dark:border-slate-700 dark:text-slate-400">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
