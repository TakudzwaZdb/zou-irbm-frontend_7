import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

// Same reserved RAG status colors as RagBarChart/the chips everywhere else
// (see index.css's --color-good/--color-warning/--color-critical — fixed
// across light and dark, never repurposed as a generic categorical palette).
const STATUS = [
  { key: 'green', label: 'On track', color: '#0ca30c' },
  { key: 'amber', label: 'At risk', color: '#c98500' },
  { key: 'red', label: 'Off track', color: '#d03b3b' },
  { key: 'none', label: 'No data', color: '#c7c4b8' },
];

// The same RAG distribution RagBarChart shows, as a pie — a proportions
// view (share of the whole) to sit alongside the bar chart's counts view.
// `counts` is the identical {green, amber, red, none} shape performanceRollup
// already produces, so this never computes anything of its own.
export default function RagPieChart({ counts, height = 240 }) {
  const data = STATUS.map((s) => ({ name: s.label, value: counts[s.key] || 0, color: s.color })).filter((d) => d.value > 0);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-[12.5px] text-ink-muted" style={{ height }}>
        No KPIs to chart yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="46%"
          innerRadius="52%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="var(--color-surface)"
          strokeWidth={2}
        >
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid var(--color-line)', fontSize: 12.5, background: 'var(--color-surface)', color: 'var(--color-ink)' }}
          formatter={(v, name) => [`${v} of ${total} (${Math.round((v / total) * 100)}%)`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 4 }} iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}
