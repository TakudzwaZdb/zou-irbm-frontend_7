import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { CheckCircle2, RotateCcw, Download, Send, Paperclip } from "lucide-react";
import { appraiseScoreSchema, type AppraiseScoreFormValues } from "@/forms/staffAppraisalSchema";
import { useStaffAppraisals, useAppraiseStaff, useReturnStaffAppraisal, useSendStaffFeedback } from "@/hooks/useStaffAppraisals";
import { useAuth } from "@/context/AuthContext";
import { orgUnits } from "@/data/organisation";
import { downloadTextFile, downloadFile, buildStaffReportText } from "@/utils/downloadText";
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
  const sendFeedback = useSendStaffFeedback();
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [returnDraft, setReturnDraft] = useState("");
  const [showReturn, setShowReturn] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AppraiseScoreFormValues>({
    resolver: zodResolver(appraiseScoreSchema) as Resolver<AppraiseScoreFormValues>,
  });

  async function onSubmit(values: AppraiseScoreFormValues) {
    await appraise.mutateAsync({ id: report.id, score: values.score, comment: values.comment, appraisedBy: user?.name ?? "Unit Head" });
    toast({ title: "Appraisal recorded", description: `${report.staffName}'s report has been scored.`, kind: "success" });
  }

  async function handleReturn() {
    if (!returnDraft.trim()) return;
    await returnFor.mutateAsync({ id: report.id, comment: returnDraft, returnedBy: user?.name ?? "Unit Head" });
    toast({ title: "Returned for correction", description: `${report.staffName} will see your note.`, kind: "info" });
    setReturnDraft("");
    setShowReturn(false);
  }

  async function handleSendFeedback() {
    if (!feedbackDraft.trim()) return;
    await sendFeedback.mutateAsync({ id: report.id, feedback: feedbackDraft, sentBy: user?.name ?? "Unit Head" });
    toast({ title: "Feedback sent", description: `${report.staffName} will see this on their report.`, kind: "success" });
    setFeedbackDraft("");
    setShowFeedback(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{report.staffName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Week ending {report.weekEnding} · submitted {report.submittedAt}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" onClick={() => downloadTextFile(`${report.staffName.replace(/\s+/g, "_")}_${report.weekEnding}.txt`, buildStaffReportText(report))}>
            <Download size={12} /> Summary
          </Button>
          {report.attachmentFile && (
            <Button size="sm" variant="outline" onClick={() => downloadFile(report.attachmentFile!)}><Paperclip size={12} /> Document</Button>
          )}
        </div>
      </div>

      {report.attachmentName && (
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          Attached: {report.attachmentName} <span className="text-slate-400">(uploaded {report.attachmentUploadedAt})</span>
        </p>
      )}

      <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">{report.activitySummary}</p>

      {report.feedback && (
        <p className="mt-2 rounded-lg bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          <span className="font-medium">Your feedback ({report.feedbackAt}): </span>{report.feedback}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Score (0–100%)" error={errors.score?.message}>
            <Input type="number" min={0} max={100} step="any" className="w-28" {...register("score")} error={!!errors.score} />
          </FormField>
          <Button type="submit" size="sm" disabled={isSubmitting}><CheckCircle2 size={13} /> Appraise</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowReturn((s) => !s)}><RotateCcw size={13} /> Return</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowFeedback((s) => !s)}><Send size={13} /> Send feedback</Button>
        </div>
        <FormField label="Comment" error={errors.comment?.message}>
          <Textarea rows={2} placeholder="Appraisal comment" {...register("comment")} />
        </FormField>
      </form>

      {showReturn && (
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <Textarea rows={2} placeholder="Explain what needs correcting before resubmission…" value={returnDraft} onChange={(e) => setReturnDraft(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" onClick={handleReturn} disabled={returnFor.isPending || !returnDraft.trim()}>
            {returnFor.isPending ? "Sending…" : "Confirm return"}
          </Button>
        </div>
      )}

      {showFeedback && (
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1">
            <Textarea rows={2} placeholder="Write feedback for the sender…" value={feedbackDraft} onChange={(e) => setFeedbackDraft(e.target.value)} />
          </div>
          <Button size="sm" onClick={handleSendFeedback} disabled={sendFeedback.isPending || !feedbackDraft.trim()}>
            {sendFeedback.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      )}
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
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">Reports sent to {user?.name} · {myUnit.name} · {reports.length} awaiting a score</p>
      </div>

      {reports.length === 0 ? (
        <EmptyState title="No reports awaiting appraisal" />
      ) : (
        <div className="space-y-3">{reports.map((r) => <AppraiseRow key={r.id} report={r} />)}</div>
      )}
    </div>
  );
}
