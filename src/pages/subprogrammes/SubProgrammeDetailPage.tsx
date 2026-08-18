import { useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useSubProgramme } from "@/hooks/useSubProgrammes";
import { useProgramme } from "@/hooks/useProgrammes";
import { useKpis } from "@/hooks/useKpis";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { StatCard } from "@/components/shared/StatCard";
import { RagBadge } from "@/components/shared/RagBadge";
import { WorkflowBadge } from "@/components/shared/WorkflowBadge";
import { TrendChart } from "@/components/charts/TrendChart";
import { ErrorState } from "@/components/shared/ErrorState";

export default function SubProgrammeDetailPage() {
  const { id } = useParams();
  const { data: sub, isLoading, isError, refetch } = useSubProgramme(id);
  const { data: programme } = useProgramme(sub?.programmeId);
  const { data: kpis = [] } = useKpis({ subProgrammeId: id });
  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) return <PageLoading />;
  if (isError || !sub) return <ErrorState message="Sub-programme not found." onRetry={refetch} />;

  const activeKpi = kpis.find((k) => k.id === selected) ?? kpis[0];

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Structure", "Sub-programmes", sub.name]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">{sub.name}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{programme?.name} · Head: {sub.head}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total KPIs" value={kpis.length} />
        <StatCard label="Awaiting approval" value={kpis.filter((k) => k.workflow === "submitted" || k.workflow === "pending_review").length} accent="border-amber-500" />
        <StatCard label="Approved" value={kpis.filter((k) => k.workflow === "approved").length} accent="border-emerald-500" />
        <StatCard label="Off track" value={kpis.filter((k) => k.status === "off-track").length} accent="border-rose-500" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-1">
          <p className="mb-3 text-sm font-medium text-slate-900">KPIs</p>
          <div className="space-y-1">
            {kpis.map((k) => (
              <button key={k.id} onClick={() => setSelected(k.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${activeKpi?.id === k.id ? "bg-indigo-50 text-indigo-900" : "text-slate-600 hover:bg-slate-50"}`}>
                <span className="truncate pr-2 font-medium">{k.name}</span>
                <ChevronRight size={12} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        </div>

        {activeKpi && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{activeKpi.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">Owner: {activeKpi.owner} · Type: {activeKpi.type}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5"><RagBadge status={activeKpi.status} /><WorkflowBadge status={activeKpi.workflow} /></div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">Baseline</p><p className="text-base font-medium text-slate-700">{activeKpi.baseline}{activeKpi.unit === "%" ? "%" : ""}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">Actual</p><p className="text-base font-medium text-slate-900">{activeKpi.actual}{activeKpi.unit === "%" ? "%" : ""}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">Target</p><p className="text-base font-medium text-slate-700">{activeKpi.target}{activeKpi.unit === "%" ? "%" : ""}</p></div>
            </div>
            <div className="mt-5"><p className="mb-2 text-xs font-medium text-slate-500">Performance trend</p><TrendChart data={activeKpi.trend} color={activeKpi.status === "off-track" ? "#e11d48" : activeKpi.status === "at-risk" ? "#d97706" : "#059669"} /></div>
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-500">Quarterly milestones</p>
              <div className="grid grid-cols-4 gap-2">
                {activeKpi.milestones.map((m) => (
                  <div key={m.quarter} className="rounded-lg border border-slate-100 p-2 text-center"><p className="text-[10px] text-slate-400">{m.quarter}</p><p className="text-xs font-medium text-slate-700">{m.actual ?? "—"} / {m.target}</p></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
