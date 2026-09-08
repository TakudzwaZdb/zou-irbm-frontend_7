import { useState } from 'react';
import { cycleTheme, getStoredTheme, THEME_META } from '../lib/theme.js';

// Cycles light -> dark -> system, same pattern as the reference prototype's
// own theme switcher. The actual re-theming is pure CSS (index.css keys off
// the `data-theme` attribute this sets) — this component only tracks which
// choice is active so the icon/label stay in sync.
export default function ThemeToggle() {
  const [theme, setThemeState] = useState(getStoredTheme);
  const meta = THEME_META[theme];

  function onClick() {
    setThemeState(cycleTheme());
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded-lg border border-line text-[14px] text-ink-secondary hover:bg-sunken flex-none"
      title={`${meta.label} — click to change`}
      aria-label={`Change theme (currently ${meta.label.toLowerCase()})`}
    >
      {meta.icon}
    </button>
  );
}
