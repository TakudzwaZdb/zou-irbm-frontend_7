import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// A styled, in-app replacement for window.confirm(). The browser's native
// confirm() is unstyled chrome the app has no control over (no brand, no
// dark mode, no way to give the confirm button its own label like "Delete"
// instead of a bare "OK") and, on some setups, can be suppressed by the
// browser entirely — this renders a real modal instead, matching every
// other dialog in the app (bg-surface card, border-line, rounded-xl,
// backdrop, Escape-to-close).
const ConfirmContext = createContext(null);

function useEscapeToClose(onClose, active) {
  useEffect(() => {
    if (!active) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, active]);
}

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolveRef = useRef(null);

  // confirm(message) or confirm({ message, title, confirmLabel, cancelLabel,
  // tone }) — tone: 'danger' (destructive — red confirm button) or
  // 'default' (accent confirm button). Returns a Promise<boolean>, exactly
  // like window.confirm's return value, so every existing call site only
  // needs `await confirm(...)` in place of `window.confirm(...)`.
  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : (options || {});
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setRequest({
        title: opts.title || 'Please confirm',
        message: opts.message || 'Are you sure?',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        tone: opts.tone === 'danger' ? 'danger' : 'default',
      });
    });
  }, []);

  const settle = useCallback((value) => {
    setRequest(null);
    if (resolveRef.current) {
      resolveRef.current(value);
      resolveRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => settle(false), [settle]);
  useEscapeToClose(cancel, !!request);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          onMouseDown={cancel}
        >
          <div
            className="bg-surface border border-line rounded-xl shadow-xl w-full max-w-sm p-4"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-dialog-title" className="font-display font-bold text-[15px] mb-1.5">
              {request.title}
            </h2>
            <p id="confirm-dialog-message" className="text-[12.5px] text-ink-secondary mb-4 whitespace-pre-line">
              {request.message}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm" onClick={cancel} autoFocus>
                {request.cancelLabel}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${request.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settle(true)}
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
