import { NAV_CHILDREN, NAV_ITEMS } from '../lib/nav.js';

export default function PageSectionTabs({ parent, currentRoute, onNavigate }) {
  const children = NAV_CHILDREN[parent] || [];
  if (!children.length) return null;

  return (
    <nav aria-label={`${NAV_ITEMS[parent]?.label || parent} pages`} className="no-print flex gap-1 border-b border-line mb-5">
      {children.map((child) => (
        <button
          key={child.route}
          type="button"
          onClick={() => onNavigate(child.route)}
          aria-current={currentRoute === child.route ? 'page' : undefined}
          className={`px-4 py-2.5 border-b-2 text-[13px] font-semibold transition-colors
            ${currentRoute === child.route ? 'border-accent-500 text-accent-700' : 'border-transparent text-ink-muted hover:text-ink-secondary hover:border-line-strong'}`}
        >
          {child.label}
        </button>
      ))}
    </nav>
  );
}
