import type { ComplianceRecord } from "@/types/compliance";

const subs: [string, string][] = [
  ["gov-ict", "ICT"], ["gov-fin", "Financial Services"], ["gov-admin", "Administration"],
  ["hcd-tl", "Teaching & Learning"], ["hcd-lib", "Library & Information Services"], ["rii-re", "Research & Enterprises"],
];
const months = ["2026-05", "2026-06", "2026-07", "2026-08"];

function statusFor(i: number, j: number): ComplianceRecord["status"] {
  const pattern = (i + j) % 5;
  if (pattern === 4) return "missing";
  if (pattern === 3) return "late";
  return "on-time";
}

export const compliance: ComplianceRecord[] = subs.flatMap(([id, name], i) =>
  months.map((month, j) => {
    const status = statusFor(i, j);
    return {
      id: `c-${id}-${month}`, subProgrammeId: id, subProgramme: name, month, dueDate: `${month}-05`,
      submittedDate: status === "missing" ? null : status === "late" ? `${month}-11` : `${month}-04`,
      status,
    };
  })
);
