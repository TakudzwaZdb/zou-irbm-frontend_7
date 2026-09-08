import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const toast = useCallback((message, kind = 'ok') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* A screen reader announces each toast as it's added — role="alert" for
          an error (assertive, interrupts) vs. role="status" for a plain
          confirmation (polite, waits its turn) — the same distinction the
          toast's own red/dark styling already makes visually. */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'err' ? 'alert' : 'status'}
            aria-live={t.kind === 'err' ? 'assertive' : 'polite'}
            className={`max-w-xs rounded-lg px-4 py-2.5 text-[12.5px] shadow-lg ${
              t.kind === 'err' ? 'bg-critical text-white' : 'bg-ink text-page'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
