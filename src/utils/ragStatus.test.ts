import { describe, it, expect } from "vitest";
import { ragFor, DEFAULT_THRESHOLDS } from "./ragStatus";

describe("ragFor", () => {
  it("returns on-track when progress meets the on-track threshold", () => {
    // baseline 50, target 100 -> 85% progress = actual 92.5
    expect(ragFor(92.5, 100, 50, DEFAULT_THRESHOLDS)).toBe("on-track");
  });

  it("returns at-risk when progress is between the two thresholds", () => {
    // 60% progress = actual 80
    expect(ragFor(80, 100, 50, DEFAULT_THRESHOLDS)).toBe("at-risk");
  });

  it("returns off-track when progress is below the at-risk threshold", () => {
    expect(ragFor(55, 100, 50, DEFAULT_THRESHOLDS)).toBe("off-track");
  });

  it("treats progress above 100% as on-track, not an error", () => {
    expect(ragFor(150, 100, 50, DEFAULT_THRESHOLDS)).toBe("on-track");
  });

  it("respects custom thresholds instead of only the defaults", () => {
    // With a stricter 95% on-track bar, the same value that was on-track
    // under defaults should now read as at-risk.
    expect(ragFor(92.5, 100, 50, { onTrack: 95, atRisk: 60 })).toBe("at-risk");
  });

  it("doesn't divide by zero when target equals baseline", () => {
    expect(() => ragFor(10, 50, 50, DEFAULT_THRESHOLDS)).not.toThrow();
  });
});
