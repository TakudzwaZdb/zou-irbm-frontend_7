import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const PAGE_SIZE = 200;

// Real pagination (see backend/src/routes/audit.js) — the log only grows,
// so a fixed "first N rows, forever" cap meant anything older eventually
// became permanently unreachable from this page. Loads one page at a time
// and appends as the person asks for more, rather than trying to fetch
// the whole (ever-growing) history up front.
export default function Audit() {
  const [entries, setEntries] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/audit?limit=${PAGE_SIZE}`)
      .then((r) => { setEntries(r.entries); setHasMore(r.hasMore); setCursor(r.nextCursor); })
      .catch((err) => { setEntries([]); setError(err.message); });
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api(`/audit?limit=${PAGE_SIZE}&before=${cursor}`);
      setEntries((prev) => [...prev, ...r.entries]);
      setHasMore(r.hasMore);
      setCursor(r.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Audit Log</h1>
        <p className="text-[13px] text-ink-secondary">
          {entries ? `${entries.length} action${entries.length === 1 ? '' : 's'} loaded, most recent first.` : 'Loading…'}
        </p>
      </div>
      {error && <div className="mb-3 rounded-lg bg-critical-soft text-critical text-[12px] px-3 py-2">{error}</div>}
      <div className="rounded-xl border border-line bg-surface overflow-x-auto max-h-[62vh] overflow-y-auto">
        <table className="w-full text-[12.6px] min-w-[640px]">
          <thead className="sticky top-0">
            <tr className="bg-sunken text-[10.8px] uppercase tracking-wide text-ink-muted font-bold">
              <Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Entity</Th><Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {(entries || []).map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <Td className="text-ink-muted whitespace-nowrap">{e.ts}</Td>
                <Td>{e.user_name || 'System'}</Td>
                <Td><span className="chip chip-tag">{e.action}</span></Td>
                <Td>{e.entity}{e.entity_id ? ` #${e.entity_id}` : ''}</Td>
                <Td>{e.detail || ''}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button className="btn btn-sm" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function Th({ children }) { return <th className="px-3 py-2.5 text-left">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2.5 ${className}`}>{children}</td>; }
