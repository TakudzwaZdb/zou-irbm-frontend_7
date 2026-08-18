export type RagStatus = "on-track" | "at-risk" | "off-track";
export type WorkflowStatus = "draft" | "submitted" | "pending_review" | "approved" | "rejected" | "returned";
export type IndicatorType = "output" | "outcome";
export type Unit = "%" | "count" | "number";
export type ReportingFrequency = "monthly" | "quarterly" | "bi-annual" | "annual";

export interface Milestone {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  target: number;
  actual: number | null;
}

export interface Override {
  systemValue: number;
  overrideValue: number;
  reason: string;
  user: string;
  timestamp: string;
}

export interface Kpi {
  id: string;
  programmeId: string;
  subProgrammeId: string;
  unitId: string;
  name: string;
  type: IndicatorType;
  unit: Unit;
  baseline: number;
  target: number;
  actual: number;
  status: RagStatus;
  workflow: WorkflowStatus;
  trend: number[];
  milestones: Milestone[];
  owner: string;
  reportingFrequency: ReportingFrequency;
  dataSource: string;
  lastUpdated: string;
  override?: Override;
}

export interface PerformanceSubmission {
  id: string;
  kpiId: string;
  kpiName: string;
  period: string;
  target: number;
  actual: number;
  achievementPct: number;
  variance: number;
  explanation: string;
  evidenceFileName?: string;
  status: WorkflowStatus;
  submittedBy: string;
  submittedAt: string;
  reviewComment?: string;
  late: boolean;
}
