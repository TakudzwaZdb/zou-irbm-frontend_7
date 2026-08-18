import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, TrendingUp, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useKpis } from "@/hooks/useKpis";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useSubProgrammes } from "@/hooks/useSubProgrammes";
import { useSubmissions } from "@/hooks/usePerformance";
import { useAlerts } from "@/hooks/useAlerts";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { StatCard } from "@/components/shared/StatCard";
import { RagBadge } from "@/components/shared/RagBadge";
import { Sparkline } from "@/components/shared/Sparkline";
import { CardSkeleton } from "@/components/shared/Skeleton";
import { RagDonut } from "@/components/charts/RagDonut";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";

const SPARK_COLOR = { "on-track": "#059669", "at-risk": "#d97706", "off-track": "#e11d48" } as const;

export default function ExecutiveDashboard() {
  const [programmeFilter, setProgrammeFilter] = useState<string>("all");
  const [subProgrammeFilter, setSubProgrammeFilter] = useState<string>("all");

  const { data: programmes = [] } = useProgrammes();
  const { data: subProgrammes = [] } = useSubProgrammes(programmeFilter === "all" ? undefined : programmeFilter);
  const { data: kpis, isLoading } = useKpis();
  const { data: submissions = [] } = useSubmissions();
  const { data: alerts = [] } = useAlerts();

  const filteredKpis = useMemo(() => {
    let result = kpis ?? [];
    if (programmeFilter !== "all") result = result.filter((k) => k.programmeId === programmeFilter);
    if (subProgrammeFilter !== "all") result = result.filter((k) => k.subProgrammeId === subProgrammeFilter);
    return result;
  }, [kpis, programmeFilter, subProgrammeFilter]);

  const onTrack = filteredKpis.filter((k) => k.status === "on-track").length;
  const atRisk = filteredKpis.filter((k) => k.status === "at-risk").length;
  const offTrack = filteredKpis.filter((k) => k.status === "off-track").length;
  const overallAchievement = filteredKpis.length
    ? Math.round(filteredKpis.reduce((a, k) => a + Math.min(100, (k.actual / k.target) * 100), 0) / filteredKpis.length)
    : 0;
  const pending = submissions.filter((s) => s.status === "submitted" || s.status === "pending_review").length;
  const late = submissions.filter((s) => s.late).length;
  const recentApprovals = submissions.filter((s) => s.status === "approved").slice(0, 3);
  const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumbs items={["Overview", "Executive dashboard"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">University-wide performance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Live results across all Programmes and Sub-programmes</p>
        </div>
        <div className="flex gap-2">
          <Select value={programmeFilter} onValueChange={(v) => { setProgrammeFilter(v); setSubProgrammeFilter("all"); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All programmes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All programmes</SelectItem>
              {programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subProgrammeFilter} onValueChange={setSubProgrammeFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All sub-programmes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sub-programmes</SelectItem>
              {subProgrammes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Overall achievement" value={`${overallAchievement}%`} icon={<Activity size={20} />} />
          <StatCard label="Pending submissions" value={pending} accent="border-indigo-500" icon={<TrendingUp size={20} />} />
          <StatCard label="Late submissions" value={late} accent="border-amber-500" icon={<Clock size={20} />} />
          <StatCard label="Active alerts" value={activeAlerts} accent="border-rose-500" icon={<AlertTriangle size={20} />} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-1">
          <p className="mb-3 text-sm font-medium text-slate-900">Overall RAG status</p>
          <div className="flex items-center justify-center"><RagDonut onTrack={onTrack} atRisk={atRisk} offTrack={offTrack} /></div>
          <div className="mt-4 space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={12} /> On track</span><span className="font-medium">{onTrack}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-amber-700"><AlertTriangle size={12} /> At risk</span><span className="font-medium">{atRisk}</span></div>
            <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-rose-700"><AlertTriangle size={12} /> Off track</span><span className="font-medium">{offTrack}</span></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <p className="mb-3 text-sm font-medium text-slate-900">Programme performance</p>
          <div className="space-y-3">
            {programmes.map((p) => {
              const pKpis = (kpis ?? []).filter((k) => k.programmeId === p.id);
              const avg = pKpis.length ? Math.round(pKpis.reduce((a, k) => a + Math.min(100, (k.actual / k.target) * 100), 0) / pKpis.length) : 0;
              return (
                <Link key={p.id} to={`/programmes/${p.id}`} className="flex items-center justify-between rounded-lg border border-slate-100 p-3 hover:border-indigo-200 hover:bg-indigo-50/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{p.code} · {p.name}</p>
                    <p className="text-xs text-slate-400">{pKpis.length} KPIs · {p.head}</p>
                  </div>
                  <span className="text-sm font-medium text-slate-700">{avg}%</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900">Underperforming KPIs</p>
          <div className="space-y-2">
            {filteredKpis.filter((k) => k.status !== "on-track").slice(0, 5).map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{k.name}</p>
                  <p className="text-[11px] text-slate-400">Target {k.target}{k.unit === "%" ? "%" : ""} · {k.owner}</p>
                </div>
                <div className="flex items-center gap-3 pl-3">
                  <Sparkline data={k.trend} color={SPARK_COLOR[k.status]} />
                  <RagBadge status={k.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-slate-900">Recent approvals</p>
          <div className="space-y-2">
            {recentApprovals.map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.kpiName}</p>
                <p className="text-[11px] text-slate-400">{s.period} · {s.achievementPct}% achieved · approved</p>
              </div>
            ))}
            {recentApprovals.length === 0 && <p className="text-xs text-slate-400">No approvals yet this period.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
