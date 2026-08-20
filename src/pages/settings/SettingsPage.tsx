import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { overrideSchema, type OverrideFormValues } from "@/forms/overrideSchema";
import type { Resolver } from "react-hook-form";
import { useKpis, useOverrideKpi } from "@/hooks/useKpis";
import { useThresholds, useUpdateThresholds } from "@/hooks/useSettings";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Sun, Moon } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
      <div><p className="text-sm text-slate-700 dark:text-slate-300">{label}</p>{hint && <p className="text-xs text-slate-400">{hint}</p>}</div>
      {children}
    </div>
  );
}

function Toggle({ defaultChecked }: { defaultChecked?: boolean }) {
  const [on, setOn] = useState(!!defaultChecked);
  return (
    <button onClick={() => setOn(!on)} className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-slate-200"}`} aria-pressed={on}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "left-4.5" : "left-0.5"}`} />
    </button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
      <button
        onClick={() => setTheme("light")}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${theme === "light" ? "bg-indigo-600 text-white" : "text-slate-500 dark:text-slate-400"}`}
      >
        <Sun size={13} /> Light
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${theme === "dark" ? "bg-indigo-600 text-white" : "text-slate-500 dark:text-slate-400"}`}
      >
        <Moon size={13} /> Dark
      </button>
    </div>
  );
}

function RagThresholdsPanel() {
  const { toast } = useToast();
  const { data: thresholds } = useThresholds();
  const update = useUpdateThresholds();
  const [onTrack, setOnTrack] = useState(85);
  const [atRisk, setAtRisk] = useState(60);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (thresholds && !hydrated) {
      setOnTrack(thresholds.onTrack);
      setAtRisk(thresholds.atRisk);
      setHydrated(true);
    }
  }, [thresholds, hydrated]);

  async function handleSave() {
    if (atRisk >= onTrack) {
      toast({ title: "Invalid thresholds", description: "The at-risk cutoff must be lower than the on-track cutoff.", kind: "error" });
      return;
    }
    await update.mutateAsync({ onTrack, atRisk });
    toast({ title: "Thresholds saved", description: "Every KPI's RAG status has been recalculated.", kind: "success" });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        ZOU has no standard RAG thresholds yet — these are configurable defaults, not official values, and should be confirmed with the Corporate Planning Unit before go-live.
      </p>
      <Field label="On track threshold" hint="Minimum % progress toward target to show green">
        <Input type="number" value={onTrack} onChange={(e) => setOnTrack(Number(e.target.value))} className="w-20 text-right" />
      </Field>
      <Field label="At risk threshold" hint="Minimum % progress toward target to show amber">
        <Input type="number" value={atRisk} onChange={(e) => setAtRisk(Number(e.target.value))} className="w-20 text-right" />
      </Field>
      <div className="flex justify-end pt-3">
        <Button size="sm" onClick={handleSave} disabled={update.isPending}>{update.isPending ? "Saving…" : "Save thresholds"}</Button>
      </div>
    </div>
  );
}

function ManualOverridePanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: kpis = [] } = useKpis();
  const override = useOverrideKpi();
  const [kpiId, setKpiId] = useState<string>("");
  const selectedKpi = kpis.find((k) => k.id === kpiId);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<OverrideFormValues>({ resolver: zodResolver(overrideSchema) as Resolver<OverrideFormValues> });

  async function onSubmit(values: OverrideFormValues) {
    if (!selectedKpi) return;
    await override.mutateAsync({ id: selectedKpi.id, value: values.overrideValue, reason: values.reason, user: user?.name ?? "Corporate Planning Unit" });
    toast({ title: "Override applied", description: "The system-calculated value remains visible in the KPI's history.", kind: "success" });
    reset();
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">Manual overrides never delete the system-calculated value — it stays visible alongside the override for audit purposes.</p>

      <FormField label="KPI">
        <Select value={kpiId} onValueChange={setKpiId}>
          <SelectTrigger><SelectValue placeholder="Select a KPI to override" /></SelectTrigger>
          <SelectContent>{kpis.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>

      {selectedKpi && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div><p className="text-xs text-slate-400">System value</p><p className="text-base font-medium text-slate-700">{selectedKpi.actual}</p></div>
            {selectedKpi.override && (
              <>
                <div><p className="text-xs text-slate-400">Current override</p><p className="text-base font-medium text-slate-900">{selectedKpi.override.overrideValue}</p></div>
                <div><p className="text-xs text-slate-400">Overridden by</p><p className="text-sm text-slate-700">{selectedKpi.override.user}</p></div>
              </>
            )}
          </div>

          <FormField label="Override value" error={errors.overrideValue?.message}>
            <Input type="number" step="any" {...register("overrideValue")} error={!!errors.overrideValue} />
          </FormField>
          <FormField label="Override reason" error={errors.reason?.message} hint="Required — explain why the system value doesn't reflect reality">
            <Textarea rows={3} {...register("reason")} />
          </FormField>

          <div className="flex justify-end"><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Applying…" : "Apply override"}</Button></div>
        </form>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState("thresholds");

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Administration", "System settings"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">System settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">RAG thresholds, reporting cadence, notifications and manual overrides</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="thresholds">RAG thresholds</TabsTrigger>
          <TabsTrigger value="cadence">Reporting cadence</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="override">Manual override</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>

        <TabsContent value="thresholds">
          <RagThresholdsPanel />
        </TabsContent>

        <TabsContent value="cadence">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <Field label="Base submission cadence" hint="How often Sub-programme Reps submit actuals">
              <Select defaultValue="monthly"><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem></SelectContent></Select>
            </Field>
            <Field label="Submission due day" hint="Day of the following month a submission is considered late">
              <Input type="number" defaultValue={5} className="w-20 text-right" />
            </Field>
            <Field label="Auto-aggregate to quarterly / bi-annual / annual" hint="Roll up monthly submissions automatically">
              <Toggle defaultChecked />
            </Field>
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <Field label="Email escalation" hint="Send escalation emails following the org hierarchy"><Toggle defaultChecked /></Field>
            <Field label="Late submission reminders" hint="Notify Sub-programme Reps 2 days before the due date"><Toggle defaultChecked /></Field>
            <Field label="Weekly digest to Council & VC" hint="Summary of RAG movement across all Programmes"><Toggle /></Field>
          </div>
        </TabsContent>

        <TabsContent value="override"><ManualOverridePanel /></TabsContent>

        <TabsContent value="general">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <Field label="Institution name"><Input defaultValue="Zimbabwe Open University" className="w-56" /></Field>
            <Field label="Current strategic plan cycle"><Input defaultValue="2024–2029" className="w-32" /></Field>
            <Field label="Real-time dashboard refresh" hint="Data latency tolerance for the MIS layer">
              <Select defaultValue="realtime"><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="realtime">Real-time</SelectItem><SelectItem value="5min">Every 5 minutes</SelectItem><SelectItem value="hourly">Hourly</SelectItem></SelectContent></Select>
            </Field>
            <Field label="Appearance" hint="Switch between light and dark theme for the whole dashboard">
              <ThemeToggle />
            </Field>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
