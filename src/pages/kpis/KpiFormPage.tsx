import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { GitBranch } from "lucide-react";
import { kpiSchema, type KpiFormValues } from "@/forms/kpiSchema";
import type { Resolver } from "react-hook-form";
import { useKpi, useCreateKpi, useUpdateKpi } from "@/hooks/useKpis";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useSubProgrammes } from "@/hooks/useSubProgrammes";
import { useUnits } from "@/hooks/useUnits";
import { useAuth } from "@/context/AuthContext";
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
  const { user } = useAuth();

  const [searchParams] = useSearchParams();
  const cascadeFromId = searchParams.get("cascadeFrom");

  const { data: existing } = useKpi(isEdit ? id : undefined);
  const { data: parentKpi } = useKpi(cascadeFromId ?? undefined);
  const { data: programmes = [] } = useProgrammes();
  const createKpi = useCreateKpi();
  const updateKpi = useUpdateKpi();

  const { register, handleSubmit, control, watch, reset, formState: { errors, isSubmitting } } = useForm<KpiFormValues>({
    resolver: zodResolver(kpiSchema) as Resolver<KpiFormValues>,
    defaultValues: { type: "output", unit: "%", reportingFrequency: "monthly", programmeId: "", subProgrammeId: "", unitId: "", linkedProgrammeId: "" },
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
        linkedProgrammeId: existing.linkedProgrammeId ?? "",
        baseline: existing.baseline, target: existing.target, reportingFrequency: existing.reportingFrequency,
        dataSource: existing.dataSource, owner: existing.owner,
        q1Target: byQuarter.Q1, q2Target: byQuarter.Q2, q3Target: byQuarter.Q3, q4Target: byQuarter.Q4,
      });
    }
  }, [existing, reset]);

  // Q16: "Work cascades down" — a Programme Head breaking a Programme-level
  // target into a Sub-programme's target, or a Sub-programme Head breaking
  // theirs into a Unit's target. The Programme is always locked to the
  // parent's; the Sub-programme is additionally locked when a Sub-programme
  // Head is the one cascading (they're picking a new Unit, not a new
  // Sub-programme). Everything else pre-fills from the parent as a starting
  // point the person doing the cascade can adjust.
  useEffect(() => {
    if (parentKpi && !isEdit) {
      reset({
        name: parentKpi.name, type: parentKpi.type, unit: parentKpi.unit,
        programmeId: parentKpi.programmeId,
        subProgrammeId: user?.role === "subprogramme_head" ? parentKpi.subProgrammeId : "",
        unitId: "", linkedProgrammeId: "",
        baseline: parentKpi.baseline, target: Math.max(1, Math.round(parentKpi.target / 3)),
        reportingFrequency: parentKpi.reportingFrequency, dataSource: parentKpi.dataSource, owner: "",
      });
    }
  }, [parentKpi, isEdit, user, reset]);

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
      const linkedProgrammeId = values.linkedProgrammeId || undefined;
      if (isEdit && id) {
        await updateKpi.mutateAsync({ id, changes: { ...values, linkedProgrammeId, milestones } });
        toast({ title: "KPI updated", kind: "success" });
        navigate(`/kpis/${id}`);
      } else {
        const created = await createKpi.mutateAsync({
          ...values, linkedProgrammeId, actual: values.baseline, milestones,
          parentKpiId: cascadeFromId ?? undefined,
        });
        toast({ title: cascadeFromId ? "Target cascaded" : "KPI created", description: "Saved as a draft.", kind: "success" });
        navigate(`/kpis/${created.id}`);
      }
    } catch {
      toast({ title: "Something went wrong", kind: "error" });
    }
  }

  const linkableProgrammes = programmes.filter((p) => p.id !== programmeId);

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Breadcrumbs items={["Performance", "KPI management", isEdit ? "Edit KPI" : "New KPI"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">{isEdit ? "Edit KPI" : cascadeFromId ? "Cascade target" : "Create KPI"}</h1>
      </div>

      {parentKpi && !isEdit && (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3.5 dark:border-indigo-900 dark:bg-indigo-950">
          <GitBranch size={15} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <p className="text-xs leading-relaxed text-indigo-700 dark:text-indigo-300">
            Cascading from <span className="font-medium">{parentKpi.name}</span> (target {parentKpi.target}{parentKpi.unit === "%" ? "%" : ""}).
            The Programme is locked to match; pick which {user?.role === "subprogramme_head" ? "Unit" : "Sub-programme"} this breakdown is for.
          </p>
        </div>
      )}

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
              <Select value={field.value} onValueChange={(v) => { field.onChange(v); }} disabled={!!cascadeFromId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </FormField>
          <FormField label="Sub-programme" error={errors.subProgrammeId?.message}>
            <Controller name="subProgrammeId" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!programmeId || (!!cascadeFromId && user?.role === "subprogramme_head")}>
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

        <FormField label="Also linked to (optional)" error={errors.linkedProgrammeId?.message} hint="Only for the small number of KPIs that are genuinely cross-cutting between two Programmes">
          <Controller name="linkedProgrammeId" control={control} render={({ field }) => (
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {linkableProgrammes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )} />
        </FormField>

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
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : isEdit ? "Save changes" : cascadeFromId ? "Create cascaded target" : "Create KPI"}</Button>
        </div>
      </form>
    </div>
  );
}
