import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function ComplianceBarChart({ data }: { data: { name: string; onTime: number; late: number; missing: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }} barSize={18}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
          <Bar dataKey="onTime" stackId="a" fill="#10b981" name="On time" />
          <Bar dataKey="late" stackId="a" fill="#f59e0b" name="Late" />
          <Bar dataKey="missing" stackId="a" fill="#f43f5e" name="Missing" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
