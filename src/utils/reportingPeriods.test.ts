import { describe, it, expect } from "vitest";
import { reportingMonths, currentReportingMonth, isPeriodPastDue } from "./reportingPeriods";

describe("reportingMonths", () => {
  it("returns the requested number of months, most recent first", () => {
    const months = reportingMonths(3, new Date("2026-08-15"));
    expect(months).toEqual(["August 2026", "July 2026", "June 2026"]);
  });
});

describe("currentReportingMonth", () => {
  it("formats the given date as its calendar month", () => {
    expect(currentReportingMonth(new Date("2026-03-10"))).toBe("March 2026");
  });
});

describe("isPeriodPastDue", () => {
  it("is not past due before the 5th of the following month", () => {
    expect(isPeriodPastDue("July 2026", new Date("2026-08-04"))).toBe(false);
  });
  it("is past due after the 5th of the following month", () => {
    expect(isPeriodPastDue("July 2026", new Date("2026-08-06"))).toBe(true);
  });
  it("returns false for an unparseable period rather than throwing", () => {
    expect(isPeriodPastDue("not a real period", new Date())).toBe(false);
  });
});
