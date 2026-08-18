export function Breadcrumbs({ items }: { items: string[] }) {
  return (
    <nav className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300">/</span>}
          <span className={i === items.length - 1 ? "font-medium text-slate-600 dark:text-slate-300" : ""}>{item}</span>
        </span>
      ))}
    </nav>
  );
}
