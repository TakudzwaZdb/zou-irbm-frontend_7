import { useCompliance } from "@/hooks/useCompliance";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { StatCard } from "@/components/shared/StatCard";
import { ComplianceBarChart } from "@/components/charts/ComplianceBarChart";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/Badge";
import type { ComplianceRecord } from "@/types/compliance";

const STATUS_VARIANT = { "on-time": "success", late: "warning", missing: "danger" } as const;

export default function CompliancePage() {
  const { data: records = [], isLoading } = useCompliance();

  const bySub = Array.from(new Set(records.map((r) => r.subProgramme))).map((name) => {
    const subset = records.filter((r) => r.subProgramme === name);
    return {
      name,
      onTime: subset.filter((r) => r.status === "on-time").length,
      late: subset.filter((r) => r.status === "late").length,
      missing: subset.filter((r) => r.status === "missing").length,
    };
  });

  const repeatedLate = bySub.filter((s) => s.late >= 2);
  const onTime = records.filter((r) => r.status === "on-time").length;
  const late = records.filter((r) => r.status === "late").length;
  const missing = records.filter((r) => r.status === "missing").length;
  const rate = records.length ? Math.round((onTime / records.length) * 100) : 0;

  const columns: Column<ComplianceRecord>[] = [
    { key: "subProgramme", header: "Sub-programme", sortValue: (r) => r.subProgramme, render: (r) => r.subProgramme },
    { key: "month", header: "Period", sortValue: (r) => r.month, render: (r) => r.month },
    { key: "dueDate", header: "Due", render: (r) => r.dueDate },
    { key: "submittedDate", header: "Submitted", render: (r) => r.submittedDate ?? "—" },
    { key: "status", header: "Status", render: (r) => <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Reporting", "Submission compliance"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Submission compliance</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Monthly data-entry cadence · a submission is late once it passes its due date</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="On-time rate" value={`${rate}%`} accent="border-emerald-500" />
        <StatCard label="On time" value={onTime} />
        <StatCard label="Late" value={late} accent="border-amber-500" />
        <StatCard label="Missing" value={missing} accent="border-rose-500" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-3 text-sm font-medium text-slate-900">Monthly compliance trend by Sub-programme</p>
        <ComplianceBarChart data={bySub} />
      </div>

      {repeatedLate.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">Units with repeated late submissions</p>
          <p className="mt-1 text-xs text-amber-700">{repeatedLate.map((s) => s.name).join(", ")}</p>
        </div>
      )}

      <DataTable columns={columns} rows={records} pageSize={10} loading={isLoading} />
    </div>
  );
}
