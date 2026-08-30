import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

function timeAgo(date) {
  if (!date) return '—';
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  return `${mins}m ago`;
}

// The app's only refresh control — nothing here refetches on a timer (see
// AppContext.jsx's refreshAll for why), so this has to be reachable on
// every screen size, not just desktop. Clicking the indicator itself does
// the fast, everyday check (quickRefresh — values/contributions/perf/
// unread only, skipping the rarely-changing org/KPI catalogue), and the
// small caret opens a one-item menu for the slower full refresh, for the
// rarer case something structural changed (a KPI created, someone
// assigned/unassigned, a setting changed).
export default function LiveIndicator() {
  const { lastSync, syncing, quickSyncing, refreshAll, quickRefresh } = useApp();
  const [, tick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  const busy = syncing || quickSyncing;

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  return (
    <div className="relative flex items-center" ref={wrapRef}>
      <button
        onClick={quickRefresh}
        disabled={busy}
        className="flex items-center gap-1.5 text-[11.5px] text-ink-muted hover:text-ink-secondary disabled:cursor-wait px-1 py-1 rounded-l-lg"
        title="Quick refresh — values, contributions, and messages (fast)"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${busy ? 'bg-accent-500 animate-pulse' : 'bg-good'}`} />
        <span className="hidden sm:inline">{syncing ? 'Refreshing…' : quickSyncing ? 'Refreshing…' : `Synced ${timeAgo(lastSync)}`}</span>
      </button>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        className="flex items-center justify-center w-5 h-6 text-ink-muted hover:text-ink-secondary disabled:cursor-wait rounded-r-lg"
        aria-label="Refresh options"
        title="Refresh options"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-line bg-surface shadow-lg z-50 py-1">
          <button
            className="w-full text-left px-3 py-2 text-[12.3px] hover:bg-sunken flex flex-col gap-0.5"
            disabled={busy}
            onClick={() => { quickRefresh(); setMenuOpen(false); }}
          >
            <span className="font-semibold">Quick refresh</span>
            <span className="text-[11px] text-ink-muted">Values, contributions &amp; messages — fast.</span>
          </button>
          <button
            className="w-full text-left px-3 py-2 text-[12.3px] hover:bg-sunken flex flex-col gap-0.5"
            disabled={busy}
            onClick={() => { refreshAll(); setMenuOpen(false); }}
          >
            <span className="font-semibold">Full refresh</span>
            <span className="text-[11px] text-ink-muted">Everything, including KPIs, org &amp; assignments.</span>
          </button>
        </div>
      )}
    </div>
  );
}
