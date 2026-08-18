import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { Archive, CheckCircle2, Clock, Plus } from "lucide-react";
import { operationalPlanSchema, type OperationalPlanFormValues } from "@/forms/operationalPlanSchema";
import { useOperationalPlans, useSubmitOperationalPlan, useApproveOperationalPlan } from "@/hooks/useOperationalPlans";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useAuth } from "@/context/AuthContext";
import { orgUnits } from "@/data/organisation";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageLoading } from "@/components/shared/PageLoading";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { OperationalPlan } from "@/types/appraisal";

function PlanCard({ plan, footer }: { plan: OperationalPlan; footer?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{plan.title}</p>
          <p className="text-xs text-slate-400">{plan.unitName} · {plan.period} · Submitted by {plan.unitHeadName}</p>
        </div>
        <div className="flex items-center gap-2">
          {plan.archived && <Badge variant="default"><Archive size={11} /> Archived</Badge>}
          {plan.status === "approved" ? (
            <Badge variant="success"><CheckCircle2 size={11} /> Approved by {plan.vcApprovedBy}</Badge>
          ) : (
            <Badge variant="warning"><Clock size={11} /> Pending VC approval</Badge>
          )}
        </div>
      </div>
      {plan.status === "approved" && (
        <p className="mt-1.5 text-[11px] text-slate-400">Approved {plan.vcApprovedAt} · forwarded to CPU for monitoring and evaluation</p>
      )}
      {footer}
    </div>
  );
}

export default function OperationalPlansPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: allPlans = [], isLoading } = useOperationalPlans();
  const { data: programmes = [] } = useProgrammes();
  const submit = useSubmitOperationalPlan();
  const approve = useApproveOperationalPlan();
  const myUnit = orgUnits.find((u) => u.head === user?.name) ?? orgUnits[0];

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<OperationalPlanFormValues>({
    resolver: zodResolver(operationalPlanSchema) as Resolver<OperationalPlanFormValues>,
    defaultValues: { period: "Q3 2026" },
  });

  async function onSubmit(values: OperationalPlanFormValues) {
    await submit.mutateAsync({ unitHeadId: `head-${myUnit.id}`, unitHeadName: user?.name ?? myUnit.head, unitId: myUnit.id, unitName: myUnit.name, ...values });
    toast({ title: "Operational plan submitted", description: "Sent directly to the Vice-Chancellor for approval; a copy has been archived.", kind: "success" });
    reset({ period: "Q3 2026", title: "", programmeId: "" });
  }

  async function handleApprove(id: string) {
    await approve.mutateAsync({ id, approvedBy: user?.name ?? "Vice-Chancellor" });
    toast({ title: "Plan approved", description: "Automatically forwarded to CPU for monitoring and evaluation.", kind: "success" });
  }

  if (isLoading) return <PageLoading />;

  const pendingForVc = allPlans.filter((p) => p.status === "pending_vc");
  const myOwnPlans = allPlans.filter((p) => p.unitHeadId === `head-${myUnit.id}`);
  const approvedPlans = allPlans.filter((p) => p.status === "approved");

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Appraisal", "Operational plans"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Operational plans</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every Unit Head — Department, Unit, Faculty Dean, or Regional Campus Director — submits directly to the
          Vice-Chancellor. Approval automatically forwards the plan to CPU for monitoring and evaluation. Every
          submission is archived immediately on submission.
        </p>
      </div>

      {user?.role === "unit_head" && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
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
          <div className="flex justify-end"><Button type="submit" disabled={isSubmitting}><Plus size={14} /> Submit to VC</Button></div>
        </form>
      )}

      {user?.role === "unit_head" && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Your submissions</p>
          {myOwnPlans.length === 0 ? <EmptyState title="No plans submitted yet" /> : (
            <div className="space-y-3">{myOwnPlans.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
          )}
        </div>
      )}

      {user?.role === "vc" && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Pending your approval ({pendingForVc.length})</p>
          {pendingForVc.length === 0 ? <EmptyState title="Nothing awaiting approval" /> : (
            <div className="space-y-3">
              {pendingForVc.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={p}
                  footer={
                    <div className="mt-3">
                      <Button size="sm" onClick={() => handleApprove(p.id)}><CheckCircle2 size={13} /> Approve &amp; forward to CPU</Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Approved operational plans</p>
        <p className="mb-3 text-xs text-slate-400">Only plans the Vice-Chancellor has approved appear here — these are the plans CPU monitors and evaluates.</p>
        {approvedPlans.length === 0 ? <EmptyState title="No approved plans yet" /> : (
          <div className="space-y-3">{approvedPlans.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
        )}
      </div>
    </div>
  );
}
