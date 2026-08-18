import { Circle, Clock, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { WorkflowStatus } from "@/types/kpi";

const MAP: Record<WorkflowStatus, { variant: "default" | "info" | "warning" | "success" | "danger"; label: string; icon: typeof Circle }> = {
  draft: { variant: "default", label: "Draft", icon: Circle },
  submitted: { variant: "info", label: "Submitted", icon: Clock },
  pending_review: { variant: "warning", label: "Pending CPU review", icon: Clock },
  approved: { variant: "success", label: "Approved", icon: CheckCircle2 },
  rejected: { variant: "danger", label: "Rejected", icon: XCircle },
  returned: { variant: "danger", label: "Returned for correction", icon: RotateCcw },
};

export function WorkflowBadge({ status }: { status: WorkflowStatus }) {
  const m = MAP[status];
  const Icon = m.icon;
  return (
    <Badge variant={m.variant}>
      <Icon size={11} /> {m.label}
    </Badge>
  );
}
