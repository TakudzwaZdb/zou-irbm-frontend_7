import { describe, it, expect } from "vitest";
import { isoWeekToQuarter, computeQuarterlyAverages, availableQuarters } from "./quarterlyAnalytics";
import type { StaffAppraisal, UnitHeadAppraisal } from "@/types/appraisal";

function staff(overrides: Partial<StaffAppraisal>): StaffAppraisal {
  return {
    id: "sa1", staffId: "st1", staffName: "T. Marufu", unitId: "u1", unitName: "Infrastructure",
    recipientUnitId: "u1", recipientUnitName: "Infrastructure", recipientHead: "Mr. J. Zvomuya",
    weekEnding: "2026-07-20", activitySummary: "did work", score: 80, status: "appraised", submittedAt: "2026-07-20",
    ...overrides,
  };
}

function unitHead(overrides: Partial<UnitHeadAppraisal>): UnitHeadAppraisal {
  return {
    id: "uha1", unitHeadId: "head-u1", unitHeadName: "Mr. J. Zvomuya", unitId: "u1", unitName: "Infrastructure",
    recipient: "Administration Office", weekEnding: "2026-07-20", jobSummary: "led team", score: 90,
    status: "evaluated", submittedAt: "2026-07-20",
    ...overrides,
  };
}

describe("isoWeekToQuarter", () => {
  it("maps January-March to Q1", () => {
    expect(isoWeekToQuarter("2026-02-15")).toBe("2026-Q1");
  });
  it("maps July-September to Q3", () => {
    expect(isoWeekToQuarter("2026-08-10")).toBe("2026-Q3");
  });
  it("maps October-December to Q4", () => {
    expect(isoWeekToQuarter("2026-11-01")).toBe("2026-Q4");
  });
});

describe("computeQuarterlyAverages", () => {
  it("averages multiple scored weeks for the same staff member", () => {
    const reports = [staff({ id: "a", score: 80 }), staff({ id: "b", score: 90, weekEnding: "2026-07-27" })];
    const result = computeQuarterlyAverages(reports, [], "2026-Q3");
    expect(result).toHaveLength(1);
    expect(result[0].averageScore).toBe(85);
    expect(result[0].sampleSize).toBe(2);
    expect(result[0].tier).toBe("staff");
  });

  it("excludes unscored (null) weeks from the average", () => {
    const reports = [staff({ id: "a", score: 80 }), staff({ id: "b", score: null, weekEnding: "2026-07-27" })];
    const result = computeQuarterlyAverages(reports, [], "2026-Q3");
    expect(result[0].averageScore).toBe(80);
    expect(result[0].sampleSize).toBe(1);
  });

  it("excludes entries outside the requested quarter", () => {
    const reports = [staff({ id: "a", score: 80, weekEnding: "2026-11-01" })];
    const result = computeQuarterlyAverages(reports, [], "2026-Q3");
    expect(result).toHaveLength(0);
  });

  it("keeps staff and Unit Head tiers separate even for the same quarter", () => {
    const result = computeQuarterlyAverages([staff({})], [unitHead({})], "2026-Q3");
    expect(result.map((r) => r.tier).sort()).toEqual(["staff", "unit_head"]);
  });

  it("groups by subject, not by report id — two different staff members stay separate", () => {
    const reports = [staff({ id: "a", staffId: "st1", score: 80 }), staff({ id: "b", staffId: "st2", score: 60, weekEnding: "2026-07-27" })];
    const result = computeQuarterlyAverages(reports, [], "2026-Q3");
    expect(result).toHaveLength(2);
  });
});

describe("availableQuarters", () => {
  it("returns unique, sorted quarters derived from the data", () => {
    const reports = [staff({ id: "a", weekEnding: "2026-08-01" }), staff({ id: "b", weekEnding: "2026-02-01" }), staff({ id: "c", weekEnding: "2026-08-15" })];
    expect(availableQuarters(reports, [])).toEqual(["2026-Q1", "2026-Q3"]);
  });

  it("returns an empty array when there's no data", () => {
    expect(availableQuarters([], [])).toEqual([]);
  });
});
