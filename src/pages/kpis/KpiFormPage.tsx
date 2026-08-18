import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { kpiSchema, type KpiFormValues } from "@/forms/kpiSchema";
import type { Resolver } from "react-hook-form";
import { useKpi, useCreateKpi, useUpdateKpi } from "@/hooks/useKpis";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useSubProgrammes } from "@/hooks/useSubProgrammes";
import { useUnits } from "@/hooks/useUnits";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

export default function KpiFormPage() {
  const { id } = useParams();
  const isEdit = !!id && id !== "new";
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: existing } = useKpi(isEdit ? id : undefined);
  const { data: programmes = [] } = useProgrammes();
  const createKpi = useCreateKpi();
  const updateKpi = useUpdateKpi();

  const { register, handleSubmit, control, watch, reset, formState: { errors, isSubmitting } } = useForm<KpiFormValues>({
    resolver: zodResolver(kpiSchema) as Resolver<KpiFormValues>,
    defaultValues: { type: "output", unit: "%", reportingFrequency: "monthly", programmeId: "", subProgrammeId: "", unitId: "" },
  });

  const programmeId = watch("programmeId");
  const subProgrammeId = watch("subProgrammeId");
  const { data: subs = [] } = useSubProgrammes(programmeId || undefined);
  const { data: units = [] } = useUnits(subProgrammeId || undefined);

  useEffect(() => {
    if (existing) {
      const byQuarter = Object.fromEntries(existing.milestones.map((m) => [m.quarter, m.target]));
      reset({
        name: existing.name, type: existing.type, unit: existing.unit,
        programmeId: existing.programmeId, subProgrammeId: existing.subProgrammeId, unitId: existing.unitId,
        baseline: existing.baseline, target: existing.target, reportingFrequency: existing.reportingFrequency,
        dataSource: existing.dataSource, owner: existing.owner,
        q1Target: byQuarter.Q1, q2Target: byQuarter.Q2, q3Target: byQuarter.Q3, q4Target: byQuarter.Q4,
      });
    }
  }, [existing, reset]);

  function buildMilestones(values: KpiFormValues) {
    const fallback = Math.round(values.target / 4);
    return ([
      { quarter: "Q1" as const, value: values.q1Target },
      { quarter: "Q2" as const, value: values.q2Target },
      { quarter: "Q3" as const, value: values.q3Target },
      { quarter: "Q4" as const, value: values.q4Target },
    ]).map(({ quarter, value }) => ({
      quarter,
      target: value ?? fallback,
      actual: existing?.milestones.find((m) => m.quarter === quarter)?.actual ?? null,
    }));
  }

  async function onSubmit(values: KpiFormValues) {
    try {
      const milestones = buildMilestones(values);
      if (isEdit && id) {
        await updateKpi.mutateAsync({ id, changes: { ...values, milestones } });
        toast({ title: "KPI updated", kind: "success" });
        navigate(`/kpis/${id}`);
      } else {
        const created = await createKpi.mutateAsync({ ...values, actual: values.baseline, milestones });
        toast({ title: "KPI created", description: "Saved as a draft.", kind: "success" });
        navigate(`/kpis/${created.id}`);
      }
    } catch {
      toast({ title: "Something went wrong", kind: "error" });
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Breadcrumbs items={["Performance", "KPI management", isEdit ? "Edit KPI" : "New KPI"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">{isEdit ? "Edit KPI" : "Create KPI"}</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <FormField label="KPI name" error={errors.name?.message}>
          <Input placeholder="e.g. Student pass rate" {...register("name")} error={!!errors.name} />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Indicator type" error={errors.type?.message}>
            <Controller name="type" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="output">Output</SelectItem><SelectItem value="outcome">Outcome</SelectItem></SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Measurement unit" error={errors.unit?.message}>
            <Controller name="unit" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="%">Percentage (%)</SelectItem><SelectItem value="count">Count</SelectItem><SelectItem value="number">Number / currency</SelectItem></SelectContent>
              </Select>
            )} />
          </FormField>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Programme" error={errors.programmeId?.message}>
            <Controller name="programmeId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={(v) => { field.onChange(v); }}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Sub-programme" error={errors.subProgrammeId?.message}>
            <Controller name="subProgrammeId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!programmeId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Responsible unit" error={errors.unitId?.message}>
            <Controller name="unitId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!subProgrammeId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Baseline" error={errors.baseline?.message} hint="Prior year actual performance">
            <Input type="number" step="any" {...register("baseline")} error={!!errors.baseline} />
          </FormField>
          <FormField label="Annual target" error={errors.target?.message}>
            <Input type="number" step="any" {...register("target")} error={!!errors.target} />
          </FormField>
        </div>

        <FormField label="Quarterly milestone targets" hint="Leave a field blank to split the annual target evenly across that quarter">
          <div className="grid grid-cols-4 gap-2">
            <Input type="number" step="any" placeholder="Q1" {...register("q1Target")} error={!!errors.q1Target} />
            <Input type="number" step="any" placeholder="Q2" {...register("q2Target")} error={!!errors.q2Target} />
            <Input type="number" step="any" placeholder="Q3" {...register("q3Target")} error={!!errors.q3Target} />
            <Input type="number" step="any" placeholder="Q4" {...register("q4Target")} error={!!errors.q4Target} />
          </div>
        </FormField>

        <FormField label="Reporting frequency" error={errors.reportingFrequency?.message}>
          <Controller name="reportingFrequency" control={control} render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="bi-annual">Bi-annual</SelectItem><SelectItem value="annual">Annual</SelectItem>
              </SelectContent>
            </Select>
          )} />
        </FormField>

        <FormField label="Data source" error={errors.dataSource?.message} hint="Where this figure is pulled from">
          <Input placeholder="e.g. HR information system" {...register("dataSource")} error={!!errors.dataSource} />
        </FormField>

        <FormField label="Responsible owner" error={errors.owner?.message}>
          <Input placeholder="e.g. K. Moyo" {...register("owner")} error={!!errors.owner} />
        </FormField>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create KPI"}</Button>
        </div>
      </form>
    </div>
  );
}
