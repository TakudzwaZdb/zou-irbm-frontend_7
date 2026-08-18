export type AlertLevel = "info" | "warning" | "critical";
export type AlertType = "missed_target" | "underperforming" | "late_submission" | "pending_approval" | "overdue" | "negative_variance";

export interface Alert {
  id: string;
  kpiId: string;
  kpiName: string;
  subProgramme: string;
  type: AlertType;
  level: AlertLevel;
  message: string;
  escalationStep: "Unit Head" | "Sub-programme Head" | "Programme Head" | "Vice-Chancellor";
  emailSent: boolean;
  createdAt: string;
  acknowledged: boolean;
}
