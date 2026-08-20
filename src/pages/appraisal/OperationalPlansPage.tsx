import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { Archive, CheckCircle2, Clock, Download, Paperclip, Plus, RotateCw, ShieldCheck, XCircle } from "lucide-react";
import { operationalPlanSchema, type OperationalPlanFormValues } from "@/forms/operationalPlanSchema";
import { cpuValidationSchema, type CpuValidationFormValues } from "@/forms/cpuValidationSchema";
import {
  useOperationalPlans, useSubmitOperationalPlan, useApproveByProgrammeHead, useApproveByVc, useValidateByCpu,
  useRejectOperationalPlan, useResubmitOperationalPlan,
} from "@/hooks/useOperationalPlans";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useAuth } from "@/context/AuthContext";
import { orgUnits } from "@/data/organisation";
import { unitHeadIdFor } from "@/utils/unitHeadId";
import { downloadTextFile, downloadFile, buildOperationalPlanText } from "@/utils/downloadText";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { FileAttachmentField } from "@/components/shared/FileAttachmentField";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { ApprovalStage, OperationalPlan, OperationalPlanStatus } from "@/types/appraisal";

const STATUS_LABEL: Record<OperationalPlanStatus, string> = {
  pending_programme_head: "Pending Programme Head",
  pending_vc: "Pending Vice-Chancellor",
  pending_cpu: "Pending CPU validation",
  validated: "Validated by CPU",
  rejected: "Rejected",
};
const STATUS_VARIANT: Record<OperationalPlanStatus, "warning" | "info" | "success" | "danger"> = {
  pending_programme_head: "warning", pending_vc: "warning", pending_cpu: "warning", validated: "success", rejected: "danger",
};
const STAGE_LABEL: Record<ApprovalStage, string> = { programme_head: "Programme Head", vc: "Vice-Chancellor", cpu: "CPU" };

