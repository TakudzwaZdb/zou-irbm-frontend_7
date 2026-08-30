import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts';

// Status colors are the same reserved tokens used for the RAG chips
// everywhere else in the app (see index.css) — never repurposed as a
// generic categorical palette.
const STATUS = [
  { key: 'green', label: 'On track', color: '#0ca30c' },
  { key: 'amber', label: 'At risk', color: '#c98500' },
  { key: 'red', label: 'Off track', color: '#d03b3b' },
  { key: 'none', label: 'No data', color: '#c7c4b8' },
];

export default function RagBarChart({ counts, height = 200 }) {
  const data = STATUS.map((s) => ({ name: s.label, value: counts[s.key] || 0, color: s.color }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="0" />
        <XAxis dataKey="name" tick={{ fontSize: 11.5, fill: 'var(--color-ink-muted)' }} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }} axisLine={false} tickLine={false} width={28} />
        <Tooltip
          cursor={{ fill: 'var(--color-sunken)' }}
          contentStyle={{ borderRadius: 8, border: '1px solid var(--color-line)', fontSize: 12.5, background: 'var(--color-surface)', color: 'var(--color-ink)' }}
          formatter={(v) => [v, 'KPIs']}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
