import type { StaffAppraisal } from "@/types/appraisal";
import { staffMembers } from "./staff";
import { orgUnits } from "./organisation";

const weeks = ["2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];

function unitName(unitId: string) {
  return orgUnits.find((u) => u.id === unitId)?.name ?? "Unknown unit";
}

let counter = 0;
function makeAppraisal(staffId: string, weekEnding: string, score: number | null, status: StaffAppraisal["status"], summary: string): StaffAppraisal {
  const staff = staffMembers.find((s) => s.id === staffId)!;
  const unit = orgUnits.find((u) => u.id === staff.unitId)!;
  counter += 1;
  return {
    id: `sa${counter}`,
    staffId,
    staffName: staff.name,
    unitId: staff.unitId,
    unitName: unitName(staff.unitId),
    recipientUnitId: unit.id,
    recipientUnitName: unit.name,
    recipientHead: unit.head,
    weekEnding,
    activitySummary: summary,
    score,
    status,
    appraisedBy: status === "appraised" ? "Unit Head" : undefined,
    appraisalComment: status === "appraised" ? "Consistent output this week, on pace with plan." : undefined,
    submittedAt: weekEnding,
  };
}

export const staffAppraisals: StaffAppraisal[] = [
  makeAppraisal("st1", weeks[0], 88, "appraised", "Completed router firmware upgrades across two campuses; resolved 14 network tickets."),
  makeAppraisal("st1", weeks[1], 91, "appraised", "Led network segmentation project for the finance VLAN; zero downtime incidents."),
  makeAppraisal("st1", weeks[2], null, "submitted", "Continued segmentation rollout; began documentation for handover."),
  makeAppraisal("st2", weeks[0], 76, "appraised", "Patched 40 workstations; backlog remains on printer queue issues."),
  makeAppraisal("st2", weeks[1], 82, "appraised", "Cleared printer backlog; onboarded 3 new staff accounts."),
  makeAppraisal("st2", weeks[2], null, "submitted", "Supporting exam-period system load testing."),
  makeAppraisal("st3", weeks[0], 94, "appraised", "Shipped the KPI dashboard filter feature ahead of schedule."),
  makeAppraisal("st3", weeks[1], 90, "appraised", "Fixed 6 production bugs; paired with QA on regression suite."),
  makeAppraisal("st4", weeks[0], 68, "appraised", "SLA breaches on 5 tickets due to vendor delay outside team control."),
  makeAppraisal("st4", weeks[1], 79, "appraised", "SLA recovered to target; vendor escalation resolved."),
  makeAppraisal("st4", weeks[2], null, "returned", "Draft activity log — missing ticket reference numbers."),
  makeAppraisal("st5", weeks[0], 85, "appraised", "Reconciled July ledger; no variances outstanding."),
  makeAppraisal("st5", weeks[1], 87, "appraised", "Processed August payroll run without error."),
  makeAppraisal("st6", weeks[0], 72, "appraised", "Processed 120 registry requests; average turnaround 3 days."),
  makeAppraisal("st7", weeks[0], 90, "appraised", "Coordinated Faculty of Arts orientation week logistics."),
  makeAppraisal("st8", weeks[0], 81, "appraised", "Ran 2 information literacy sessions; updated e-resource catalogue."),
  makeAppraisal("st9", weeks[0], 77, "appraised", "Processed 3 new grant applications; flagged 1 compliance issue."),
  makeAppraisal("st9", weeks[1], null, "submitted", "Following up on flagged compliance issue with Research office."),
];
