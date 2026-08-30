// A small labeled figure — uppercase muted label above a bold value —
// shared by KpiCard, ContributionCard, and MonthlyPaceBar so every stat
// panel in the app reads the same way instead of each card inventing its
// own label/value styling.
export default function Fig({ k, v }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-wide text-ink-muted font-bold">{k}</span>
      <span className="font-display font-bold text-base tabular-nums">{v}</span>
    </div>
  );
}
