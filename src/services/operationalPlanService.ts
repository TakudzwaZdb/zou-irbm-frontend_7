import { latency } from "./mockUtils";
import { operationalPlans as seed } from "@/data/operationalPlans";
import { loadStore, saveStore } from "@/utils/persistedStore";
import { auditService } from "./auditService";
import { alertService } from "./alertService";
import type { OperationalPlan, OperationalPlanStatus, ApprovalStage } from "@/types/appraisal";

const KEY = "zou_irbm_store_operationalPlans";
let store: OperationalPlan[] = loadStore(KEY, seed);

function persist() {
  saveStore(KEY, store);
}

const STAGE_LABEL: Record<ApprovalStage, string> = { programme_head: "Programme Head", vc: "Vice-Chancellor", cpu: "CPU" };

// Uniform protocol for every Unit, Department, Faculty, and Regional Campus:
// Unit Head -> Programme Head (review) -> VC (review) -> CPU (evaluation,
// monitoring, and final approval/validation against budget and feasibility).
// Any stage can reject instead of approving, ending the chain with a
// timestamped reason; the Unit Head can then revise and resubmit.
export const operationalPlanService = {
  list: (filters?: { programmeId?: string; status?: OperationalPlanStatus; unitHeadId?: string }): Promise<OperationalPlan[]> => {
    let result = store;
    if (filters?.programmeId) result = result.filter((p) => p.programmeId === filters.programmeId);
    if (filters?.status) result = result.filter((p) => p.status === filters.status);
    if (filters?.unitHeadId) result = result.filter((p) => p.unitHeadId === filters.unitHeadId);
    return latency(result);
  },

  submit: (payload: Pick<OperationalPlan, "unitHeadId" | "unitHeadName" | "unitId" | "unitName" | "programmeId" | "title" | "period" | "attachmentName" | "attachmentFile">): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    const created: OperationalPlan = {
      ...payload, id: `op-${Date.now()}`, status: "pending_programme_head",
      attachmentUploadedAt: payload.attachmentFile ? now : undefined,
      archived: true, archivedAt: now, submittedAt: now,
    };
    store = [created, ...store];
    persist();
    auditService.append({ user: payload.unitHeadName, role: "Unit Head", action: "submitted", module: "Operational Plan", record: payload.title, previousValue: null, newValue: "pending_programme_head" });
    return latency(created);
  },

  approveByProgrammeHead: (id: string, reviewedBy: string): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    const plan = store.find((p) => p.id === id);
    store = store.map((p) => (p.id === id ? { ...p, status: "pending_vc" as OperationalPlanStatus, programmeHeadReviewedBy: reviewedBy, programmeHeadReviewedAt: now } : p));
    persist();
    if (plan) auditService.append({ user: reviewedBy, role: "Programme Head", action: "approved", module: "Operational Plan", record: plan.title, previousValue: "pending_programme_head", newValue: "pending_vc" });
    return latency(store.find((p) => p.id === id)!);
  },

  approveByVc: (id: string, reviewedBy: string): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    const plan = store.find((p) => p.id === id);
    store = store.map((p) => (p.id === id ? { ...p, status: "pending_cpu" as OperationalPlanStatus, vcReviewedBy: reviewedBy, vcReviewedAt: now } : p));
    persist();
    if (plan) auditService.append({ user: reviewedBy, role: "Vice-Chancellor", action: "approved", module: "Operational Plan", record: plan.title, previousValue: "pending_vc", newValue: "pending_cpu" });
    return latency(store.find((p) => p.id === id)!);
  },

  // CPU's final action: evaluation, monitoring, and approval/validation
  // against budget and feasibility. Requires both assessments.
  validateByCpu: (id: string, validatedBy: string, budgetComment: string, feasibilityComment: string): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    const plan = store.find((p) => p.id === id);
    store = store.map((p) =>
      p.id === id
        ? { ...p, status: "validated" as OperationalPlanStatus, cpuValidatedBy: validatedBy, cpuValidatedAt: now, budgetComment, feasibilityComment }
        : p
    );
    persist();
    if (plan) auditService.append({ user: validatedBy, role: "CPU", action: "approved", module: "Operational Plan", record: plan.title, previousValue: "pending_cpu", newValue: "validated", reason: `Budget: ${budgetComment} | Feasibility: ${feasibilityComment}` });
    return latency(store.find((p) => p.id === id)!);
  },

  reject: (id: string, stage: ApprovalStage, rejectedBy: string, reason: string): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    const plan = store.find((p) => p.id === id);
    store = store.map((p) =>
      p.id === id
        ? { ...p, status: "rejected" as OperationalPlanStatus, rejectedStage: stage, rejectedBy, rejectedAt: now, rejectionReason: reason }
        : p
    );
    persist();
    if (plan) {
      auditService.append({ user: rejectedBy, role: STAGE_LABEL[stage], action: "rejected", module: "Operational Plan", record: plan.title, previousValue: plan.status, newValue: "rejected", reason });
      alertService.append({
        kpiId: plan.id, kpiName: plan.title, subProgramme: plan.unitName, type: "missed_target", level: "critical",
        message: `Operational plan rejected at ${STAGE_LABEL[stage]} stage: ${reason}`,
        escalationStep: "Unit Head", emailSent: false,
      });
    }
    return latency(store.find((p) => p.id === id)!);
  },

  // Lets the original Unit Head revise and resubmit a rejected plan —
  // restarts the chain at Programme Head, clearing the rejection record but
  // keeping the submission history in the audit trail.
  resubmit: (id: string, resubmittedBy: string): Promise<OperationalPlan> => {
    const now = new Date().toISOString().slice(0, 10);
    const plan = store.find((p) => p.id === id);
    store = store.map((p) =>
      p.id === id
        ? { ...p, status: "pending_programme_head" as OperationalPlanStatus, rejectedStage: undefined, rejectedBy: undefined, rejectedAt: undefined, rejectionReason: undefined, submittedAt: now }
        : p
    );
    persist();
    if (plan) auditService.append({ user: resubmittedBy, role: "Unit Head", action: "submitted", module: "Operational Plan", record: `${plan.title} (resubmission)`, previousValue: "rejected", newValue: "pending_programme_head" });
    return latency(store.find((p) => p.id === id)!);
  },
};
