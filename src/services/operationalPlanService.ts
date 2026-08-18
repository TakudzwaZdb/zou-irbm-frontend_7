import { latency } from "./mockUtils";
import { operationalPlans as seed } from "@/data/operationalPlans";
import type { OperationalPlan, OperationalPlanStatus } from "@/types/appraisal";

let store: OperationalPlan[] = [...seed];

// Every Unit Head — Department, Unit, Faculty Dean, or Regional Campus
// Director alike — submits directly to the Vice-Chancellor. VC approval is
// the single decision point; approving automatically forwards the plan to
// CPU for monitoring and evaluation, with no further stages in between.
export const operationalPlanService = {
  list: (filters?: { programmeId?: string; status?: OperationalPlanStatus; unitHeadId?: string }): Promise<OperationalPlan[]> => {
    let result = store;
    if (filters?.programmeId) result = result.filter((p) => p.programmeId === filters.programmeId);
    if (filters?.status) result = result.filter((p) => p.status === filters.status);
    if (filters?.unitHeadId) result = result.filter((p) => p.unitHeadId === filters.unitHeadId);
    return latency(result);
  },

  submit: (payload: Pick<OperationalPlan, "unitHeadId" | "unitHeadName" | "unitId" | "unitName" | "programmeId" | "title" | "period">): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    // A copy is archived immediately on submission, independent of VC's decision.
    const created: OperationalPlan = {
      ...payload, id: `op-${Date.now()}`, status: "pending_vc",
      archived: true, archivedAt: now, submittedAt: now,
    };
    store = [created, ...store];
    return latency(created);
  },

  // VC approval is the single action that both approves the plan and
  // forwards it to CPU for monitoring and evaluation.
  approve: (id: string, approvedBy: string): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    store = store.map((p) => (p.id === id ? { ...p, status: "approved" as OperationalPlanStatus, vcApprovedBy: approvedBy, vcApprovedAt: now } : p));
    return latency(store.find((p) => p.id === id)!);
  },
};
