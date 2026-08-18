import { useState } from "react";
import { CheckCircle2, XCircle, RotateCcw, FileText } from "lucide-react";
import { useSubmissions, useDecideSubmission } from "@/hooks/usePerformance";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { formatValue } from "@/utils/format";
import type { PerformanceSubmission } from "@/types/kpi";

export default function CpuReviewPage() {
  const { data: submissions = [], isLoading } = useSubmissions();
  const decide = useDecideSubmission();
  const { toast } = useToast();
  const [comments, setComments] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const pending = submissions.filter((s) => s.status === "submitted" || s.status === "pending_review");

  async function handleDecision(s: PerformanceSubmission, decision: "approved" | "rejected" | "returned") {
    await decide.mutateAsync({ id: s.id, decision, comment: comments[s.id] });
    toast({
      title: decision === "approved" ? "Submission approved" : decision === "rejected" ? "Submission rejected" : "Returned for correction",
      kind: decision === "approved" ? "success" : "error",
    });
  }

  if (isLoading) return <PageLoading />;

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Performance", "CPU validation & approval"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">CPU validation &amp; approval</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Corporate Planning Unit review queue · {pending.length} submissions awaiting a decision</p>
      </div>

      {pending.length === 0 ? (
        <EmptyState title="Nothing waiting on review" message="All submitted KPIs have been actioned." />
      ) : (
        <div className="space-y-3">
          {pending.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.kpiName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{s.period} · Submitted by {s.submittedBy}{s.late && " · "}{s.late && <Badge variant="warning">Late</Badge>}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{formatValue(s.actual, "number")} <span className="text-xs font-normal text-slate-400">/ {formatValue(s.target, "number")}</span></p>
                  <p className="text-xs text-slate-400">{s.achievementPct}% achievement</p>
                </div>
              </div>

              <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{s.explanation}</p>

              {s.evidenceFileName && (
                <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline">
                  <FileText size={12} /> {s.evidenceFileName}
                </button>
              )}

              <Textarea
                placeholder="Review comment (required for rejections and returns)"
                value={comments[s.id] ?? ""}
                onChange={(e) => setComments({ ...comments, [s.id]: e.target.value })}
                rows={2}
                className="mt-3"
              />

              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => handleDecision(s, "approved")}><CheckCircle2 size={13} /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => handleDecision(s, "returned")}><RotateCcw size={13} /> Return for correction</Button>
                <Button size="sm" variant="destructive" onClick={() => handleDecision(s, "rejected")}><XCircle size={13} /> Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
