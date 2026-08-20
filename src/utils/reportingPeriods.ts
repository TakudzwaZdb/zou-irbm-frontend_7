// Q22: "Monthly is the base submission cadence... the dashboard's reporting
// calendar should be built around a monthly data-entry cycle." A free-text
// period field doesn't enforce a calendar at all — this generates the real
// list of reportable months, and flags when the selected one is already
// past its due date, matching the same DUE_DAY logic performanceService
// uses to compute lateness server-side.

const DUE_DAY = 5;

export function reportingMonths(count = 12, from: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  });
}

export function currentReportingMonth(from: Date = new Date()): string {
  return from.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function isPeriodPastDue(period: string, now: Date = new Date()): boolean {
  const parsed = new Date(`1 ${period}`);
  if (Number.isNaN(parsed.getTime())) return false;
  const due = new Date(parsed.getFullYear(), parsed.getMonth() + 1, DUE_DAY);
  return now > due;
}
