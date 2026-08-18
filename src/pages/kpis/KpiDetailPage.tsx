import { useParams, Link, useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import { useKpi } from "@/hooks/useKpis";
import { useProgramme } from "@/hooks/useProgrammes";
import { useSubProgramme } from "@/hooks/useSubProgrammes";
import { useAuditLog } from "@/hooks/useAudit";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { RagBadge } from "@/components/shared/RagBadge";
import { WorkflowBadge } from "@/components/shared/WorkflowBadge";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { TrendChart } from "@/components/charts/TrendChart";
import { formatValue, formatDate } from "@/utils/format";

export default function KpiDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: kpi, isLoading, isError, refetch } = useKpi(id);
  const { data: programme } = useProgramme(kpi?.programmeId);
  const { data: sub } = useSubProgramme(kpi?.subProgrammeId);
  const { data: audit = [] } = useAuditLog();

  if (isLoading) return <PageLoading />;
  if (isError || !kpi) return <ErrorState message="KPI not found." onRetry={refetch} />;

  const history = audit.filter((a) => a.record.toLowerCase().includes(kpi.name.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Breadcrumbs items={["Performance", "KPI management", kpi.name]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">{kpi.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{programme?.name} → {sub?.name} · Owner: {kpi.owner}</p>
        </div>
        <div className="flex items-center gap-2">
          <RagBadge status={kpi.status} />
          <WorkflowBadge status={kpi.workflow} />
          <Button variant="outline" size="sm" onClick={() => navigate(`/kpis/${kpi.id}/edit`)}><Pencil size={12} /> Edit</Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          {kpi.override && <TabsTrigger value="override">Manual override</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Baseline" value={formatValue(kpi.baseline, kpi.unit)} />
            <Metric label="Actual" value={formatValue(kpi.actual, kpi.unit)} emphasis />
            <Metric label="Target" value={formatValue(kpi.target, kpi.unit)} />
            <Metric label="Type" value={kpi.type === "output" ? "Output" : "Outcome"} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-3 text-sm font-medium text-slate-900">Performance trend</p>
            <TrendChart data={kpi.trend} color={kpi.status === "off-track" ? "#e11d48" : kpi.status === "at-risk" ? "#d97706" : "#059669"} />
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-5 text-sm sm:grid-cols-3">
            <div><p className="text-xs text-slate-400">Reporting frequency</p><p className="capitalize text-slate-700">{kpi.reportingFrequency}</p></div>
            <div><p className="text-xs text-slate-400">Data source</p><p className="text-slate-700">{kpi.dataSource}</p></div>
            <div><p className="text-xs text-slate-400">Last updated</p><p className="text-slate-700">{formatDate(kpi.lastUpdated)}</p></div>
          </div>
        </TabsContent>

        <TabsContent value="milestones">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpi.milestones.map((m) => (
              <div key={m.quarter} className="rounded-xl border border-slate-200 bg-white p-4 text-center">
                <p className="text-xs font-medium text-slate-400">{m.quarter}</p>
                <p className="mt-1 text-lg font-medium text-slate-900 dark:text-slate-100">{m.actual ?? "—"}</p>
                <p className="text-xs text-slate-400">of {m.target} target</p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">No recorded history for this KPI yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium capitalize text-slate-800">{h.action}</p>
                    <span className="text-xs text-slate-400">{h.timestamp}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{h.user} ({h.role}){h.previousValue && ` · ${h.previousValue} → ${h.newValue}`}</p>
                  {h.reason && <p className="mt-1 text-xs text-slate-400">{h.reason}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {kpi.override && (
          <TabsContent value="override">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-amber-700">System value</p><p className="text-base font-medium text-slate-700 line-through decoration-amber-400">{kpi.override.systemValue}</p></div>
                <div><p className="text-xs text-amber-700">Override value</p><p className="text-base font-medium text-slate-900">{kpi.override.overrideValue}</p></div>
                <div><p className="text-xs text-amber-700">Overridden by</p><p className="text-sm text-slate-700">{kpi.override.user}</p></div>
                <div><p className="text-xs text-amber-700">Timestamp</p><p className="text-sm text-slate-700">{formatDate(kpi.override.timestamp)}</p></div>
              </div>
              <p className="mt-3 text-xs text-slate-600"><span className="font-medium">Reason: </span>{kpi.override.reason}</p>
            </div>
          </TabsContent>
        )}
      </Tabs>

      <Link to="/kpis" className="inline-block text-xs font-medium text-indigo-600 hover:underline">← Back to KPI list</Link>
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-lg ${emphasis ? "font-medium text-slate-900" : "text-slate-700"}`}>{value}</p>
    </div>
  );
}
