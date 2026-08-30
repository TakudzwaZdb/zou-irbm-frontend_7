// Theme choice: 'light' | 'dark' | 'system'. Persisted to localStorage so it
// survives reloads; applied by setting (or removing) a `data-theme` attribute
// on <html> — the CSS in index.css keys off that same attribute (see the
// `:root[data-theme="dark"]` / `:root[data-theme="light"]` blocks), so no
// React re-render is needed for the swap to take visual effect.
const KEY = 'zou-theme';

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

const ORDER = ['light', 'dark', 'system'];
export function cycleTheme() {
  const cur = getStoredTheme();
  const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
  setTheme(next);
  return next;
}

export const THEME_META = {
  light: { icon: '☀', label: 'Light theme' },
  dark: { icon: '☾', label: 'Dark theme' },
  system: { icon: '◐', label: 'Match system theme' },
};
