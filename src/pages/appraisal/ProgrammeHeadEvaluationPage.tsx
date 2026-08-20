import { useUnitHeadAppraisals } from "@/hooks/useUnitHeadAppraisals";
import { useAuth } from "@/context/AuthContext";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { UnitHeadEvaluateRow } from "@/components/shared/UnitHeadEvaluateRow";

export default function ProgrammeHeadEvaluationPage() {
  const { user } = useAuth();
  const { data: allReports = [], isLoading } = useUnitHeadAppraisals({ status: "submitted" });
  // Recipients are stored as "<Programme Head name> — Programme Head, <Programme>" —
  // match on this Programme Head's own name.
  const reports = allReports.filter((r) => user && r.recipient.startsWith(user.name));

  if (isLoading) return <PageLoading />;

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Appraisal", "Unit Head performance evaluation"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Unit Head performance evaluation</h1>
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Reports Unit Heads addressed to you · evaluating auto-forwards to CPU · {reports.length} pending
        </p>
      </div>

      {reports.length === 0 ? (
        <EmptyState title="No Unit Head reports awaiting your evaluation" message="Reports only appear here when a Unit Head addresses their weekly report to you specifically." />
      ) : (
        <div className="space-y-3">{reports.map((r) => <UnitHeadEvaluateRow key={r.id} report={r} defaultEvaluator="Programme Head" />)}</div>
      )}
    </div>
  );
}
