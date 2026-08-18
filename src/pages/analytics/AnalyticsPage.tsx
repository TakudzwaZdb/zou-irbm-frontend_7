import { useMemo, useState } from "react";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useSubProgrammes } from "@/hooks/useSubProgrammes";
import { useUnits } from "@/hooks/useUnits";
import { useKpis } from "@/hooks/useKpis";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { StatCard } from "@/components/shared/StatCard";
import { TargetVsActualChart } from "@/components/charts/TargetVsActualChart";
import { ProgrammeComparisonChart } from "@/components/charts/ProgrammeComparisonChart";
import { PerformanceDistributionChart } from "@/components/charts/PerformanceDistributionChart";
import { TrendChart } from "@/components/charts/TrendChart";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { RagBadge } from "@/components/shared/RagBadge";

export default function AnalyticsPage() {
  const [programmeId, setProgrammeId] = useState("all");
  const [subProgrammeId, setSubProgrammeId] = useState("all");
  const [unitId, setUnitId] = useState("all");

  const { data: programmes = [] } = useProgrammes();
  const { data: subs = [] } = useSubProgrammes(programmeId === "all" ? undefined : programmeId);
  const { data: units = [] } = useUnits(subProgrammeId === "all" ? undefined : subProgrammeId);
  const { data: kpis = [] } = useKpis({
    programmeId: programmeId === "all" ? undefined : programmeId,
    subProgrammeId: subProgrammeId === "all" ? undefined : subProgrammeId,
    unitId: unitId === "all" ? undefined : unitId,
  });

  const comparisonData = useMemo(
    () => programmes.map((p) => {
      const pKpis = kpis.filter((k) => k.programmeId === p.id);
      const achievement = pKpis.length ? Math.round(pKpis.reduce((a, k) => a + Math.min(100, (k.actual / k.target) * 100), 0) / pKpis.length) : 0;
      return { programme: p.code, achievement };
    }),
    [programmes, kpis]
  );

  const distribution = [
    { name: "On track", value: kpis.filter((k) => k.status === "on-track").length },
    { name: "At risk", value: kpis.filter((k) => k.status === "at-risk").length },
    { name: "Off track", value: kpis.filter((k) => k.status === "off-track").length },
  ];

  const avgVariance = kpis.length ? Math.round(kpis.reduce((a, k) => a + (k.actual - k.target), 0) / kpis.length) : 0;
  const underperforming = kpis.filter((k) => k.status === "off-track");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumbs items={["Performance", "Analytics"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Performance analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Drill down: ZOU → Programme → Sub-programme → Unit → KPI</p>
        </div>
        <div className="flex gap-2">
          <Select value={programmeId} onValueChange={(v) => { setProgrammeId(v); setSubProgrammeId("all"); setUnitId("all"); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Programme" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All programmes</SelectItem>{programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={subProgrammeId} onValueChange={(v) => { setSubProgrammeId(v); setUnitId("all"); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Sub-programme" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All sub-programmes</SelectItem>{subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Unit" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All units</SelectItem>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="KPIs in scope" value={kpis.length} />
        <StatCard label="Average variance" value={avgVariance} sub="Actual minus target, averaged" />
        <StatCard label="Underperforming" value={underperforming.length} accent="border-rose-500" />
        <StatCard label="Output vs outcome" value={`${kpis.filter((k) => k.type === "output").length} / ${kpis.filter((k) => k.type === "outcome").length}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-3 text-sm font-medium text-slate-900">Programme comparison (average achievement)</p>
          <ProgrammeComparisonChart data={comparisonData} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-3 text-sm font-medium text-slate-900">Performance distribution</p>
          <PerformanceDistributionChart data={distribution} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-3 text-sm font-medium text-slate-900">Baseline vs target vs actual</p>
        <TargetVsActualChart data={kpis.slice(0, 8).map((k) => ({ name: k.name.length > 16 ? k.name.slice(0, 16) + "…" : k.name, target: k.target, actual: k.actual }))} />
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900">Underperformance analysis</p>
        <div className="space-y-2">
          {underperforming.map((k) => (
            <div key={k.id} className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{k.name}</p>
                <RagBadge status={k.status} />
              </div>
              <p className="mt-1 text-xs text-slate-500">Variance: {Math.round((k.actual - k.target) * 10) / 10} · Owner: {k.owner}</p>
              <div className="mt-2"><TrendChart data={k.trend} color="#e11d48" /></div>
            </div>
          ))}
          {underperforming.length === 0 && <p className="text-xs text-slate-400">No underperforming KPIs in this scope.</p>}
        </div>
      </div>
    </div>
  );
}
