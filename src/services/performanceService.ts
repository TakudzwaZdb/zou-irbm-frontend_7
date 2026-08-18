import { latency } from "./mockUtils";
import { submissions as seedSubmissions } from "@/data/submissions";
import type { PerformanceSubmission, WorkflowStatus } from "@/types/kpi";

let store: PerformanceSubmission[] = [...seedSubmissions];

export const performanceService = {
  list: (status?: WorkflowStatus): Promise<PerformanceSubmission[]> =>
    latency(status ? store.filter((s) => s.status === status) : store),

  submit: (payload: Omit<PerformanceSubmission, "id" | "achievementPct" | "variance" | "status" | "submittedAt" | "late">): Promise<PerformanceSubmission> => {
    const newSub: PerformanceSubmission = {
      ...payload,
      id: `sub-${Date.now()}`,
      achievementPct: Math.round((payload.actual / payload.target) * 100),
      variance: Math.round((payload.actual - payload.target) * 10) / 10,
      status: "submitted",
      submittedAt: new Date().toISOString().slice(0, 10),
      late: false,
    };
    store = [newSub, ...store];
    return latency(newSub);
  },

  decide: (id: string, decision: "approved" | "rejected" | "returned", comment?: string): Promise<PerformanceSubmission> => {
    store = store.map((s) => (s.id === id ? { ...s, status: decision, reviewComment: comment } : s));
    return latency(store.find((s) => s.id === id)!);
  },
};
