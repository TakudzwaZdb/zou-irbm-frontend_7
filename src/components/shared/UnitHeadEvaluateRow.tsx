import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { CheckCircle2, ArrowRight, Download, Paperclip, RotateCcw } from "lucide-react";
import { evaluateScoreSchema, type EvaluateScoreFormValues } from "@/forms/unitHeadPerformanceSchema";
import { useEvaluateUnitHead, useReturnUnitHeadAppraisal } from "@/hooks/useUnitHeadAppraisals";
import { useAuth } from "@/context/AuthContext";
import { downloadTextFile, downloadFile, buildUnitHeadReportText } from "@/utils/downloadText";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { useToast } from "@/components/ui/Toast";
import type { UnitHeadAppraisal } from "@/types/appraisal";

export function UnitHeadEvaluateRow({ report, defaultEvaluator }: { report: UnitHeadAppraisal; defaultEvaluator: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const evaluate = useEvaluateUnitHead();
  const returnFor = useReturnUnitHeadAppraisal();
  const [returnDraft, setReturnDraft] = useState("");
  const [showReturn, setShowReturn] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EvaluateScoreFormValues>({
    resolver: zodResolver(evaluateScoreSchema) as Resolver<EvaluateScoreFormValues>,
  });

  async function onSubmit(values: EvaluateScoreFormValues) {
    await evaluate.mutateAsync({ id: report.id, score: values.score, comment: values.comment, evaluatedBy: user?.name ?? defaultEvaluator });
    toast({ title: "Evaluation recorded", description: `${report.unitHeadName}'s report has been forwarded to CPU.`, kind: "success" });
  }

  async function handleReturn() {
    if (!returnDraft.trim()) return;
    await returnFor.mutateAsync({ id: report.id, comment: returnDraft, returnedBy: user?.name ?? defaultEvaluator });
    toast({ title: "Returned for correction", description: `${report.unitHeadName} will see your note.`, kind: "info" });
    setReturnDraft("");
    setShowReturn(false);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{report.unitHeadName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{report.unitName} · Week ending {report.weekEnding} · submitted {report.submittedAt}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" onClick={() => downloadTextFile(`${report.unitHeadName.replace(/\s+/g, "_")}_${report.weekEnding}.txt`, buildUnitHeadReportText(report))}>
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

      <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">{report.jobSummary}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Score (0–100%)" error={errors.score?.message}>
            <Input type="number" min={0} max={100} step="any" className="w-28" {...register("score")} error={!!errors.score} />
          </FormField>
          <Button type="submit" size="sm" disabled={isSubmitting}><CheckCircle2 size={13} /> Evaluate &amp; forward <ArrowRight size={12} /></Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowReturn((s) => !s)}><RotateCcw size={13} /> Return</Button>
        </div>
        <FormField label="Comment" error={errors.comment?.message}>
          <Textarea rows={2} placeholder="Evaluation comment" {...register("comment")} />
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
    </div>
  );
}
