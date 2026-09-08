import { useEffect, useRef } from 'react';

// A full-size view of a profile photo, opened from the small thumbnails used
// everywhere in the app (header, Profile, Users directory) — those are all
// deliberately tiny (28-64px) for layout, so this is the only place a photo
// can actually be looked at properly. Same backdrop-click-to-close modal
// pattern as ComposeModal in Messages.jsx, plus an Escape-key handler since
// a photo viewer is exactly the kind of thing people expect to dismiss with
// the keyboard. role="dialog"/aria-modal tell a screen reader this is a
// modal layer over the page, and moving focus to the close button on open
// means a keyboard/screen-reader user lands inside it immediately rather
// than staying stranded on whatever thumbnail they just activated.
export default function PhotoLightbox({ src, name, onClose }) {
  const closeBtnRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={name ? `${name}'s profile photo` : 'Profile photo'}
    >
      <div className="flex flex-col items-center gap-3 max-w-[min(90vw,420px)]" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <img src={src} alt={name ? `${name}'s profile photo` : 'Profile photo'}
            className="w-full max-w-[420px] max-h-[70vh] rounded-2xl object-cover shadow-lg border-2 border-white/20" />
          <button
            ref={closeBtnRef}
            className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-surface border border-line shadow-md flex items-center justify-center text-ink hover:bg-sunken"
            onClick={onClose}
            aria-label="Close"
          >✕</button>
        </div>
        {name && <div className="text-[13px] font-semibold text-white/90">{name}</div>}
      </div>
    </div>
  );
}
