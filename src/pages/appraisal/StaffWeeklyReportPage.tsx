import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { Download } from "lucide-react";
import { staffWeeklyReportSchema, type StaffWeeklyReportFormValues } from "@/forms/staffAppraisalSchema";
import { useStaffAppraisals, useSubmitStaffAppraisal } from "@/hooks/useStaffAppraisals";
import { useAuth } from "@/context/AuthContext";
import { downloadTextFile, downloadFile, buildStaffReportText } from "@/utils/downloadText";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { FileAttachmentField } from "@/components/shared/FileAttachmentField";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { staffMembers } from "@/data/staff";
import { orgUnits } from "@/data/organisation";

const STATUS_VARIANT = { draft: "default", submitted: "info", appraised: "success", returned: "danger", evaluated: "default", forwarded_to_cpu: "default" } as const;

export default function StaffWeeklyReportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const me = staffMembers.find((s) => s.name === user?.name) ?? staffMembers[0];
  const unit = orgUnits.find((u) => u.id === me.unitId);
  const [attachment, setAttachment] = useState<File | null>(null);

  const { data: myReports = [] } = useStaffAppraisals({ staffId: me.id });
  const submit = useSubmitStaffAppraisal();

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<StaffWeeklyReportFormValues>({
    resolver: zodResolver(staffWeeklyReportSchema) as Resolver<StaffWeeklyReportFormValues>,
    defaultValues: { weekEnding: "2026-08-17", recipientUnitId: me.unitId },
  });

  async function onSubmit(values: StaffWeeklyReportFormValues) {
    if (!attachment) {
      toast({ title: "Attachment required", description: "Every report must be submitted as an attached document.", kind: "error" });
      return;
    }
    const recipient = orgUnits.find((u) => u.id === values.recipientUnitId)!;
    await submit.mutateAsync({
      staffId: me.id, staffName: me.name, unitId: me.unitId, unitName: unit?.name ?? "",
      recipientUnitId: recipient.id, recipientUnitName: recipient.name, recipientHead: recipient.head,
      weekEnding: values.weekEnding, activitySummary: values.activitySummary,
      attachmentName: attachment.name, attachmentFile: attachment,
    });
    toast({ title: "Weekly report submitted", description: `Sent to ${recipient.head} for appraisal.`, kind: "success" });
    reset({ weekEnding: "2026-08-17", recipientUnitId: me.unitId, activitySummary: "" });
    setAttachment(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-5">
        <div>
          <Breadcrumbs items={["Appraisal", "Weekly job activity report"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Weekly job activity report</h1>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{unit?.name} · choose who this report goes to for appraisal</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <FormField label="Send to" error={errors.recipientUnitId?.message} hint="The relevant Unit Head, Faculty Dean, or Regional Campus lead">
            <Controller name="recipientUnitId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select a recipient" /></SelectTrigger>
                <SelectContent>
                  {orgUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.head} — {u.name} ({u.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Week ending" error={errors.weekEnding?.message}>
            <Input type="date" {...register("weekEnding")} error={!!errors.weekEnding} />
          </FormField>
          <FormField label="Activity summary" error={errors.activitySummary?.message} hint="What did you work on and complete this week?">
            <Textarea rows={5} placeholder="e.g. Completed router firmware upgrades across two campuses; resolved 14 network tickets." {...register("activitySummary")} />
          </FormField>
          <FormField label="Attached document" hint="Upload the completed report form (PDF, Word, or scanned copy)">
            <FileAttachmentField file={attachment} onChange={setAttachment} required />
          </FormField>
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit for appraisal"}</Button>
          </div>
        </form>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Your appraisal history</p>
        <div className="space-y-2">
          {myReports.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Week ending {r.weekEnding}</p>
                <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">{r.status.replace(/_/g, " ")}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Sent to {r.recipientHead} · {r.recipientUnitName}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{r.activitySummary}</p>
              {r.attachmentName && (
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Attached: {r.attachmentName} <span className="text-slate-400">(uploaded {r.attachmentUploadedAt})</span>
                </p>
              )}
              {r.score !== null && <p className="mt-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">Score: {r.score}%</p>}
              {r.appraisalComment && <p className="mt-1 rounded-md bg-slate-50 p-1.5 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.appraisalComment}</p>}
              {r.feedback && (
                <p className="mt-1 rounded-md bg-indigo-50 p-1.5 text-[11px] leading-relaxed text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  <span className="font-medium">Feedback from {r.feedbackBy} ({r.feedbackAt}): </span>{r.feedback}
                </p>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                <Button size="sm" variant="ghost" className="px-2" onClick={() => downloadTextFile(`My_report_${r.weekEnding}.txt`, buildStaffReportText(r))}>
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
          {myReports.length === 0 && <p className="text-xs text-slate-400">No reports submitted yet.</p>}
        </div>
      </div>
    </div>
  );
}
