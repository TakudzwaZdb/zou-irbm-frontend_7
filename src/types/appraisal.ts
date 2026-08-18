export type AppraisalStatus = "draft" | "submitted" | "appraised" | "evaluated" | "forwarded_to_cpu" | "returned";

export interface StaffAppraisal {
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
  appraisalComment?: string;
  submittedAt: string;
}

export interface UnitHeadAppraisal {
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
  evaluationComment?: string;
  forwardedToCpuAt?: string;
  submittedAt: string;
}

export type OperationalPlanStatus = "pending_vc" | "approved";

export interface OperationalPlan {
  id: string;
  unitHeadId: string;
  unitHeadName: string;
  unitId: string;
  unitName: string;
  programmeId: string;
  title: string;
  period: string;
  status: OperationalPlanStatus;
  vcApprovedBy?: string;
  vcApprovedAt?: string;
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
