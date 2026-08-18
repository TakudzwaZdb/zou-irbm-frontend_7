import { latency } from "./mockUtils";
import { kpis as seedKpis } from "@/data/kpis";
import { settingsService } from "./settingsService";
import { ragFor } from "@/utils/ragStatus";
import type { Kpi, WorkflowStatus } from "@/types/kpi";

let store: Kpi[] = [...seedKpis];

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
    return latency(withLiveStatus(newKpi));
  },

  update: (id: string, changes: Partial<Kpi>): Promise<Kpi> => {
    store = store.map((k) => (k.id === id ? { ...k, ...changes, lastUpdated: new Date().toISOString().slice(0, 10) } : k));
    return latency(withLiveStatus(store.find((k) => k.id === id)!));
  },

  setWorkflow: (id: string, workflow: WorkflowStatus): Promise<Kpi> => kpiService.update(id, { workflow }),

  override: (id: string, overrideValue: number, reason: string, user: string): Promise<Kpi> => {
    const kpi = store.find((k) => k.id === id)!;
    return kpiService.update(id, {
      actual: overrideValue,
      override: { systemValue: kpi.actual, overrideValue, reason, user, timestamp: new Date().toISOString() },
    });
  },
};
