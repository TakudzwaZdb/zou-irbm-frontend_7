import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { Download } from "lucide-react";
import { unitHeadPerformanceSchema, type UnitHeadPerformanceFormValues } from "@/forms/unitHeadPerformanceSchema";
import { useUnitHeadAppraisals, useSubmitUnitHeadAppraisal } from "@/hooks/useUnitHeadAppraisals";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useAuth } from "@/context/AuthContext";
import { orgUnits } from "@/data/organisation";
import { unitHeadIdFor } from "@/utils/unitHeadId";
import { downloadTextFile, downloadFile, buildUnitHeadReportText } from "@/utils/downloadText";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { FileAttachmentField } from "@/components/shared/FileAttachmentField";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

const STATUS_VARIANT = { draft: "default", submitted: "info", appraised: "success", returned: "danger", evaluated: "success", forwarded_to_cpu: "info" } as const;

export default function UnitHeadPerformancePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const myUnit = orgUnits.find((u) => u.head === user?.name) ?? orgUnits[0];
  const unitHeadId = unitHeadIdFor(myUnit.id);
  const { data: programmes = [] } = useProgrammes();
  const [attachment, setAttachment] = useState<File | null>(null);

  // A Unit Head's "boss" can be the Administration office or their Programme Head.
  const recipients = ["Administration Office", ...programmes.map((p) => `${p.head} — Programme Head, ${p.name}`)];

  const { data: myReports = [] } = useUnitHeadAppraisals({ unitId: myUnit.id });
  const submit = useSubmitUnitHeadAppraisal();

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<UnitHeadPerformanceFormValues>({
    resolver: zodResolver(unitHeadPerformanceSchema) as Resolver<UnitHeadPerformanceFormValues>,
    defaultValues: { weekEnding: "2026-08-17", recipient: "Administration Office" },
  });

  async function onSubmit(values: UnitHeadPerformanceFormValues) {
    if (!attachment) {
      toast({ title: "Attachment required", description: "Every performance report must be submitted as an attached document.", kind: "error" });
      return;
    }
    await submit.mutateAsync({ unitHeadId, unitHeadName: user?.name ?? myUnit.head, unitId: myUnit.id, unitName: myUnit.name, ...values, attachmentName: attachment.name, attachmentFile: attachment });
    toast({ title: "Performance report submitted", description: `Sent to ${values.recipient.split(" — ")[0]} for evaluation.`, kind: "success" });
    reset({ weekEnding: "2026-08-17", recipient: "Administration Office", jobSummary: "" });
    setAttachment(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-5">
        <div>
          <Breadcrumbs items={["Appraisal", "Unit Head performance report"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Individual performance report</h1>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{myUnit.name} · choose who this report goes to for evaluation</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <FormField label="Send to" error={errors.recipient?.message} hint="Your Administration office or your Programme Head">
            <Controller name="recipient" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select a recipient" /></SelectTrigger>
                <SelectContent>
                  {recipients.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Week ending" error={errors.weekEnding?.message}>
            <Input type="date" {...register("weekEnding")} error={!!errors.weekEnding} />
          </FormField>
          <FormField label="Job summary" error={errors.jobSummary?.message} hint="Summarize your team's output and your own performance this week">
            <Textarea rows={5} placeholder="e.g. Oversaw firmware upgrade rollout; team SLA held at 96%." {...register("jobSummary")} />
          </FormField>
          <FormField label="Attached document" hint="Upload the completed report form (PDF, Word, or scanned copy)">
            <FileAttachmentField file={attachment} onChange={setAttachment} required />
          </FormField>
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit report"}</Button>
          </div>
        </form>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Your submission history</p>
        <div className="space-y-2">
          {myReports.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Week ending {r.weekEnding}</p>
                <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">{r.status.replace(/_/g, " ")}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Sent to {r.recipient}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{r.jobSummary}</p>
              {r.attachmentName && (
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Attached: {r.attachmentName} <span className="text-slate-400">(uploaded {r.attachmentUploadedAt})</span>
                </p>
              )}
              {r.score !== null && <p className="mt-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">Score: {r.score}%</p>}
              {r.evaluationComment && (
                <p className={`mt-1.5 rounded-md p-1.5 text-[11px] leading-relaxed ${r.status === "returned" ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                  <span className="font-medium">{r.status === "returned" ? "Returned: " : "Comment: "}</span>{r.evaluationComment}
                </p>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                <Button size="sm" variant="ghost" className="px-2" onClick={() => downloadTextFile(`My_performance_report_${r.weekEnding}.txt`, buildUnitHeadReportText(r))}>
                  <Download size={11} /> Summary
                </Button>
                {r.attachmentFile && (
                  <Button size="sm" variant="ghost" className="px-2" onClick={() => downloadFile(r.attachmentFile!)}>
                    <Download size={11} /> Document
                  </Button>
                )}
              </div>
            </div>
          ))}
          {myReports.length === 0 && <p className="text-xs text-slate-400">No submissions yet.</p>}
        </div>
      </div>
    </div>
  );
}
