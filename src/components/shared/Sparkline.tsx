import { LineChart, Line, ResponsiveContainer } from "recharts";

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.map((v) => ({ v }))}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
