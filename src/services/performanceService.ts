import { latency } from "./mockUtils";
import { submissions as seed } from "@/data/submissions";
import { loadStore, saveStore } from "@/utils/persistedStore";
import { auditService } from "./auditService";
import { kpiService } from "./kpiService";
import { subProgrammeService } from "./subProgrammeService";
import { complianceService } from "./complianceService";
import { alertService } from "./alertService";
import type { PerformanceSubmission, WorkflowStatus } from "@/types/kpi";

const KEY = "zou_irbm_store_submissions";
let store: PerformanceSubmission[] = loadStore(KEY, seed);
const DUE_DAY = 5; // matches the "Submission due day" shown in Settings -> Reporting cadence

function persist() {
  saveStore(KEY, store);
}

export const performanceService = {
  list: (status?: WorkflowStatus): Promise<PerformanceSubmission[]> =>
    latency(status ? store.filter((s) => s.status === status) : store),

  submit: async (payload: Omit<PerformanceSubmission, "id" | "achievementPct" | "variance" | "status" | "submittedAt" | "late">): Promise<PerformanceSubmission> => {
    const now = new Date();
    const late = now.getDate() > DUE_DAY;
    const newSub: PerformanceSubmission = {
      ...payload,
      id: `sub-${Date.now()}`,
      achievementPct: Math.round((payload.actual / payload.target) * 100),
      variance: Math.round((payload.actual - payload.target) * 10) / 10,
      status: "submitted",
      submittedAt: now.toISOString().slice(0, 10),
      late,
    };
    store = [newSub, ...store];
    persist();
    auditService.append({ user: payload.submittedBy, role: "Sub-programme Rep", action: "submitted", module: "Performance Submission", record: `${payload.kpiName} — ${payload.period}`, previousValue: String(payload.target), newValue: String(payload.actual) });

    // Reflect this submission on the Submission Compliance page immediately,
    // rather than leaving that page frozen at seed data.
    const kpi = await kpiService.getById(payload.kpiId);
    if (kpi) {
      const sub = await subProgrammeService.getById(kpi.subProgrammeId);
      if (sub) {
        const month = now.toISOString().slice(0, 7);
        complianceService.recordSubmission(sub.id, sub.name, month, late ? "late" : "on-time");
      }
    }
    if (late) {
      alertService.append({
        kpiId: payload.kpiId, kpiName: payload.kpiName, subProgramme: kpi?.subProgrammeId ?? "",
        type: "late_submission", level: "warning",
        message: `${payload.kpiName} was submitted after the ${DUE_DAY}th, for period ${payload.period}.`,
        escalationStep: "Sub-programme Head", emailSent: false,
      });
    }

    return latency(newSub);
  },

  decide: async (id: string, decision: "approved" | "rejected" | "returned", comment: string, decidedBy = "Corporate Planning Unit"): Promise<PerformanceSubmission> => {
    const sub = store.find((s) => s.id === id);
    store = store.map((s) => (s.id === id ? { ...s, status: decision, reviewComment: comment } : s));
    persist();
    if (!sub) return latency(store.find((s) => s.id === id)!);

    auditService.append({ user: decidedBy, role: "CPU", action: decision, module: "Performance Submission", record: `${sub.kpiName} — ${sub.period}`, previousValue: "submitted", newValue: decision, reason: comment });

    // This is the step that was previously missing entirely: approving a
    // submission now actually writes the new actual value onto the KPI, so
    // the Executive Dashboard, Analytics, and RAG status reflect it —
    // instead of staying frozen while submissions get approved around them.
    if (decision === "approved") {
      const kpi = await kpiService.getById(sub.kpiId);
      if (kpi) {
        const trend = [...kpi.trend.slice(1), sub.actual];
        const updated = await kpiService.update(sub.kpiId, { actual: sub.actual, trend });
        auditService.append({ user: decidedBy, role: "CPU", action: "edited", module: "KPI Management", record: kpi.name, previousValue: String(kpi.actual), newValue: String(sub.actual), reason: "Updated from an approved performance submission" });

        if (updated.status === "off-track") {
          alertService.append({
            kpiId: kpi.id, kpiName: kpi.name, subProgramme: kpi.subProgrammeId,
            type: "missed_target", level: "critical",
            message: `${kpi.name} is off-track after the latest approved submission (${sub.actual}${kpi.unit === "%" ? "%" : ""} vs target ${kpi.target}${kpi.unit === "%" ? "%" : ""}).`,
            escalationStep: "Sub-programme Head", emailSent: false,
          });
        }
      }
    }

    return latency(store.find((s) => s.id === id)!);
  },
};
