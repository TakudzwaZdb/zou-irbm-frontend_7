import type { Kpi, RagStatus, Milestone } from "@/types/kpi";

function ragFor(actual: number, target: number, baseline: number): RagStatus {
  const progress = (actual - baseline) / (target - baseline || 1);
  if (progress >= 0.85) return "on-track";
  if (progress >= 0.6) return "at-risk";
  return "off-track";
}

function milestonesFor(target: number, actualToDate: number): Milestone[] {
  const perQuarter = target / 4;
  return (["Q1", "Q2", "Q3", "Q4"] as const).map((q, i) => {
    const qTarget = Math.round(perQuarter * (i + 1));
    const done = i < 3;
    return { quarter: q, target: Math.round(perQuarter), actual: done ? Math.round(Math.min(actualToDate, qTarget) / (i + 1)) : null };
  });
}

function trendFor(baseline: number, actual: number): number[] {
  const steps = 6;
  return Array.from({ length: steps }, (_, i) => Math.round((baseline + ((actual - baseline) * i) / (steps - 1)) * 10) / 10);
}

interface Seed {
  id: string; programmeId: string; subProgrammeId: string; unitId: string; name: string;
  type: "output" | "outcome"; unit: "%" | "count" | "number";
  baseline: number; target: number; actual: number;
  workflow: Kpi["workflow"]; owner: string; dataSource: string; lastUpdated: string;
  override?: Kpi["override"];
}

const seeds: Seed[] = [
  { id: "k01", programmeId: "gov", subProgrammeId: "gov-ict", unitId: "u1", name: "System uptime", type: "output", unit: "%", baseline: 92, target: 99, actual: 97.4, workflow: "approved", owner: "K. Moyo", dataSource: "ICT monitoring logs", lastUpdated: "2026-08-01" },
  { id: "k02", programmeId: "gov", subProgrammeId: "gov-ict", unitId: "u3", name: "Helpdesk tickets closed within SLA", type: "output", unit: "%", baseline: 70, target: 90, actual: 88, workflow: "submitted", owner: "K. Moyo", dataSource: "Helpdesk system export", lastUpdated: "2026-08-05" },
  { id: "k03", programmeId: "gov", subProgrammeId: "gov-ict", unitId: "u2", name: "Cybersecurity incidents resolved", type: "outcome", unit: "%", baseline: 65, target: 95, actual: 74, workflow: "draft", owner: "K. Moyo", dataSource: "Security incident register", lastUpdated: "2026-07-20" },
  { id: "k04", programmeId: "gov", subProgrammeId: "gov-fin", unitId: "u4", name: "Budget absorption rate", type: "output", unit: "%", baseline: 61, target: 95, actual: 58, workflow: "pending_review", owner: "P. Ndlovu", dataSource: "Finance ledger", lastUpdated: "2026-08-04" },
  { id: "k05", programmeId: "gov", subProgrammeId: "gov-fin", unitId: "u4", name: "Audit queries resolved", type: "output", unit: "%", baseline: 50, target: 100, actual: 71, workflow: "approved", owner: "P. Ndlovu", dataSource: "Internal audit tracker", lastUpdated: "2026-07-28" },
  { id: "k06", programmeId: "gov", subProgrammeId: "gov-admin", unitId: "u6", name: "Staff performance appraisals completed", type: "output", unit: "%", baseline: 68, target: 100, actual: 93, workflow: "approved", owner: "S. Gumbo", dataSource: "HR information system", lastUpdated: "2026-08-02" },
  { id: "k07", programmeId: "gov", subProgrammeId: "gov-admin", unitId: "u7", name: "Estates maintenance requests closed", type: "output", unit: "%", baseline: 55, target: 90, actual: 62, workflow: "returned", owner: "S. Gumbo", dataSource: "Facilities ticketing system", lastUpdated: "2026-08-06" },
  { id: "k08", programmeId: "hcd", subProgrammeId: "hcd-tl", unitId: "u8", name: "Student pass rate", type: "outcome", unit: "%", baseline: 74, target: 85, actual: 81, workflow: "approved", owner: "F. Chirwa", dataSource: "Academic records system", lastUpdated: "2026-08-01" },
  { id: "k09", programmeId: "hcd", subProgrammeId: "hcd-tl", unitId: "u9", name: "Programme accreditation renewals on time", type: "output", unit: "%", baseline: 55, target: 100, actual: 62, workflow: "draft", owner: "F. Chirwa", dataSource: "Quality assurance office", lastUpdated: "2026-07-15" },
  { id: "k10", programmeId: "hcd", subProgrammeId: "hcd-tl", unitId: "u10", name: "Graduate employability rate", type: "outcome", unit: "%", baseline: 58, target: 80, actual: 63, workflow: "submitted", owner: "F. Chirwa", dataSource: "Graduate tracer survey", lastUpdated: "2026-08-05" },
  { id: "k11", programmeId: "hcd", subProgrammeId: "hcd-lib", unitId: "u11", name: "E-resource utilisation", type: "output", unit: "%", baseline: 40, target: 70, actual: 66, workflow: "submitted", owner: "L. Banda", dataSource: "Library e-resource platform", lastUpdated: "2026-08-05" },
  { id: "k12", programmeId: "hcd", subProgrammeId: "hcd-lib", unitId: "u12", name: "Regional library visits", type: "output", unit: "count", baseline: 12000, target: 20000, actual: 15400, workflow: "approved", owner: "L. Banda", dataSource: "Campus visitor logs", lastUpdated: "2026-07-30",
    override: { systemValue: 14900, overrideValue: 15400, reason: "System count excluded two regional campuses during a network outage.", user: "Corporate Planning Unit", timestamp: "2026-07-30 15:18" } },
  { id: "k13", programmeId: "rii", subProgrammeId: "rii-re", unitId: "u13", name: "Peer-reviewed publications", type: "outcome", unit: "count", baseline: 48, target: 90, actual: 52, workflow: "pending_review", owner: "M. Chuma", dataSource: "Research office register", lastUpdated: "2026-08-04" },
  { id: "k14", programmeId: "rii", subProgrammeId: "rii-re", unitId: "u14", name: "Industry partnerships signed", type: "output", unit: "count", baseline: 6, target: 15, actual: 12, workflow: "approved", owner: "M. Chuma", dataSource: "Industry liaison office", lastUpdated: "2026-07-25" },
  { id: "k15", programmeId: "rii", subProgrammeId: "rii-re", unitId: "u13", name: "Research grant income", type: "outcome", unit: "number", baseline: 180000, target: 500000, actual: 240000, workflow: "draft", owner: "M. Chuma", dataSource: "Research grants ledger", lastUpdated: "2026-07-18" },
];

export const kpis: Kpi[] = seeds.map((s) => ({
  ...s,
  reportingFrequency: "monthly",
  status: ragFor(s.actual, s.target, s.baseline),
  trend: trendFor(s.baseline, s.actual),
  milestones: milestonesFor(s.target, s.actual),
}));
