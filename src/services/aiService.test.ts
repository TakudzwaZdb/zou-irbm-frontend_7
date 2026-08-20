import { describe, it, expect } from "vitest";
import { detectDomains, ROLE_DATA_ACCESS } from "./aiService";

describe("detectDomains", () => {
  it("matches a KPI-related question to the kpis domain", () => {
    expect(detectDomains("How many KPIs are off track?")).toContain("kpis");
  });

  it("matches an operational plan question to the operationalPlans domain", () => {
    expect(detectDomains("How many operational plans are pending?")).toContain("operationalPlans");
  });

  it("matches a compliance question to the compliance domain", () => {
    expect(detectDomains("What's our on-time submission rate?")).toContain("compliance");
  });

  it("returns an empty array for a question that matches nothing recognizable", () => {
    expect(detectDomains("What's the weather like today?")).toEqual([]);
  });

  it("can match more than one domain in a single question", () => {
    const domains = detectDomains("How many KPIs and alerts do we have?");
    expect(domains).toContain("kpis");
    expect(domains).toContain("alerts");
  });

  it("de-duplicates repeated domain matches within one question", () => {
    const domains = detectDomains("Which KPI is off track and which KPI is on track?");
    expect(domains.filter((d) => d === "kpis")).toHaveLength(1);
  });
});

describe("ROLE_DATA_ACCESS", () => {
  it("gives every role at least one accessible domain", () => {
    for (const [role, domains] of Object.entries(ROLE_DATA_ACCESS)) {
      expect(domains.length, `${role} should have at least one accessible domain`).toBeGreaterThan(0);
    }
  });

  it("restricts Operational Staff to only their own appraisal data", () => {
    expect(ROLE_DATA_ACCESS.staff).toEqual(["staffAppraisals"]);
  });

  it("does not give Sub-programme Rep access to sensitive domains like users or audit", () => {
    expect(ROLE_DATA_ACCESS.subprogramme_rep).not.toContain("users");
    expect(ROLE_DATA_ACCESS.subprogramme_rep).not.toContain("audit");
  });
});
