import { useParams, Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useProgramme } from "@/hooks/useProgrammes";
import { useSubProgrammes } from "@/hooks/useSubProgrammes";
import { useKpis } from "@/hooks/useKpis";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { StatCard } from "@/components/shared/StatCard";
import { RagBadge } from "@/components/shared/RagBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { TargetVsActualChart } from "@/components/charts/TargetVsActualChart";
import { ErrorState } from "@/components/shared/ErrorState";

export default function ProgrammeDetailPage() {
  const { id } = useParams();
  const { data: programme, isLoading, isError, refetch } = useProgramme(id);
  const { data: subs = [] } = useSubProgrammes(id);
  const { data: kpis = [] } = useKpis({ programmeId: id });

  if (isLoading) return <PageLoading />;
  if (isError || !programme) return <ErrorState message="Programme not found." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Structure", "Programmes", programme.name]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">{programme.code} · {programme.name}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Programme Head: {programme.head}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Sub-programmes" value={subs.length} />
        <StatCard label="Total KPIs" value={kpis.length} />
        <StatCard label="On track" value={kpis.filter((k) => k.status === "on-track").length} accent="border-emerald-500" />
        <StatCard label="Off track" value={kpis.filter((k) => k.status === "off-track").length} accent="border-rose-500" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-3 text-sm font-medium text-slate-900">Target vs actual by KPI</p>
        <TargetVsActualChart data={kpis.map((k) => ({ name: k.name.length > 18 ? k.name.slice(0, 18) + "…" : k.name, target: k.target, actual: k.actual }))} />
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900">Sub-programmes</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {subs.map((s) => {
            const sKpis = kpis.filter((k) => k.subProgrammeId === s.id);
            const avg = sKpis.length ? Math.round(sKpis.reduce((a, k) => a + Math.min(100, (k.actual / k.target) * 100), 0) / sKpis.length) : 0;
            return (
              <Link key={s.id} to={`/sub-programmes/${s.id}`} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
                  <ChevronRight size={14} className="text-slate-300" />
                </div>
                <p className="mt-0.5 text-xs text-slate-400">Head: {s.head} · {sKpis.length} KPIs</p>
                <div className="mt-3"><ProgressBar pct={avg} /><p className="mt-1 text-[11px] text-slate-400">{avg}% average progress to target</p></div>
                <div className="mt-2 flex flex-wrap gap-1">{sKpis.slice(0, 4).map((k) => <RagBadge key={k.id} status={k.status} />)}</div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
