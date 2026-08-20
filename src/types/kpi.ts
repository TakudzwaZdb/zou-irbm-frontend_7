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
  // Q13: the data model is strictly tree-shaped (one parent Programme per
  // KPI) with a small number of cross-cutting exceptions. Rather than
  // redesigning the whole model around a many-to-many relationship, a
  // cross-cutting KPI gets this optional secondary tag pointing at the
  // other Programme it's also relevant to.
  linkedProgrammeId?: string;
  // Q16: when a Programme Head or Sub-programme Head breaks a
  // higher-level target down into a target for the level below them, the
  // new KPI records which KPI it was cascaded from.
  parentKpiId?: string;
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
