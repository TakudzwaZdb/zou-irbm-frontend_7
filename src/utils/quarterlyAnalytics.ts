// The CPU Dashboard's automated analytics engine.
// Pure function: given raw weekly appraisal scores, produce quarterly rolling
// averages per subject (staff member or Unit Head), grouped by unit.
// In production this becomes a Laravel scheduled job writing to a
// `quarterly_appraisal_summaries` table; the frontend would then just fetch
// the latest precomputed rows instead of recalculating on every page load.
// The function signature and output shape are written so that swap is
// invisible to any page that calls analyticsService.getQuarterlySummaries().

import type { StaffAppraisal, UnitHeadAppraisal, QuarterlyAppraisalSummary, AppraisalTier } from "@/types/appraisal";

export function isoWeekToQuarter(dateIso: string): string {
  const d = new Date(dateIso);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

interface ScoredEntry {
  subjectId: string;
  subjectName: string;
  unitId: string;
  unitName: string;
  weekEnding: string;
  score: number | null;
}

function aggregate(entries: ScoredEntry[], tier: AppraisalTier, quarter: string): QuarterlyAppraisalSummary[] {
  const inQuarter = entries.filter((e) => e.score !== null && isoWeekToQuarter(e.weekEnding) === quarter);
  const bySubject = new Map<string, ScoredEntry[]>();
  for (const e of inQuarter) {
    const list = bySubject.get(e.subjectId) ?? [];
    list.push(e);
    bySubject.set(e.subjectId, list);
  }

  let counter = 0;
  return Array.from(bySubject.entries()).map(([subjectId, list]) => {
    counter += 1;
    const avg = Math.round((list.reduce((a, e) => a + (e.score ?? 0), 0) / list.length) * 10) / 10;
    return {
      id: `qas-${tier}-${quarter}-${counter}`,
      quarter,
      tier,
      subjectId,
      subjectName: list[0].subjectName,
      unitId: list[0].unitId,
      unitName: list[0].unitName,
      averageScore: avg,
      sampleSize: list.length,
      generatedAt: new Date().toISOString(),
    };
  });
}

export function computeQuarterlyAverages(
  staffAppraisals: StaffAppraisal[],
  unitHeadAppraisals: UnitHeadAppraisal[],
  quarter: string
): QuarterlyAppraisalSummary[] {
  const staffEntries: ScoredEntry[] = staffAppraisals.map((a) => ({
    subjectId: a.staffId, subjectName: a.staffName, unitId: a.unitId, unitName: a.unitName, weekEnding: a.weekEnding, score: a.score,
  }));
  const unitHeadEntries: ScoredEntry[] = unitHeadAppraisals.map((a) => ({
    subjectId: a.unitHeadId, subjectName: a.unitHeadName, unitId: a.unitId, unitName: a.unitName, weekEnding: a.weekEnding, score: a.score,
  }));

  return [...aggregate(staffEntries, "staff", quarter), ...aggregate(unitHeadEntries, "unit_head", quarter)];
}

export function availableQuarters(staffAppraisals: StaffAppraisal[], unitHeadAppraisals: UnitHeadAppraisal[]): string[] {
  const all = [...staffAppraisals.map((a) => a.weekEnding), ...unitHeadAppraisals.map((a) => a.weekEnding)];
  return Array.from(new Set(all.map(isoWeekToQuarter))).sort();
}
