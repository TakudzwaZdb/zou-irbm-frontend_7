import { useUnitHeadAppraisals } from "@/hooks/useUnitHeadAppraisals";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { UnitHeadEvaluateRow } from "@/components/shared/UnitHeadEvaluateRow";

export default function AdministrationEvaluationPage() {
  const { data: allReports = [], isLoading } = useUnitHeadAppraisals({ status: "submitted" });
  const reports = allReports.filter((r) => r.recipient === "Administration Office");

  if (isLoading) return <PageLoading />;

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Appraisal", "Unit Head performance evaluation"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Unit Head performance evaluation</h1>
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">Evaluating produces an individual appraisal job summary and auto-forwards to the CPU · {reports.length} pending</p>
      </div>

      {reports.length === 0 ? (
        <EmptyState title="No Unit Head reports awaiting evaluation" />
      ) : (
        <div className="space-y-3">{reports.map((r) => <UnitHeadEvaluateRow key={r.id} report={r} defaultEvaluator="Administration" />)}</div>
      )}
    </div>
  );
}
