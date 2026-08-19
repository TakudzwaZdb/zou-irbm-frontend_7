import { latency } from "./mockUtils";
import { staffAppraisals as seed } from "@/data/staffAppraisals";
import { loadStore, saveStore } from "@/utils/persistedStore";
import { auditService } from "./auditService";
import type { StaffAppraisal, AppraisalStatus } from "@/types/appraisal";

const KEY = "zou_irbm_store_staffAppraisals";
let store: StaffAppraisal[] = loadStore(KEY, seed);

function persist() {
  saveStore(KEY, store);
}

export const staffAppraisalService = {
  list: (filters?: { unitId?: string; recipientUnitId?: string; status?: AppraisalStatus; staffId?: string }): Promise<StaffAppraisal[]> => {
    let result = store;
    if (filters?.unitId) result = result.filter((a) => a.unitId === filters.unitId);
    if (filters?.recipientUnitId) result = result.filter((a) => a.recipientUnitId === filters.recipientUnitId);
    if (filters?.status) result = result.filter((a) => a.status === filters.status);
    if (filters?.staffId) result = result.filter((a) => a.staffId === filters.staffId);
    return latency(result);
  },

  submit: (payload: Pick<StaffAppraisal, "staffId" | "staffName" | "unitId" | "unitName" | "recipientUnitId" | "recipientUnitName" | "recipientHead" | "weekEnding" | "activitySummary" | "attachmentName" | "attachmentFile">): Promise<StaffAppraisal> => {
    const now = new Date().toISOString().slice(0, 10);
    const created: StaffAppraisal = {
      ...payload, id: `sa-${Date.now()}`, score: null, status: "submitted", submittedAt: now,
      attachmentUploadedAt: payload.attachmentFile ? now : undefined,
    };
    store = [created, ...store];
    persist();
    auditService.append({ user: payload.staffName, role: "Operational Staff", action: "submitted", module: "Staff Appraisal", record: `Weekly report — ${payload.weekEnding}`, previousValue: null, newValue: "submitted" });
    return latency(created);
  },

  appraise: (id: string, score: number, comment: string, appraisedBy: string): Promise<StaffAppraisal> => {
    const now = new Date().toISOString().slice(0, 10);
    const report = store.find((a) => a.id === id);
    store = store.map((a) => (a.id === id ? { ...a, score, status: "appraised" as AppraisalStatus, appraisalComment: comment, appraisedBy, appraisedAt: now } : a));
    persist();
    if (report) auditService.append({ user: appraisedBy, role: "Unit Head", action: "approved", module: "Staff Appraisal", record: `${report.staffName} — ${report.weekEnding}`, previousValue: null, newValue: `${score}%`, reason: comment });
    return latency(store.find((a) => a.id === id)!);
  },

  returnForCorrection: (id: string, comment: string, returnedBy: string): Promise<StaffAppraisal> => {
    const now = new Date().toISOString().slice(0, 10);
    const report = store.find((a) => a.id === id);
    store = store.map((a) => (a.id === id ? { ...a, status: "returned" as AppraisalStatus, appraisalComment: comment, appraisedAt: now } : a));
    persist();
    if (report) auditService.append({ user: returnedBy, role: "Unit Head", action: "returned", module: "Staff Appraisal", record: `${report.staffName} — ${report.weekEnding}`, previousValue: null, newValue: null, reason: comment });
    return latency(store.find((a) => a.id === id)!);
  },

  // A Unit Head can send feedback to the sender at any time, independent of
  // scoring/appraising — this doesn't change the report's status.
  sendFeedback: (id: string, feedback: string, sentBy: string): Promise<StaffAppraisal> => {
    const now = new Date().toISOString().slice(0, 10);
    store = store.map((a) => (a.id === id ? { ...a, feedback, feedbackBy: sentBy, feedbackAt: now } : a));
    persist();
    return latency(store.find((a) => a.id === id)!);
  },
};
