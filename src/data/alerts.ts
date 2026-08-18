import type { Alert } from "@/types/alert";

export const alerts: Alert[] = [
  { id: "al1", kpiId: "k04", kpiName: "Budget absorption rate", subProgramme: "Financial Services", type: "missed_target", level: "critical", message: "KPI has been off-track for 2 consecutive months.", escalationStep: "Programme Head", emailSent: true, createdAt: "2026-08-05 09:00", acknowledged: false },
  { id: "al2", kpiId: "k07", kpiName: "Estates maintenance requests closed", subProgramme: "Administration", type: "late_submission", level: "warning", message: "Submission returned for correction by CPU, resubmission overdue.", escalationStep: "Sub-programme Head", emailSent: true, createdAt: "2026-08-07 08:30", acknowledged: false },
  { id: "al3", kpiId: "k13", kpiName: "Peer-reviewed publications", subProgramme: "Research & Enterprises", type: "underperforming", level: "warning", message: "Trending below target trajectory for the annual cycle.", escalationStep: "Programme Head", emailSent: true, createdAt: "2026-08-04 12:15", acknowledged: true },
  { id: "al4", kpiId: "k09", kpiName: "Programme accreditation renewals on time", subProgramme: "Teaching & Learning", type: "overdue", level: "critical", message: "No submission recorded for July reporting period.", escalationStep: "Vice-Chancellor", emailSent: true, createdAt: "2026-08-08 07:45", acknowledged: false },
  { id: "al5", kpiId: "k15", kpiName: "Research grant income", subProgramme: "Research & Enterprises", type: "negative_variance", level: "info", message: "Milestone Q3 target reached ahead of schedule.", escalationStep: "Programme Head", emailSent: false, createdAt: "2026-08-02 10:00", acknowledged: true },
  { id: "al6", kpiId: "k04", kpiName: "Budget absorption rate", subProgramme: "Financial Services", type: "pending_approval", level: "warning", message: "Submission has been pending CPU review for 3 days.", escalationStep: "Unit Head", emailSent: true, createdAt: "2026-08-07 09:00", acknowledged: false },
];
