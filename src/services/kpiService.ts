import { latency } from "./mockUtils";
import { kpis as seedKpis } from "@/data/kpis";
import { settingsService } from "./settingsService";
import { ragFor } from "@/utils/ragStatus";
import { loadStore, saveStore } from "@/utils/persistedStore";
import { auditService } from "./auditService";
import type { Kpi, WorkflowStatus } from "@/types/kpi";

const KEY = "zou_irbm_store_kpis";
let store: Kpi[] = loadStore(KEY, seedKpis);

function persist() {
  saveStore(KEY, store);
}

export interface KpiFilters { programmeId?: string; subProgrammeId?: string; unitId?: string; status?: string; workflow?: string }

// Recomputes each KPI's RAG status from the live, configurable thresholds
// rather than trusting a value baked in at seed time — this is what makes
// the Settings -> RAG thresholds page actually do something.
function withLiveStatus(kpi: Kpi): Kpi {
  const thresholds = settingsService.getThresholdsSync();
  return { ...kpi, status: ragFor(kpi.actual, kpi.target, kpi.baseline, thresholds) };
}

export const kpiService = {
  list: (filters?: KpiFilters): Promise<Kpi[]> => {
    let result = store.map(withLiveStatus);
    if (filters?.programmeId) result = result.filter((k) => k.programmeId === filters.programmeId);
    if (filters?.subProgrammeId) result = result.filter((k) => k.subProgrammeId === filters.subProgrammeId);
    if (filters?.unitId) result = result.filter((k) => k.unitId === filters.unitId);
    if (filters?.status) result = result.filter((k) => k.status === filters.status);
    if (filters?.workflow) result = result.filter((k) => k.workflow === filters.workflow);
    return latency(result);
  },

  getById: (id: string): Promise<Kpi | undefined> => {
    const found = store.find((k) => k.id === id);
    return latency(found ? withLiveStatus(found) : undefined);
  },

  create: (payload: Omit<Kpi, "id" | "status" | "trend" | "workflow" | "lastUpdated">): Promise<Kpi> => {
    const newKpi: Kpi = {
      ...payload,
      id: `k${String(store.length + 1).padStart(2, "0")}`,
      status: "off-track",
      trend: [payload.baseline, payload.baseline, payload.baseline, payload.baseline, payload.baseline, payload.baseline],
      workflow: "draft",
      lastUpdated: new Date().toISOString().slice(0, 10),
    };
    store = [...store, newKpi];
    persist();
    auditService.append({ user: payload.owner, role: "KPI Owner", action: "created", module: "KPI Management", record: newKpi.name, previousValue: null, newValue: "draft" });
    return latency(withLiveStatus(newKpi));
  },

  update: (id: string, changes: Partial<Kpi>): Promise<Kpi> => {
    store = store.map((k) => (k.id === id ? { ...k, ...changes, lastUpdated: new Date().toISOString().slice(0, 10) } : k));
    persist();
    return latency(withLiveStatus(store.find((k) => k.id === id)!));
  },

  setWorkflow: (id: string, workflow: WorkflowStatus, actor = "Corporate Planning Unit"): Promise<Kpi> => {
    const kpi = store.find((k) => k.id === id);
    const result = kpiService.update(id, { workflow });
    if (kpi) auditService.append({ user: actor, role: "CPU", action: workflow === "approved" ? "approved" : workflow === "rejected" ? "rejected" : "edited", module: "KPI Validation", record: kpi.name, previousValue: kpi.workflow, newValue: workflow });
    return result;
  },

  override: (id: string, overrideValue: number, reason: string, user: string): Promise<Kpi> => {
    const kpi = store.find((k) => k.id === id)!;
    const result = kpiService.update(id, {
      actual: overrideValue,
      override: { systemValue: kpi.actual, overrideValue, reason, user, timestamp: new Date().toISOString() },
    });
    auditService.append({ user, role: "CPU", action: "overridden", module: "Manual Override", record: kpi.name, previousValue: String(kpi.actual), newValue: String(overrideValue), reason });
    return result;
  },
};
