import { Badge } from "@/components/ui/Badge";
import type { RagStatus } from "@/types/kpi";

const MAP: Record<RagStatus, { variant: "success" | "warning" | "danger"; label: string; dot: string }> = {
  "on-track": { variant: "success", label: "On track", dot: "bg-emerald-500" },
  "at-risk": { variant: "warning", label: "At risk", dot: "bg-amber-500" },
  "off-track": { variant: "danger", label: "Off track", dot: "bg-rose-500" },
};

export function RagBadge({ status }: { status: RagStatus }) {
  const m = MAP[status];
  return (
    <Badge variant={m.variant}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </Badge>
  );
}
