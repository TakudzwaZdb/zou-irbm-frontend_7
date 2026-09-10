import { useEffect, useMemo, useState, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { computeAlerts } from '../lib/alerts.js';
import { readSeen, writeSeen } from '../lib/seenAlerts.js';

const KIND_STYLE = {
  returned: 'bg-warning-soft text-warning',
  pending: 'bg-accent-50 text-accent-600',
  offtrack: 'bg-critical-soft text-critical',
};

const KIND_LABEL = { 
  returned: 'Returned', 
  pending: 'Pending review', 
  offtrack: 'Off track' 
};

const getAlertSignature = (alert) => `${alert.id}|${alert.message}`;

export default function AlertsBell({ setRoute }) {
  const { org, kpis, values, settings, user, period, assignments, contributions } = useApp();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => readSeen(user.id));
  const [fadingAlertId, setFadingAlertId] = useState(null);
  
  // Shake Animation and Toast references
  const [isShaking, setIsShaking] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const previousSeenSnapshot = useRef(null);
  const toastTimeoutRef = useRef(null);
  const previousCountRef = useRef(0);

  const allAlerts = useMemo(
    () => computeAlerts(org, kpis, values, settings, user, period, assignments, contributions),
    [org, kpis, values, settings, user, period, assignments, contributions],
  );

  const activeAlerts = useMemo(() => {
    return allAlerts.filter((a) => !seen.has(getAlertSignature(a)));
  }, [allAlerts, seen]);

  const unseenCount = activeAlerts.length;

  // Real-time alert listener for shake effect
  useEffect(() => {
    if (unseenCount > previousCountRef.current) {
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 600);
      return () => clearTimeout(timer);
    }
    previousCountRef.current = unseenCount;
  }, [unseenCount]);

  useEffect(() => {
    setSeen(readSeen(user.id));
    setShowToast(false);
  }, [user.id]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  function toggleOpen() {
    setOpen((v) => !v);
  }

  function markSeen(alert) {
    const merged = new Set(seen);
    merged.add(getAlertSignature(alert));
    setSeen(merged);
    writeSeen(user.id, Array.from(merged));
  }

  function markAllAsRead() {
    previousSeenSnapshot.current = new Set(seen);
    const merged = new Set(seen);
    allAlerts.forEach((a) => merged.add(getAlertSignature(a)));
    
    setSeen(merged);
    writeSeen(user.id, Array.from(merged));
    setOpen(false);
    setShowToast(true);

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    
    toastTimeoutRef.current = setTimeout(() => {
      setShowToast(false);
      previousSeenSnapshot.current = null;
    }, 5000);
  }

  function handleUndo() {
    if (previousSeenSnapshot.current) {
      setSeen(previousSeenSnapshot.current);
      writeSeen(user.id, Array.from(previousSeenSnapshot.current));
      previousSeenSnapshot.current = null;
    }
    setShowToast(false);
    setOpen(true);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
  }

  function handleAlertClick(alert) {
    setFadingAlertId(alert.id);
    setTimeout(() => {
      markSeen(alert);
      setRoute(alert.route);
      setOpen(false);
      setFadingAlertId(null);
    }, 200);
  }

  function handleDismissSingle(e, alert) {
    e.stopPropagation(); // Stop click from triggering parent routing button
    setFadingAlertId(alert.id);
    setTimeout(() => {
      markSeen(alert);
      setFadingAlertId(null);
    }, 200);
  }

  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      {/* Bell Button Container */}
      <button 
        onClick={toggleOpen} 
        className="relative flex items-center justify-center w-8 h-8 rounded-lg border border-line-strong bg-surface hover:bg-sunken group" 
        aria-label={unseenCount > 0 ? `Alerts, ${unseenCount} unread` : 'Alerts'} 
        aria-haspopup="menu" 
        aria-expanded={open}
      >
        <svg 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="1.8" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          className={`w-[18px] h-[18px] text-sky-500 origin-top transform-gpu ${isShaking ? 'animate-bell-shake' : ''}`} 
          aria-hidden="true"
        >
          <path d="M18 8.5a6 6 0 1 0-12 0c0 5.5-2 7-2 7h16s-2-1.5-2-7Z" />
          <path d="M10.5 21a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unseenCount > 0 && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-critical text-white text-[10px] font-bold flex items-center justify-center">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" aria-label="Alerts" className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg z-50">
            <div className="px-3.5 py-2.5 border-b border-line flex items-center justify-between font-display text-[13px]">
              <span className="font-bold">
                Alerts {unseenCount > 0 && <span className="text-ink-muted font-normal">({unseenCount})</span>}
              </span>
              {unseenCount > 0 && (
                <button 
                  onClick={markAllAsRead}
                  className="text-sky-600 hover:text-sky-700 font-medium transition-colors"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {activeAlerts.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-[12.5px] text-ink-muted">Nothing needs your attention.</div>
            ) : (
              activeAlerts.map((a) => {
                const isFading = fadingAlertId === a.id;
                return (
                  <div 
                    key={a.id}
                    className={`relative group/row transition-all duration-200 border-b border-line last:border-0 ${
                      isFading ? 'opacity-0 scale-95 max-h-0 pointer-events-none' : 'opacity-100 max-h-24'
                    }`}
                  >
                    <button 
                      role="menuitem" 
                      onClick={() => handleAlertClick(a)} 
                      className="w-full text-left px-3.5 py-2.5 pr-8 hover:bg-sunken flex items-start gap-2"
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className={`chip w-fit ${KIND_STYLE[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                        <span className="text-[12.3px] text-ink-secondary leading-snug">{a.message}</span>
                      </div>
                    </button>
                    
                    {/* Inline Row Dismiss Button */}
                    <button
                      onClick={(e) => handleDismissSingle(e, a)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-ink-muted hover:text-ink hover:bg-line opacity-0 group-hover/row:opacity-100 transition-all text-[11px]"
                      aria-label="Dismiss alert"
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Undo Notification Toast */}
      {showToast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-4 px-4 py-3 bg-neutral-900 text-white rounded-xl shadow-xl text-[13px]">
          <span>All alerts marked as read.</span>
          <button 
            onClick={handleUndo}
            className="text-sky-400 hover:text-sky-300 font-semibold underline underline-offset-2 transition-colors ml-2"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
