import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";

export function ProgrammeComparisonChart({ data }: { data: { programme: string; achievement: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="programme" tick={{ fontSize: 11, fill: "#64748b" }} />
          <PolarRadiusAxis tick={{ fontSize: 10, fill: "#94a3b8" }} domain={[0, 100]} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
          <Radar dataKey="achievement" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.25} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
