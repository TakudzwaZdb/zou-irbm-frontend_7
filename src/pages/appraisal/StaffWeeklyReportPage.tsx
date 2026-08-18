import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { staffWeeklyReportSchema, type StaffWeeklyReportFormValues } from "@/forms/staffAppraisalSchema";
import { useStaffAppraisals, useSubmitStaffAppraisal } from "@/hooks/useStaffAppraisals";
import { useAuth } from "@/context/AuthContext";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
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

  const { data: myReports = [] } = useStaffAppraisals({ staffId: me.id });
  const submit = useSubmitStaffAppraisal();

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<StaffWeeklyReportFormValues>({
    resolver: zodResolver(staffWeeklyReportSchema) as Resolver<StaffWeeklyReportFormValues>,
    defaultValues: { weekEnding: "2026-08-17", recipientUnitId: me.unitId },
  });

  async function onSubmit(values: StaffWeeklyReportFormValues) {
    const recipient = orgUnits.find((u) => u.id === values.recipientUnitId)!;
    await submit.mutateAsync({
      staffId: me.id, staffName: me.name, unitId: me.unitId, unitName: unit?.name ?? "",
      recipientUnitId: recipient.id, recipientUnitName: recipient.name, recipientHead: recipient.head,
      weekEnding: values.weekEnding, activitySummary: values.activitySummary,
    });
    toast({ title: "Weekly report submitted", description: `Sent to ${recipient.head} for appraisal.`, kind: "success" });
    reset({ weekEnding: "2026-08-17", recipientUnitId: me.unitId, activitySummary: "" });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-5">
        <div>
          <Breadcrumbs items={["Appraisal", "Weekly job activity report"]} />
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Weekly job activity report</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{unit?.name} · choose who this report goes to for appraisal</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
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
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit for appraisal"}</Button>
          </div>
        </form>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900">Your appraisal history</p>
        <div className="space-y-2">
          {myReports.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-800">Week ending {r.weekEnding}</p>
                <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">{r.status.replace(/_/g, " ")}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Sent to {r.recipientHead} · {r.recipientUnitName}</p>
              <p className="mt-1 text-[11px] text-slate-400">{r.activitySummary}</p>
              {r.score !== null && <p className="mt-1.5 text-xs font-medium text-slate-700">Score: {r.score}%</p>}
              {r.appraisalComment && <p className="mt-1 rounded-md bg-slate-50 p-1.5 text-[11px] text-slate-500">{r.appraisalComment}</p>}
            </div>
          ))}
          {myReports.length === 0 && <p className="text-xs text-slate-400">No reports submitted yet.</p>}
        </div>
      </div>
    </div>
  );
}
