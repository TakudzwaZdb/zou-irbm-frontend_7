export type AppraisalStatus = "draft" | "submitted" | "appraised" | "evaluated" | "forwarded_to_cpu" | "returned";
export type ApprovalStage = "programme_head" | "vc" | "cpu";

export interface Attachment {
  attachmentName?: string;
  attachmentFile?: File;
  attachmentUploadedAt?: string;
}

export interface StaffAppraisal extends Attachment {
  id: string;
  staffId: string;
  staffName: string;
  unitId: string;
  unitName: string;
  recipientUnitId: string;
  recipientUnitName: string;
  recipientHead: string;
  weekEnding: string;
  activitySummary: string;
  score: number | null;
  status: AppraisalStatus;
  appraisedBy?: string;
  appraisedAt?: string;
  appraisalComment?: string;
  feedback?: string;
  feedbackBy?: string;
  feedbackAt?: string;
  submittedAt: string;
}

export interface UnitHeadAppraisal extends Attachment {
  id: string;
  unitHeadId: string;
  unitHeadName: string;
  unitId: string;
  unitName: string;
  recipient: string;
  weekEnding: string;
  jobSummary: string;
  score: number | null;
  status: AppraisalStatus;
  evaluatedBy?: string;
  evaluatedAt?: string;
  evaluationComment?: string;
  forwardedToCpuAt?: string;
  submittedAt: string;
}

// Every Unit, Department, Faculty, and Regional Campus follows the same
// protocol: submit to Programme Head -> Programme Head approves and sends
// to VC -> VC approves and sends to CPU -> CPU evaluates, monitors and
// gives final approval/validation against budget and feasibility. Any
// stage can reject, which ends the chain with a timestamped reason.
export type OperationalPlanStatus = "pending_programme_head" | "pending_vc" | "pending_cpu" | "validated" | "rejected";

export interface OperationalPlan extends Attachment {
  id: string;
  unitHeadId: string;
  unitHeadName: string;
  unitId: string;
  unitName: string;
  programmeId: string;
  title: string;
  period: string;
  status: OperationalPlanStatus;
  programmeHeadReviewedBy?: string;
  programmeHeadReviewedAt?: string;
  vcReviewedBy?: string;
  vcReviewedAt?: string;
  cpuValidatedBy?: string;
  cpuValidatedAt?: string;
  budgetComment?: string;
  feasibilityComment?: string;
  rejectedStage?: ApprovalStage;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  archived: boolean;
  archivedAt?: string;
  submittedAt: string;
}

export type AppraisalTier = "staff" | "unit_head";

export interface QuarterlyAppraisalSummary {
  id: string;
  quarter: string;
  tier: AppraisalTier;
  subjectId: string;
  subjectName: string;
  unitId: string;
  unitName: string;
  averageScore: number;
  sampleSize: number;
  generatedAt: string;
}
