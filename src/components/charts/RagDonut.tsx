import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const COLORS: Record<string, string> = { "On track": "#10b981", "At risk": "#f59e0b", "Off track": "#f43f5e" };

export function RagDonut({ onTrack, atRisk, offTrack }: { onTrack: number; atRisk: number; offTrack: number }) {
  const data = [{ name: "On track", value: onTrack }, { name: "At risk", value: atRisk }, { name: "Off track", value: offTrack }];
  const total = onTrack + atRisk + offTrack;
  return (
    <div className="relative h-40 w-40">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={45} outerRadius={65} paddingAngle={3} stroke="none">
            {data.map((d) => <Cell key={d.name} fill={COLORS[d.name]} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-medium text-slate-900">{total}</span>
        <span className="text-[10px] text-slate-400">KPIs</span>
      </div>
    </div>
  );
}
