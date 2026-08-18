import type { PerformanceSubmission } from "@/types/kpi";
import { kpis } from "./kpis";

export const submissions: PerformanceSubmission[] = kpis
  .filter((k) => k.workflow !== "draft")
  .map((k, i) => ({
    id: `sub-${k.id}`,
    kpiId: k.id,
    kpiName: k.name,
    period: "August 2026",
    target: k.target,
    actual: k.actual,
    achievementPct: Math.round((k.actual / k.target) * 100),
    variance: Math.round((k.actual - k.target) * 10) / 10,
    explanation:
      k.status === "off-track"
        ? "Delayed procurement processes and staff turnover impacted delivery this period."
        : k.status === "at-risk"
        ? "On pace but a dependency on external partners introduces some schedule risk."
        : "Delivery proceeded broadly as planned this reporting period.",
    evidenceFileName: i % 3 === 0 ? undefined : `${k.id}-evidence-aug2026.pdf`,
    status: k.workflow,
    submittedBy: k.owner,
    submittedAt: k.lastUpdated,
    reviewComment: k.workflow === "returned" ? "Figure inconsistent with helpdesk export, please re-verify against source system." : undefined,
    late: i % 4 === 0,
  }));
