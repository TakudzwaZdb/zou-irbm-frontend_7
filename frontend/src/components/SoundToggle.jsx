import { useState } from 'react';
import { isSoundEnabled, setSoundEnabled } from '../lib/sound.js';

// Mute switch for the message notification tones (see lib/sound.js) —
// lives next to ThemeToggle in the header since it's the same kind of
// per-device display preference, persisted the same way (localStorage, no
// server round-trip needed).
export default function SoundToggle() {
  const [enabled, setEnabled] = useState(isSoundEnabled());

  function toggle() {
    const next = !enabled;
    setSoundEnabled(next);
    setEnabled(next);
  }

  return (
    <button
      className="flex items-center justify-center w-8 h-8 rounded-lg border border-line-strong hover:bg-sunken flex-none"
      onClick={toggle}
      title={enabled ? 'Message sounds on — click to mute' : 'Message sounds muted — click to unmute'}
      aria-label={enabled ? 'Mute message notification sounds' : 'Unmute message notification sounds'}
    >
      {enabled ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] text-sky-500">
          <path d="M4 9v6h4l5 4V5L8 9H4Z" />
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 6a8.5 8.5 0 0 1 0 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] text-sky-500">
          <path d="M4 9v6h4l5 4V5L8 9H4Z" />
          <path d="M16 9l5 6M21 9l-5 6" />
        </svg>
      )}
    </button>
  );
}