function PlanCard({ plan, footer }: { plan: OperationalPlan; footer?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{plan.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{plan.unitName} · {plan.period} · Submitted by {plan.unitHeadName} on {plan.submittedAt}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {plan.archived && <Badge variant="default"><Archive size={11} /> Archived</Badge>}
          <Badge variant={STATUS_VARIANT[plan.status]}>
            {plan.status === "validated" ? <CheckCircle2 size={11} /> : plan.status === "rejected" ? <XCircle size={11} /> : <Clock size={11} />} {STATUS_LABEL[plan.status]}
          </Badge>
        </div>
      </div>

      {plan.attachmentName && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <Paperclip size={11} className="shrink-0" /> {plan.attachmentName} <span className="text-slate-400">(uploaded {plan.attachmentUploadedAt})</span>
          </p>
          {plan.attachmentFile && (
            <button onClick={() => downloadFile(plan.attachmentFile!)} className="shrink-0 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400">Download</button>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span>Programme Head: {plan.programmeHeadReviewedBy ? `${plan.programmeHeadReviewedBy} on ${plan.programmeHeadReviewedAt}` : "pending"}</span>
        <span>Vice-Chancellor: {plan.vcReviewedBy ? `${plan.vcReviewedBy} on ${plan.vcReviewedAt}` : "pending"}</span>
        <span>CPU: {plan.cpuValidatedBy ? `${plan.cpuValidatedBy} on ${plan.cpuValidatedAt}` : "pending"}</span>
      </div>

      {plan.status === "validated" && (
        <div className="mt-2 space-y-1 rounded-lg bg-emerald-50 p-2.5 text-[11px] leading-relaxed text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <p><span className="font-medium">Budget: </span>{plan.budgetComment}</p>
          <p><span className="font-medium">Feasibility: </span>{plan.feasibilityComment}</p>
        </div>
      )}

      {plan.status === "rejected" && (
        <div className="mt-2 rounded-lg bg-rose-50 p-2.5 text-[11px] leading-relaxed text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          <p><span className="font-medium">Rejected at {STAGE_LABEL[plan.rejectedStage!]} stage by {plan.rejectedBy} on {plan.rejectedAt}:</span> {plan.rejectionReason}</p>
        </div>
      )}

      <button
        onClick={() => downloadTextFile(`${plan.title.replace(/\s+/g, "_")}.txt`, buildOperationalPlanText(plan))}
        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        <Download size={11} /> Download full record with timestamps
      </button>

      {footer}
    </div>
  );
}

function RejectControl({ onReject }: { onReject: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><XCircle size={13} /> Reject</Button>;
  }
  return (
    <div className="flex flex-1 items-end gap-2">
      <div className="flex-1"><Textarea rows={1} placeholder="Reason for rejection…" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <Button size="sm" variant="destructive" disabled={!reason.trim()} onClick={() => { onReject(reason); setOpen(false); setReason(""); }}>Confirm reject</Button>
    </div>
  );
}

function ResubmitButton({ plan }: { plan: OperationalPlan }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const resubmit = useResubmitOperationalPlan();

  async function handleResubmit() {
    await resubmit.mutateAsync({ id: plan.id, resubmittedBy: user?.name ?? plan.unitHeadName });
    toast({ title: "Plan resubmitted", description: "Sent back to your Programme Head for approval.", kind: "success" });
  }

  return (
    <Button size="sm" onClick={handleResubmit} disabled={resubmit.isPending}>
      <RotateCw size={13} /> {resubmit.isPending ? "Resubmitting…" : "Revise & resubmit"}
    </Button>
  );
}

function CpuValidationForm({ plan }: { plan: OperationalPlan }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const validate = useValidateByCpu();
  const reject = useRejectOperationalPlan();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CpuValidationFormValues>({
    resolver: zodResolver(cpuValidationSchema) as Resolver<CpuValidationFormValues>,
  });

  async function onSubmit(values: CpuValidationFormValues) {
    await validate.mutateAsync({ id: plan.id, validatedBy: user?.name ?? "Corporate Planning Unit", ...values });
    toast({ title: "Plan validated", description: "Evaluation and monitoring complete — plan is now finalized.", kind: "success" });
  }

  async function handleReject(reason: string) {
    await reject.mutateAsync({ id: plan.id, stage: "cpu", rejectedBy: user?.name ?? "Corporate Planning Unit", reason });
    toast({ title: "Plan rejected", kind: "error" });
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        <FormField label="Budget assessment" error={errors.budgetComment?.message}>
          <Textarea rows={2} placeholder="Is this plan within budget?" {...register("budgetComment")} />
        </FormField>
        <FormField label="Feasibility assessment" error={errors.feasibilityComment?.message}>
          <Textarea rows={2} placeholder="Is this plan realistically achievable?" {...register("feasibilityComment")} />
        </FormField>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting}><ShieldCheck size={13} /> Validate &amp; finalize</Button>
          <RejectControl onReject={handleReject} />
        </div>
      </form>
    </div>
  );
}

function ApprovalRow({ plan, stage, onApprove, actionLabel }: { plan: OperationalPlan; stage: ApprovalStage; onApprove: () => void; actionLabel: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const reject = useRejectOperationalPlan();

  async function handleReject(reason: string) {
    await reject.mutateAsync({ id: plan.id, stage, rejectedBy: user?.name ?? STAGE_LABEL[stage], reason });
    toast({ title: "Plan rejected", kind: "error" });
  }

  return (
    <PlanCard plan={plan} footer={
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Button size="sm" onClick={onApprove}><CheckCircle2 size={13} /> {actionLabel}</Button>
        <RejectControl onReject={handleReject} />
      </div>
    } />
  );
}

export default function OperationalPlansPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: allPlans = [], isLoading } = useOperationalPlans();
  const { data: programmes = [] } = useProgrammes();
  const submit = useSubmitOperationalPlan();
  const approveByProgrammeHead = useApproveByProgrammeHead();
  const approveByVc = useApproveByVc();
  const myUnit = orgUnits.find((u) => u.head === user?.name) ?? orgUnits[0];
  const myProgramme = programmes.find((p) => p.head === user?.name);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [programmeFilter, setProgrammeFilter] = useState("all");

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<OperationalPlanFormValues>({
    resolver: zodResolver(operationalPlanSchema) as Resolver<OperationalPlanFormValues>,
    defaultValues: { period: "Q3 2026" },
  });

  async function onSubmit(values: OperationalPlanFormValues) {
    if (!attachment) {
      toast({ title: "Attachment required", description: "Every operational plan must be submitted as an attached document.", kind: "error" });
      return;
    }
    await submit.mutateAsync({ unitHeadId: unitHeadIdFor(myUnit.id), unitHeadName: user?.name ?? myUnit.head, unitId: myUnit.id, unitName: myUnit.name, ...values, attachmentName: attachment.name, attachmentFile: attachment });
    toast({ title: "Operational plan submitted", description: "Sent to your Programme Head for approval; a copy has been archived.", kind: "success" });
    reset({ period: "Q3 2026", title: "", programmeId: "" });
    setAttachment(null);
  }

  async function handleProgrammeHeadApprove(id: string) {
    await approveByProgrammeHead.mutateAsync({ id, approvedBy: user?.name ?? "Programme Head" });
    toast({ title: "Plan approved", description: "Forwarded to the Vice-Chancellor for approval.", kind: "success" });
  }

  async function handleVcApprove(id: string) {
    await approveByVc.mutateAsync({ id, approvedBy: user?.name ?? "Vice-Chancellor" });
    toast({ title: "Plan approved", description: "Forwarded to CPU for evaluation, monitoring and validation.", kind: "success" });
  }

  if (isLoading) return <PageLoading />;

  const myOwnPlans = allPlans.filter((p) => p.unitHeadId === unitHeadIdFor(myUnit.id));
  const pendingForMyProgramme = myProgramme ? allPlans.filter((p) => p.status === "pending_programme_head" && p.programmeId === myProgramme.id) : [];
  const pendingForVc = allPlans.filter((p) => p.status === "pending_vc");
  const pendingForCpu = allPlans.filter((p) => p.status === "pending_cpu");

  const filteredForOverview = allPlans
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .filter((p) => programmeFilter === "all" || p.programmeId === programmeFilter);
  const validatedPlans = filteredForOverview.filter((p) => p.status === "validated");
  const rejectedPlans = filteredForOverview.filter((p) => p.status === "rejected");

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Appraisal", "Operational plans"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Operational plans</h1>
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Every Unit, Department, Faculty, and Regional Campus follows the same protocol: submit to your Programme
          Head for approval → Programme Head sends to the Vice-Chancellor for approval → CPU evaluates, monitors,
          and gives final approval and validation against budget and feasibility. Every submission is archived
          immediately, and every stage — submission, review, rejection, and validation — is timestamped.
        </p>
      </div>

      {user?.role === "unit_head" && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Submit a new operational plan</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Title" error={errors.title?.message}>
              <Input placeholder="e.g. Infrastructure Operational Plan" {...register("title")} error={!!errors.title} />
            </FormField>
            <FormField label="Period" error={errors.period?.message}>
              <Input {...register("period")} error={!!errors.period} />
            </FormField>
            <FormField label="Programme" error={errors.programmeId?.message}>
              <Controller name="programmeId" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
          </div>
          <FormField label="Attached document" hint="Upload the annual plan document">
            <FileAttachmentField file={attachment} onChange={setAttachment} required />
          </FormField>
          <div className="flex justify-end"><Button type="submit" disabled={isSubmitting}><Plus size={14} /> Submit to Programme Head</Button></div>
        </form>
      )}

      {user?.role === "unit_head" && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Your submissions</p>
          {myOwnPlans.length === 0 ? <EmptyState title="No plans submitted yet" /> : (
            <div className="space-y-3">
              {myOwnPlans.map((p) => (
                <PlanCard key={p.id} plan={p} footer={p.status === "rejected" ? <div className="mt-3"><ResubmitButton plan={p} /></div> : undefined} />
              ))}
            </div>
          )}
        </div>
      )}

      {user?.role === "programme_head" && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Pending your approval ({pendingForMyProgramme.length})</p>
          {pendingForMyProgramme.length === 0 ? <EmptyState title="Nothing awaiting approval" /> : (
            <div className="space-y-3">
              {pendingForMyProgramme.map((p) => (
                <ApprovalRow key={p.id} plan={p} stage="programme_head" actionLabel="Approve & forward to VC" onApprove={() => handleProgrammeHeadApprove(p.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {user?.role === "vc" && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Pending your approval ({pendingForVc.length})</p>
          {pendingForVc.length === 0 ? <EmptyState title="Nothing awaiting approval" /> : (
            <div className="space-y-3">
              {pendingForVc.map((p) => (
                <ApprovalRow key={p.id} plan={p} stage="vc" actionLabel="Approve & forward to CPU" onApprove={() => handleVcApprove(p.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {(user?.role === "cpu" || user?.role === "ict") && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Pending your validation ({pendingForCpu.length})</p>
          {pendingForCpu.length === 0 ? <EmptyState title="Nothing awaiting validation" /> : (
            <div className="space-y-3">
              {pendingForCpu.map((p) => <PlanCard key={p.id} plan={p} footer={<CpuValidationForm plan={p} />} />)}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Validated operational plans</p>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Plans that have completed the full chain — Programme Head, VC, and CPU budget/feasibility validation.</p>
          </div>
          <div className="flex gap-2">
            <Select value={programmeFilter} onValueChange={setProgrammeFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All programmes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All programmes</SelectItem>
                {programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="validated">Validated</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {validatedPlans.length === 0 ? <EmptyState title="No validated plans match these filters" /> : (
          <div className="space-y-3">{validatedPlans.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
        )}
      </div>

      {rejectedPlans.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Rejected plans</p>
          <div className="space-y-3">{rejectedPlans.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
        </div>
      )}
    </div>
  );
}
