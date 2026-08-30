import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Audit() {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    api('/audit?limit=300').then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, []);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Audit Log</h1>
        <p className="text-[13px] text-ink-secondary">Most recent {entries ? entries.length : '…'} actions across the system.</p>
      </div>
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
    </div>
  );
}

function Th({ children }) { return <th className="px-3 py-2.5 text-left">{children}</th>; }
function Td({ children, className = '' }) { return <td className={`px-3 py-2.5 ${className}`}>{children}</td>; }
