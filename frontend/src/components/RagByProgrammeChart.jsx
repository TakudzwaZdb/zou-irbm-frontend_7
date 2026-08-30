import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts';

// Same reserved status colors as RagBarChart / the RAG chips elsewhere.
const SERIES = [
  { key: 'green', label: 'On track', color: '#0ca30c' },
  { key: 'amber', label: 'At risk', color: '#c98500' },
  { key: 'red', label: 'Off track', color: '#d03b3b' },
  { key: 'none', label: 'No data', color: '#c7c4b8' },
];

export default function RagByProgrammeChart({ rows, height = 280 }) {
  const data = rows.map((r) => ({ name: r.p.name, ...r.counts }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barGap={2} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke="var(--color-line)" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false}
          interval={0} angle={-12} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} width={28} />
        <Tooltip
          cursor={{ fill: 'var(--color-sunken)' }}
          contentStyle={{ borderRadius: 8, border: '1px solid var(--color-line)', fontSize: 12.5, background: 'var(--color-surface)', color: 'var(--color-ink)' }}
        />
        <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} iconType="circle" iconSize={8} />
        {SERIES.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
