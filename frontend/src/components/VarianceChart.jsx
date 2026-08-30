import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts';

// Reserved status colors again for the "Actual" bar (matches the RAG chips'
// meaning: on/ahead of pace reads good, behind pace reads critical) — the
// "Expected pace" bar stays a single neutral ink-muted tone throughout,
// since it's a reference line, not a status.
const FLAG_COLOR = { attention: '#d03b3b', ahead: '#0ca30c', 'on-pace': '#2f6fed', none: '#c7c4b8' };

// Actual progress % vs the expected pace % for the same period (see
// lib/scope.js's varianceRollup) — one grouped bar pair per KPI (or, on
// Reports, per Programme). The gap between the two bars *is* the variance;
// a KPI whose Actual bar falls short of Expected by more than 10 points is
// colored critical, same threshold the attention alerts below use.
export default function VarianceChart({ data, height = 280 }) {
  const chartData = data.map((d) => ({ ...d, actual: d.actual ?? 0 }));
  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center text-[12.5px] text-ink-muted" style={{ height }}>
        No KPIs to chart yet.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--color-line)" />
        <XAxis dataKey="name" tick={{ fontSize: 10.8, fill: 'var(--color-ink-muted)' }} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false}
          interval={0} angle={-16} textAnchor="end" height={54} />
        <YAxis allowDecimals={false} domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} width={30} unit="%" />
        <ReferenceLine y={100} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
        <Tooltip
          cursor={{ fill: 'var(--color-sunken)' }}
          contentStyle={{ borderRadius: 8, border: '1px solid var(--color-line)', fontSize: 12.5, background: 'var(--color-surface)', color: 'var(--color-ink)' }}
          formatter={(v, name, item) => {
            if (name === 'Actual') {
              const variance = item.payload.variance;
              return [`${v}% (variance ${variance == null ? '—' : (variance > 0 ? '+' : '') + variance}pts)`, 'Actual'];
            }
            return [`${v}%`, 'Expected pace'];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} iconType="circle" iconSize={8} />
        <Bar dataKey="expected" name="Expected pace" fill="var(--color-ink-muted)" opacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]} maxBarSize={26}>
          {chartData.map((d) => <Cell key={d.name} fill={FLAG_COLOR[d.flag] || FLAG_COLOR.none} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
