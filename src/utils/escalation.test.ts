import { describe, it, expect } from "vitest";
import { currentEscalationStep, hasAutoEscalated } from "./escalation";
import type { Alert } from "@/types/alert";

function makeAlert(overrides: Partial<Alert>): Alert {
  return {
    id: "al1", kpiId: "k1", kpiName: "Test KPI", subProgramme: "ICT", type: "missed_target", level: "critical",
    message: "test", escalationStep: "Unit Head", emailSent: false, createdAt: "2026-08-01", acknowledged: false,
    ...overrides,
  };
}

describe("currentEscalationStep", () => {
  it("stays at the original step when the alert is fresh", () => {
    const alert = makeAlert({ createdAt: "2026-08-01" });
    expect(currentEscalationStep(alert, new Date("2026-08-01T12:00:00"))).toBe("Unit Head");
  });

  it("climbs one level after the escalation threshold passes", () => {
    const alert = makeAlert({ createdAt: "2026-08-01", escalationStep: "Unit Head" });
    expect(currentEscalationStep(alert, new Date("2026-08-04T12:00:00"))).toBe("Sub-programme Head");
  });

  it("never climbs past Vice-Chancellor, the top of the chain", () => {
    const alert = makeAlert({ createdAt: "2026-01-01", escalationStep: "Unit Head" });
    expect(currentEscalationStep(alert, new Date("2026-08-01"))).toBe("Vice-Chancellor");
  });

  it("does not escalate an acknowledged alert", () => {
    const alert = makeAlert({ createdAt: "2026-01-01", escalationStep: "Unit Head", acknowledged: true });
    expect(currentEscalationStep(alert, new Date("2026-08-01"))).toBe("Unit Head");
  });

  it("leaves non-hierarchy targets (e.g. Corporate Planning Unit) unchanged", () => {
    const alert = makeAlert({ createdAt: "2026-01-01", escalationStep: "Corporate Planning Unit" });
    expect(currentEscalationStep(alert, new Date("2026-08-01"))).toBe("Corporate Planning Unit");
  });
});

describe("hasAutoEscalated", () => {
  it("is false for a fresh alert", () => {
    expect(hasAutoEscalated(makeAlert({ createdAt: "2026-08-01" }), new Date("2026-08-01"))).toBe(false);
  });
  it("is true once the alert has climbed a level", () => {
    expect(hasAutoEscalated(makeAlert({ createdAt: "2026-08-01" }), new Date("2026-08-10"))).toBe(true);
  });
});
