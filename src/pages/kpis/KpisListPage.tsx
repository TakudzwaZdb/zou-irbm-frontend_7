import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useKpis } from "@/hooks/useKpis";
import { useProgrammes } from "@/hooks/useProgrammes";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { RagBadge } from "@/components/shared/RagBadge";
import { WorkflowBadge } from "@/components/shared/WorkflowBadge";
import { Sparkline } from "@/components/shared/Sparkline";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import type { Kpi } from "@/types/kpi";
import { formatValue } from "@/utils/format";

export default function KpisListPage() {
  const navigate = useNavigate();
  const [programmeFilter, setProgrammeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: programmes = [] } = useProgrammes();
  const { data: kpis = [], isLoading } = useKpis({
    programmeId: programmeFilter === "all" ? undefined : programmeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const columns: Column<Kpi>[] = [
    { key: "name", header: "KPI", sortValue: (k) => k.name, render: (k) => (
      <Link to={`/kpis/${k.id}`} className="font-medium text-slate-800 hover:text-indigo-600 hover:underline">{k.name}</Link>
    ) },
    { key: "baseline", header: "Baseline", render: (k) => formatValue(k.baseline, k.unit) },
    { key: "target", header: "Target", render: (k) => formatValue(k.target, k.unit) },
    { key: "actual", header: "Actual", render: (k) => <span className="font-medium">{formatValue(k.actual, k.unit)}</span> },
    { key: "trend", header: "Trend", render: (k) => <Sparkline data={k.trend} color={k.status === "on-track" ? "#059669" : k.status === "at-risk" ? "#d97706" : "#e11d48"} /> },
    { key: "status", header: "RAG", render: (k) => <RagBadge status={k.status} /> },
    { key: "workflow", header: "Workflow", render: (k) => <WorkflowBadge status={k.workflow} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Breadcrumbs items={["Performance", "KPI management"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">KPI management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Baseline, annual target, quarterly milestones and responsible ownership for every KPI</p>
        </div>
        <Button onClick={() => navigate("/kpis/new")}><Plus size={14} /> New KPI</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={programmeFilter} onValueChange={setProgrammeFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All programmes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All programmes</SelectItem>
            {programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="on-track">On track</SelectItem>
            <SelectItem value="at-risk">At risk</SelectItem>
            <SelectItem value="off-track">Off track</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} rows={kpis} pageSize={10} loading={isLoading} />
    </div>
  );
}
