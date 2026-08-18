import { useState } from "react";
import { useSubmissions } from "@/hooks/usePerformance";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { WorkflowBadge } from "@/components/shared/WorkflowBadge";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import type { PerformanceSubmission, WorkflowStatus } from "@/types/kpi";
import { formatValue } from "@/utils/format";

export default function SubmissionsListPage() {
  const [status, setStatus] = useState<string>("all");
  const { data: submissions = [], isLoading } = useSubmissions(status === "all" ? undefined : (status as WorkflowStatus));

  const columns: Column<PerformanceSubmission>[] = [
    { key: "kpiName", header: "KPI", sortValue: (s) => s.kpiName, render: (s) => <span className="font-medium text-slate-800">{s.kpiName}</span> },
    { key: "period", header: "Period", render: (s) => s.period },
    { key: "target", header: "Target", render: (s) => formatValue(s.target, "number") },
    { key: "actual", header: "Actual", render: (s) => formatValue(s.actual, "number") },
    { key: "achievementPct", header: "Achievement", sortValue: (s) => s.achievementPct, render: (s) => `${s.achievementPct}%` },
    { key: "submittedBy", header: "Submitted by", render: (s) => s.submittedBy },
    { key: "late", header: "Timeliness", render: (s) => s.late ? <Badge variant="warning">Late</Badge> : <Badge variant="success">On time</Badge> },
    { key: "status", header: "Status", render: (s) => <WorkflowBadge status={s.status} /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Performance", "Submissions"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">All performance submissions</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every submission across all Sub-programmes for the current reporting period</p>
      </div>

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-52"><SelectValue placeholder="All statuses" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="submitted">Submitted</SelectItem>
          <SelectItem value="pending_review">Pending CPU review</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
          <SelectItem value="returned">Returned for correction</SelectItem>
        </SelectContent>
      </Select>

      <DataTable columns={columns} rows={submissions} pageSize={10} loading={isLoading} />
    </div>
  );
}
