import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { computeAlerts } from '../lib/alerts.js';
import { readSeen, writeSeen } from '../lib/seenAlerts.js';

const KIND_STYLE = {
  returned: 'bg-warning-soft text-warning',
  pending: 'bg-accent-50 text-accent-600',
  offtrack: 'bg-critical-soft text-critical',
};
const KIND_LABEL = { returned: 'Returned', pending: 'Pending review', offtrack: 'Off track' };

// The alert list itself is never something to clear on its own — every
// entry here is a live, real condition (a return, a pending review, an
// off-track KPI), so it stays listed for as long as that's actually true,
// exactly like Approvals Queue or My Data Entry never hide a real duty.
// What DOES clear is the badge, and it counts down one at a time as each
// alert is actually opened — clicking one to go act on it (see lib/
// seenAlerts.js) — rather than jumping straight to zero the moment the
// bell is merely clicked to glance at the list. Opening the dropdown
// itself marks nothing as seen: the number only ever drops by exactly the
// alerts genuinely opened, so the badge stays an honest count of what's
// still unopened, never pretending a glance was a read.
export default function AlertsBell({ setRoute }) {
  const { org, kpis, values, settings, user, period, assignments, contributions } = useApp();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => readSeen(user.id));
  const alerts = useMemo(
    () => computeAlerts(org, kpis, values, settings, user, period, assignments, contributions),
    [org, kpis, values, settings, user, period, assignments, contributions],
  );
  const signature = (a) => `${a.id}|${a.message}`;
  const unseenCount = alerts.filter((a) => !seen.has(signature(a))).length;

  // Re-read this account's own seen set on login/switch — a fresh `user.id`
  // means a different person signed into the same browser, who must never
  // inherit (or silently clear) someone else's already-seen alerts.
  useEffect(() => { setSeen(readSeen(user.id)); }, [user.id]);

  function toggleOpen() {
    setOpen((v) => !v);
  }

  // Marks exactly ONE alert as seen — called when it's actually opened
  // (clicked through to), so the badge counts down one at a time as each
  // item is dealt with, rather than the whole unseen count vanishing the
  // instant someone opens the dropdown to look.
  function markSeen(alert) {
    const merged = new Set(seen);
    merged.add(signature(alert));
    setSeen(merged);
    writeSeen(user.id, merged);
  }

  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button
        onClick={toggleOpen}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg border border-line-strong bg-surface hover:bg-sunken"
        aria-label={unseenCount > 0 ? `Alerts, ${unseenCount} unread` : 'Alerts'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] text-sky-500" aria-hidden="true">
          <path d="M18 8.5a6 6 0 1 0-12 0c0 5.5-2 7-2 7h16s-2-1.5-2-7Z" />
          <path d="M10.5 21a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unseenCount > 0 && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-critical text-white text-[10px] font-bold flex items-center justify-center">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" aria-label="Alerts" className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg z-50">
            <div className="px-3.5 py-2.5 border-b border-line font-display font-bold text-[13px]">
              Alerts {alerts.length > 0 && <span className="text-ink-muted font-normal">({alerts.length})</span>}
            </div>
            {alerts.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-[12.5px] text-ink-muted">Nothing needs your attention.</div>
            ) : (
              alerts.map((a) => (
                <button
                  key={a.id}
                  role="menuitem"
                  onClick={() => { markSeen(a); setRoute(a.route); setOpen(false); }}
                  className="w-full text-left px-3.5 py-2.5 border-b border-line last:border-0 hover:bg-sunken flex items-start gap-2"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className={`chip w-fit ${KIND_STYLE[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                    <span className="text-[12.3px] text-ink-secondary leading-snug">{a.message}</span>
                  </div>
                  {!seen.has(signature(a)) && (
                    <span className="w-2 h-2 rounded-full bg-accent-500 flex-none mt-1.5" aria-label="Unopened" title="Unopened" />
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
