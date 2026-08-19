import { latency } from "./mockUtils";
import { unitHeadAppraisals as seed } from "@/data/unitHeadAppraisals";
import { loadStore, saveStore } from "@/utils/persistedStore";
import { auditService } from "./auditService";
import type { UnitHeadAppraisal, AppraisalStatus } from "@/types/appraisal";

const KEY = "zou_irbm_store_unitHeadAppraisals";
let store: UnitHeadAppraisal[] = loadStore(KEY, seed);

function persist() {
  saveStore(KEY, store);
}

export const unitHeadAppraisalService = {
  list: (filters?: { unitId?: string; status?: AppraisalStatus }): Promise<UnitHeadAppraisal[]> => {
    let result = store;
    if (filters?.unitId) result = result.filter((a) => a.unitId === filters.unitId);
    if (filters?.status) result = result.filter((a) => a.status === filters.status);
    return latency(result);
  },

  submit: (payload: Pick<UnitHeadAppraisal, "unitHeadId" | "unitHeadName" | "unitId" | "unitName" | "recipient" | "weekEnding" | "jobSummary" | "attachmentName" | "attachmentFile">): Promise<UnitHeadAppraisal> => {
    const now = new Date().toISOString().slice(0, 10);
    const created: UnitHeadAppraisal = {
      ...payload, id: `uha-${Date.now()}`, score: null, status: "submitted", submittedAt: now,
      attachmentUploadedAt: payload.attachmentFile ? now : undefined,
    };
    store = [created, ...store];
    persist();
    auditService.append({ user: payload.unitHeadName, role: "Unit Head", action: "submitted", module: "Unit Head Performance", record: `Performance report — ${payload.weekEnding}`, previousValue: null, newValue: "submitted" });
    return latency(created);
  },

  // Administration or Programme Head evaluates, then the report auto-forwards to CPU in the same action.
  evaluate: (id: string, score: number, comment: string, evaluatedBy: string): Promise<UnitHeadAppraisal> => {
    const now = new Date().toISOString().slice(0, 10);
    const report = store.find((a) => a.id === id);
    store = store.map((a) => (a.id === id ? { ...a, score, status: "forwarded_to_cpu" as AppraisalStatus, evaluationComment: comment, evaluatedBy, evaluatedAt: now, forwardedToCpuAt: now } : a));
    persist();
    if (report) auditService.append({ user: evaluatedBy, role: "Evaluator", action: "approved", module: "Unit Head Performance", record: `${report.unitHeadName} — ${report.weekEnding}`, previousValue: null, newValue: `${score}%`, reason: comment });
    return latency(store.find((a) => a.id === id)!);
  },

  returnForCorrection: (id: string, comment: string, returnedBy: string): Promise<UnitHeadAppraisal> => {
    const now = new Date().toISOString().slice(0, 10);
    const report = store.find((a) => a.id === id);
    store = store.map((a) => (a.id === id ? { ...a, status: "returned" as AppraisalStatus, evaluationComment: comment, evaluatedAt: now } : a));
    persist();
    if (report) auditService.append({ user: returnedBy, role: "Evaluator", action: "returned", module: "Unit Head Performance", record: `${report.unitHeadName} — ${report.weekEnding}`, previousValue: "submitted", newValue: "returned", reason: comment });
    return latency(store.find((a) => a.id === id)!);
  },
};
