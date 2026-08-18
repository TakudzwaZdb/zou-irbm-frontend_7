import { latency } from "./mockUtils";
import { unitHeadAppraisals as seed } from "@/data/unitHeadAppraisals";
import type { UnitHeadAppraisal, AppraisalStatus } from "@/types/appraisal";

let store: UnitHeadAppraisal[] = [...seed];

export const unitHeadAppraisalService = {
  list: (filters?: { unitId?: string; status?: AppraisalStatus }): Promise<UnitHeadAppraisal[]> => {
    let result = store;
    if (filters?.unitId) result = result.filter((a) => a.unitId === filters.unitId);
    if (filters?.status) result = result.filter((a) => a.status === filters.status);
    return latency(result);
  },

  submit: (payload: Pick<UnitHeadAppraisal, "unitHeadId" | "unitHeadName" | "unitId" | "unitName" | "recipient" | "weekEnding" | "jobSummary">): Promise<UnitHeadAppraisal> => {
    const created: UnitHeadAppraisal = { ...payload, id: `uha-${Date.now()}`, score: null, status: "submitted", submittedAt: new Date().toISOString().slice(0, 10) };
    store = [created, ...store];
    return latency(created);
  },

  // Administration evaluates, then the report auto-forwards to CPU in the same action.
  evaluate: (id: string, score: number, comment: string, evaluatedBy: string): Promise<UnitHeadAppraisal> => {
    const now = new Date().toISOString();
    store = store.map((a) => (a.id === id ? { ...a, score, status: "forwarded_to_cpu" as AppraisalStatus, evaluationComment: comment, evaluatedBy, forwardedToCpuAt: now } : a));
    return latency(store.find((a) => a.id === id)!);
  },
};
