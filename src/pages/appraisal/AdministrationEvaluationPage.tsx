import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { evaluateScoreSchema, type EvaluateScoreFormValues } from "@/forms/unitHeadPerformanceSchema";
import { useUnitHeadAppraisals, useEvaluateUnitHead } from "@/hooks/useUnitHeadAppraisals";
import { useAuth } from "@/context/AuthContext";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { useToast } from "@/components/ui/Toast";
import type { UnitHeadAppraisal } from "@/types/appraisal";

function EvaluateRow({ report }: { report: UnitHeadAppraisal }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const evaluate = useEvaluateUnitHead();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EvaluateScoreFormValues>({
    resolver: zodResolver(evaluateScoreSchema) as Resolver<EvaluateScoreFormValues>,
  });

  async function onSubmit(values: EvaluateScoreFormValues) {
    await evaluate.mutateAsync({ id: report.id, score: values.score, comment: values.comment, evaluatedBy: user?.name ?? "Administration" });
    toast({ title: "Evaluation recorded", description: `${report.unitHeadName}'s report has been forwarded to CPU.`, kind: "success" });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{report.unitHeadName}</p>
          <p className="text-xs text-slate-400">{report.unitName} · Week ending {report.weekEnding} · Sent to {report.recipient}</p>
        </div>
      </div>
      <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{report.jobSummary}</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-3 space-y-2">
        <div className="flex items-end gap-2">
          <FormField label="Score (0–100%)" error={errors.score?.message}>
            <Input type="number" min={0} max={100} step="any" className="w-28" {...register("score")} error={!!errors.score} />
          </FormField>
          <Button type="submit" size="sm" disabled={isSubmitting}><CheckCircle2 size={13} /> Evaluate &amp; forward <ArrowRight size={12} /></Button>
        </div>
        <FormField label="Comment" error={errors.comment?.message}>
          <Textarea rows={2} placeholder="Evaluation comment" {...register("comment")} />
        </FormField>
      </form>
    </div>
  );
}

export default function AdministrationEvaluationPage() {
  const { data: allReports = [], isLoading } = useUnitHeadAppraisals({ status: "submitted" });
  const reports = allReports.filter((r) => r.recipient === "Administration Office");

  if (isLoading) return <PageLoading />;

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Appraisal", "Unit Head performance evaluation"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Unit Head performance evaluation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Evaluating produces an individual appraisal job summary and auto-forwards to the CPU · {reports.length} pending</p>
      </div>

      {reports.length === 0 ? (
        <EmptyState title="No Unit Head reports awaiting evaluation" />
      ) : (
        <div className="space-y-3">{reports.map((r) => <EvaluateRow key={r.id} report={r} />)}</div>
      )}
    </div>
  );
}
