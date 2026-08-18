import type { UnitHeadAppraisal } from "@/types/appraisal";
import { orgUnits } from "./organisation";

const weeks = ["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];

interface Seed { unitId: string; head: string; weekEnding: string; score: number | null; status: UnitHeadAppraisal["status"]; summary: string; }

const seeds: Seed[] = [
  { unitId: "u1", head: "Mr. J. Zvomuya", weekEnding: weeks[0], score: 89, status: "evaluated", summary: "Oversaw firmware upgrade rollout and network segmentation kickoff across the team." },
  { unitId: "u1", head: "Mr. J. Zvomuya", weekEnding: weeks[1], score: 92, status: "evaluated", summary: "Segmentation project delivered with zero downtime; team SLA at 96%." },
  { unitId: "u1", head: "Mr. J. Zvomuya", weekEnding: weeks[2], score: null, status: "submitted", summary: "Handover documentation and exam-period load testing coordination." },
  { unitId: "u3", head: "Mr. B. Ncube", weekEnding: weeks[0], score: 71, status: "evaluated", summary: "Managed SLA recovery plan following vendor-side ticket delays." },
  { unitId: "u3", head: "Mr. B. Ncube", weekEnding: weeks[1], score: 80, status: "evaluated", summary: "SLA back within target; escalation process documented for future incidents." },
  { unitId: "u4", head: "Mrs. A. Dube", weekEnding: weeks[0], score: 86, status: "evaluated", summary: "Ledger reconciliation and payroll run completed without variance." },
  { unitId: "u6", head: "Mrs. G. Moyo", weekEnding: weeks[0], score: 74, status: "submitted", summary: "Registry throughput steady; reviewing turnaround time targets with team." },
  { unitId: "u13", head: "Dr. L. Mudenda", weekEnding: weeks[0], score: null, status: "submitted", summary: "Grants pipeline review; one compliance flag under follow-up." },
];

let counter = 0;
export const unitHeadAppraisals: UnitHeadAppraisal[] = seeds.map((s) => {
  counter += 1;
  const unit = orgUnits.find((u) => u.id === s.unitId);
  return {
    id: `uha${counter}`,
    unitHeadId: `head-${s.unitId}`,
    unitHeadName: s.head,
    unitId: s.unitId,
    unitName: unit?.name ?? "Unknown unit",
    recipient: "Administration Office",
    weekEnding: s.weekEnding,
    jobSummary: s.summary,
    score: s.score,
    status: s.status,
    evaluatedBy: s.status === "evaluated" ? "Administration" : undefined,
    evaluationComment: s.status === "evaluated" ? "Consistent with plan; no corrective action required." : undefined,
    forwardedToCpuAt: s.status === "evaluated" ? s.weekEnding : undefined,
    submittedAt: s.weekEnding,
  };
});
