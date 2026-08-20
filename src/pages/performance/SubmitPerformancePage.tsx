import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Upload } from "lucide-react";
import { performanceSubmissionSchema, type PerformanceSubmissionFormValues } from "@/forms/performanceSubmissionSchema";
import type { Resolver } from "react-hook-form";
import { useKpis } from "@/hooks/useKpis";
import { useSubmitPerformance, useSubmissions } from "@/hooks/usePerformance";
import { useAuth } from "@/context/AuthContext";
import { reportingMonths, currentReportingMonth, isPeriodPastDue } from "@/utils/reportingPeriods";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { WorkflowBadge } from "@/components/shared/WorkflowBadge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { formatValue } from "@/utils/format";

export default function SubmitPerformancePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: kpis = [] } = useKpis();
  const { data: submissions = [] } = useSubmissions();
  const submit = useSubmitPerformance();
  const [fileName, setFileName] = useState<string | undefined>();
  const months = reportingMonths(12);

  const editableKpis = kpis.filter((k) => k.workflow === "draft" || k.workflow === "returned");

  const { register, handleSubmit, control, watch, reset, formState: { errors, isSubmitting } } = useForm<PerformanceSubmissionFormValues>({
    resolver: zodResolver(performanceSubmissionSchema) as Resolver<PerformanceSubmissionFormValues>,
    defaultValues: { period: currentReportingMonth() },
  });
  const kpiId = watch("kpiId");
  const period = watch("period");
  const selectedKpi = kpis.find((k) => k.id === kpiId);
  const pastDue = period ? isPeriodPastDue(period) : false;

  async function onSubmit(values: PerformanceSubmissionFormValues) {
    if (!selectedKpi) return;
    await submit.mutateAsync({
      kpiId: selectedKpi.id, kpiName: selectedKpi.name, period: values.period,
      target: selectedKpi.target, actual: values.actual, explanation: values.explanation,
      evidenceFileName: fileName, submittedBy: user?.name ?? "Unknown", reviewComment: undefined,
    });
    toast({ title: "Submitted for review", description: "The Corporate Planning Unit will review this shortly.", kind: "success" });
    reset({ period: currentReportingMonth(), kpiId: "", actual: undefined, explanation: "" });
    setFileName(undefined);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-5">
        <div>
          <Breadcrumbs items={["Performance", "Submit performance"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Monthly performance submission</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Monthly reporting cadence · due the 5th of the following month</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <FormField label="KPI" error={errors.kpiId?.message}>
            <Controller name="kpiId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select a KPI to report on" /></SelectTrigger>
                <SelectContent>{editableKpis.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>

          <FormField label="Reporting period" error={errors.period?.message} hint="Any of the last 12 calendar months">
            <Controller name="period" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>

          {pastDue && (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle size={12} /> This period is past its due date — submitting now will be recorded as late.
            </p>
          )}

          {selectedKpi && (
            <div className="grid grid-cols-2 gap-3">
              <FormField label={`Target (${selectedKpi.unit})`}>
                <Input value={formatValue(selectedKpi.target, selectedKpi.unit)} disabled />
              </FormField>
              <FormField label={`Actual (${selectedKpi.unit})`} error={errors.actual?.message}>
                <Input type="number" step="any" placeholder="Enter this period's actual" {...register("actual")} error={!!errors.actual} />
              </FormField>
            </div>
          )}

          <FormField label="Explanation" error={errors.explanation?.message} hint="Required — explain the result achieved this period">
            <Textarea rows={3} placeholder="e.g. Delivery proceeded as planned; two new partnerships closed in the final week." {...register("explanation")} />
          </FormField>

          <FormField label="Supporting evidence">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500 hover:border-indigo-300">
              <Upload size={14} />
              {fileName ?? "Attach a file (PDF, XLSX, image)"}
              <input type="file" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name)} />
            </label>
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline">Save draft</Button>
            <Button type="submit" disabled={isSubmitting || !selectedKpi}>{isSubmitting ? "Submitting…" : "Submit for review"}</Button>
          </div>
        </form>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Your recent submissions</p>
        <div className="space-y-2">
          {submissions.filter((s) => s.submittedBy === user?.name).slice(0, 6).map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{s.kpiName}</p>
                <WorkflowBadge status={s.status} />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{s.period} · {s.achievementPct}% achieved{s.late && " · late"}</p>
              {s.reviewComment && <p className="mt-1.5 rounded-md bg-rose-50 p-1.5 text-[11px] text-rose-600 dark:bg-rose-950 dark:text-rose-300">{s.reviewComment}</p>}
            </div>
          ))}
          {submissions.filter((s) => s.submittedBy === user?.name).length === 0 && (
            <p className="text-xs text-slate-400">No submissions yet this period.</p>
          )}
        </div>
      </div>
    </div>
  );
}
