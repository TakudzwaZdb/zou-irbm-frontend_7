import { latency } from "./mockUtils";
import { staffAppraisals as seed } from "@/data/staffAppraisals";
import type { StaffAppraisal, AppraisalStatus } from "@/types/appraisal";

let store: StaffAppraisal[] = [...seed];

export const staffAppraisalService = {
  list: (filters?: { unitId?: string; recipientUnitId?: string; status?: AppraisalStatus; staffId?: string }): Promise<StaffAppraisal[]> => {
    let result = store;
    if (filters?.unitId) result = result.filter((a) => a.unitId === filters.unitId);
    if (filters?.recipientUnitId) result = result.filter((a) => a.recipientUnitId === filters.recipientUnitId);
    if (filters?.status) result = result.filter((a) => a.status === filters.status);
    if (filters?.staffId) result = result.filter((a) => a.staffId === filters.staffId);
    return latency(result);
  },

  submit: (payload: Pick<StaffAppraisal, "staffId" | "staffName" | "unitId" | "unitName" | "recipientUnitId" | "recipientUnitName" | "recipientHead" | "weekEnding" | "activitySummary">): Promise<StaffAppraisal> => {
    const created: StaffAppraisal = { ...payload, id: `sa-${Date.now()}`, score: null, status: "submitted", submittedAt: new Date().toISOString().slice(0, 10) };
    store = [created, ...store];
    return latency(created);
  },

  appraise: (id: string, score: number, comment: string, appraisedBy: string): Promise<StaffAppraisal> => {
    store = store.map((a) => (a.id === id ? { ...a, score, status: "appraised" as AppraisalStatus, appraisalComment: comment, appraisedBy } : a));
    return latency(store.find((a) => a.id === id)!);
  },

  returnForCorrection: (id: string, comment: string): Promise<StaffAppraisal> => {
    store = store.map((a) => (a.id === id ? { ...a, status: "returned" as AppraisalStatus, appraisalComment: comment } : a));
    return latency(store.find((a) => a.id === id)!);
  },
};
