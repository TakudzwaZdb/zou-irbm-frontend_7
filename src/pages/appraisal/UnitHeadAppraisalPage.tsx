import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { appraiseScoreSchema, type AppraiseScoreFormValues } from "@/forms/staffAppraisalSchema";
import { useStaffAppraisals, useAppraiseStaff, useReturnStaffAppraisal } from "@/hooks/useStaffAppraisals";
import { useAuth } from "@/context/AuthContext";
import { orgUnits } from "@/data/organisation";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { useToast } from "@/components/ui/Toast";
import type { StaffAppraisal } from "@/types/appraisal";

function AppraiseRow({ report }: { report: StaffAppraisal }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const appraise = useAppraiseStaff();
  const returnFor = useReturnStaffAppraisal();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AppraiseScoreFormValues>({
    resolver: zodResolver(appraiseScoreSchema) as Resolver<AppraiseScoreFormValues>,
  });

  async function onSubmit(values: AppraiseScoreFormValues) {
    await appraise.mutateAsync({ id: report.id, score: values.score, comment: values.comment, appraisedBy: user?.name ?? "Unit Head" });
    toast({ title: "Appraisal recorded", description: `${report.staffName}'s report has been scored.`, kind: "success" });
  }

  async function handleReturn() {
    await returnFor.mutateAsync({ id: report.id, comment: "Please add more detail before resubmitting." });
    toast({ title: "Returned for correction", kind: "info" });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{report.staffName}</p>
          <p className="text-xs text-slate-400">Week ending {report.weekEnding}</p>
        </div>
      </div>
      <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{report.activitySummary}</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-3 space-y-2">
        <div className="flex items-end gap-2">
          <FormField label="Score (0–100%)" error={errors.score?.message}>
            <Input type="number" min={0} max={100} step="any" className="w-28" {...register("score")} error={!!errors.score} />
          </FormField>
          <Button type="submit" size="sm" disabled={isSubmitting}><CheckCircle2 size={13} /> Appraise</Button>
          <Button type="button" size="sm" variant="outline" onClick={handleReturn}><RotateCcw size={13} /> Return</Button>
        </div>
        <FormField label="Comment" error={errors.comment?.message}>
          <Textarea rows={2} placeholder="Appraisal comment" {...register("comment")} />
        </FormField>
      </form>
    </div>
  );
}

export default function UnitHeadAppraisalPage() {
  const { user } = useAuth();
  const myUnit = orgUnits.find((u) => u.head === user?.name) ?? orgUnits[0];
  const { data: reports = [], isLoading } = useStaffAppraisals({ status: "submitted", recipientUnitId: myUnit.id });

  if (isLoading) return <PageLoading />;

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Appraisal", "Appraise staff reports"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Appraise staff reports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Reports sent to {user?.name} · {myUnit.name} · {reports.length} awaiting a score</p>
      </div>

      {reports.length === 0 ? (
        <EmptyState title="No reports awaiting appraisal" />
      ) : (
        <div className="space-y-3">{reports.map((r) => <AppraiseRow key={r.id} report={r} />)}</div>
      )}
    </div>
  );
}
