import { useEffect, useMemo, useState } from "react";
import { FileText, Users, UserCog, TrendingUp, Sparkles, FolderKanban } from "lucide-react";
import { useAvailableQuarters, useQuarterlySummaries } from "@/hooks/useAnalytics";
import { useGenerateAppraisalReport, useReports } from "@/hooks/useReports";
import { useKpis } from "@/hooks/useKpis";
import { useOperationalPlans } from "@/hooks/useOperationalPlans";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { StatCard } from "@/components/shared/StatCard";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { TargetVsActualChart } from "@/components/charts/TargetVsActualChart";
import type { QuarterlyAppraisalSummary, AppraisalTier } from "@/types/appraisal";

const TIER_LABEL: Record<AppraisalTier, string> = { staff: "Staff", unit_head: "Unit Head" };

export default function CpuDashboardPage() {
  const { toast } = useToast();
  const { data: quarters = [] } = useAvailableQuarters();
  const [quarter, setQuarter] = useState<string>("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [kpiCategory, setKpiCategory] = useState<string>("all");

  useEffect(() => {
    if (!quarter && quarters.length > 0) setQuarter(quarters[quarters.length - 1]);
  }, [quarters, quarter]);

  const { data: summaries = [], isLoading } = useQuarterlySummaries(quarter);
  const { data: kpis = [] } = useKpis(kpiCategory === "all" ? undefined : { status: undefined });
  const { data: reports = [] } = useReports();
  const { data: operationalPlans = [] } = useOperationalPlans();
  const generateReport = useGenerateAppraisalReport();

  const filteredKpis = useMemo(
    () => (kpiCategory === "all" ? kpis : kpis.filter((k) => k.type === kpiCategory)),
    [kpis, kpiCategory]
  );

  const units = useMemo(() => Array.from(new Set(summaries.map((s) => s.unitName))), [summaries]);

  const filtered = useMemo(() => {
    let result = summaries;
    if (tierFilter !== "all") result = result.filter((s) => s.tier === tierFilter);
    if (unitFilter !== "all") result = result.filter((s) => s.unitName === unitFilter);
    return result;
  }, [summaries, tierFilter, unitFilter]);

  const staffSummaries = summaries.filter((s) => s.tier === "staff");
  const unitHeadSummaries = summaries.filter((s) => s.tier === "unit_head");
  const avgStaff = staffSummaries.length ? Math.round((staffSummaries.reduce((a, s) => a + s.averageScore, 0) / staffSummaries.length) * 10) / 10 : 0;
  const avgUnitHead = unitHeadSummaries.length ? Math.round((unitHeadSummaries.reduce((a, s) => a + s.averageScore, 0) / unitHeadSummaries.length) * 10) / 10 : 0;

  const byUnitChart = useMemo(() => {
    const map = new Map<string, { name: string; target: number; actual: number }>();
    for (const s of summaries) {
      const existing = map.get(s.unitName) ?? { name: s.unitName, target: 100, actual: 0 };
      existing.actual = Math.round(((existing.actual + s.averageScore) / (map.has(s.unitName) ? 2 : 1)) * 10) / 10;
      map.set(s.unitName, existing);
    }
    return Array.from(map.values());
  }, [summaries]);

  const appraisalReports = reports.filter((r) => r.title.toLowerCase().includes("appraisal report"));

  async function handleGenerate(tier: AppraisalTier) {
    if (!quarter) return;
    await generateReport.mutateAsync({ tier, quarter });
    toast({ title: "Report generated", description: `${TIER_LABEL[tier]} appraisal report for ${quarter} is ready.`, kind: "success" });
  }

  const columns: Column<QuarterlyAppraisalSummary>[] = [
    { key: "subjectName", header: "Subject", sortValue: (s) => s.subjectName, render: (s) => <span className="font-medium text-slate-800">{s.subjectName}</span> },
    { key: "tier", header: "Tier", render: (s) => <Badge variant="info">{TIER_LABEL[s.tier]}</Badge> },
    { key: "unitName", header: "Unit", render: (s) => s.unitName },
    { key: "averageScore", header: "Average score", sortValue: (s) => s.averageScore, render: (s) => (
      <span className={`font-medium ${s.averageScore >= 80 ? "text-emerald-700" : s.averageScore >= 60 ? "text-amber-700" : "text-rose-700"}`}>{s.averageScore}%</span>
    ) },
    { key: "sampleSize", header: "Weeks scored", render: (s) => s.sampleSize },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumbs items={["CPU", "Corporate Planning Unit dashboard"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Corporate Planning Unit dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Automated quarterly rolling-average analytics across every appraisal tier</p>
        </div>
        <Select value={quarter} onValueChange={setQuarter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Quarter" /></SelectTrigger>
          <SelectContent>{quarters.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-indigo-700"><Sparkles size={13} /> Analytics engine</p>
        <p className="mt-1 text-xs text-indigo-600">
          Every staff and Unit Head weekly score for {quarter || "the selected quarter"} is automatically averaged per subject and rolled up
          per unit — no manual calculation required. Recalculates whenever a new weekly appraisal is scored.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Staff scored" value={staffSummaries.length} icon={<Users size={20} />} />
        <StatCard label="Unit Heads scored" value={unitHeadSummaries.length} icon={<UserCog size={20} />} />
        <StatCard label="Avg staff score" value={`${avgStaff}%`} accent="border-emerald-500" icon={<TrendingUp size={20} />} />
        <StatCard label="Avg Unit Head score" value={`${avgUnitHead}%`} accent="border-indigo-500" icon={<TrendingUp size={20} />} />
      </div>

      {byUnitChart.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-3 text-sm font-medium text-slate-900">Average appraisal score by unit — {quarter}</p>
          <TargetVsActualChart data={byUnitChart} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="unit_head">Unit Head</SelectItem>
          </SelectContent>
        </Select>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All units" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All units</SelectItem>
            {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} rows={filtered} pageSize={10} loading={isLoading} emptyTitle="No scored appraisals in this quarter yet" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-1 text-sm font-medium text-slate-900">Generate structured reports by tier</p>
          <p className="mb-3 text-xs text-slate-500">One click produces a report for the selected quarter, filed alongside the Programme KPI reports.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => handleGenerate("staff")} disabled={!quarter}><FileText size={12} /> Generate staff report</Button>
            <Button size="sm" variant="outline" onClick={() => handleGenerate("unit_head")} disabled={!quarter}><FileText size={12} /> Generate Unit Head report</Button>
          </div>
          {appraisalReports.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {appraisalReports.slice(0, 4).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-700">{r.title}</span>
                  <span className="text-slate-400">{r.generatedAt}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Programme KPIs by category</p>
            <Select value={kpiCategory} onValueChange={setKpiCategory}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="output">Output</SelectItem>
                <SelectItem value="outcome">Outcome</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filteredKpis.length === 0 ? <EmptyState title="No KPIs in this category" /> : (
            <div className="space-y-1.5">
              {filteredKpis.slice(0, 6).map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="truncate pr-2 text-slate-700">{k.name}</span>
                  <span className="shrink-0 font-medium text-slate-500">{k.actual}{k.unit === "%" ? "%" : ""} / {k.target}{k.unit === "%" ? "%" : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
          <FolderKanban size={15} className="text-slate-400" /> Operational plans pipeline
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Total plans" value={operationalPlans.length} />
          <StatCard label="Awaiting Programme Head" value={operationalPlans.filter((p) => p.status === "pending_programme_head").length} accent="border-amber-500" />
          <StatCard label="Awaiting VC" value={operationalPlans.filter((p) => p.status === "pending_vc").length} accent="border-amber-500" />
          <StatCard label="Awaiting CPU validation" value={operationalPlans.filter((p) => p.status === "pending_cpu").length} accent="border-indigo-500" />
          <StatCard label="Validated" value={operationalPlans.filter((p) => p.status === "validated").length} accent="border-emerald-500" />
        </div>
      </div>
    </div>
  );
}
