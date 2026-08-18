import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export function TargetVsActualChart({ data }: { data: { name: string; target: number; actual: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="target" fill="#c7d2fe" radius={[4, 4, 0, 0]} name="Target" />
          <Bar dataKey="actual" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Actual" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
