import { latency } from "./mockUtils";
import { reports as seedReports } from "@/data/reports";
import { staffAppraisalService } from "./staffAppraisalService";
import { unitHeadAppraisalService } from "./unitHeadAppraisalService";
import { computeQuarterlyAverages } from "@/utils/quarterlyAnalytics";
import type { ReportItem } from "@/types/report";
import type { AppraisalTier } from "@/types/appraisal";

let store: ReportItem[] = [...seedReports];

export const reportService = {
  list: () => latency(store),

  // Reports generated from live data (see generateAppraisalReport below)
  // carry real content and download as an actual text file. Seed reports —
  // standing in for what a real backend would render as a PDF/XLSX from
  // KPI/Programme/Compliance data — have no generated content in this mock,
  // so export on those returns a placeholder URL rather than pretending to
  // produce a file that doesn't exist.
  export: async (reportId: string, _format: "PDF" | "XLSX"): Promise<{ url: string }> => {
    await latency(null, 400);
    const report = store.find((r) => r.id === reportId);
    if (report?.content) {
      const blob = new Blob([report.content], { type: "text/plain;charset=utf-8" });
      return { url: URL.createObjectURL(blob) };
    }
    return { url: "#" };
  },

  // CPU Dashboard requirement: automatically generate structured performance
  // reports for a tier (staff / unit head) for a given quarter, pulling from
  // the analytics engine's rolling averages — with real content behind it,
  // not just a list entry with nothing to download.
  generateAppraisalReport: async (tier: AppraisalTier, quarter: string): Promise<ReportItem> => {
    const [staff, unitHeads] = await Promise.all([staffAppraisalService.list(), unitHeadAppraisalService.list()]);
    const summaries = computeQuarterlyAverages(staff, unitHeads, quarter).filter((s) => s.tier === tier);

    const lines = [
      `ZOU IRBM — ${tier === "staff" ? "Staff" : "Unit Head"} Appraisal Report`,
      "=".repeat(50),
      `Quarter: ${quarter}`,
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      "",
      summaries.length === 0
        ? "No scored appraisals were found for this quarter."
        : "Subject — Unit — Average score — Weeks scored",
      ...summaries.map((s) => `${s.subjectName} — ${s.unitName} — ${s.averageScore}% — ${s.sampleSize}`),
    ];

    const item: ReportItem = {
      id: `r-${Date.now()}`,
      title: `${tier === "staff" ? "Staff" : "Unit Head"} appraisal report — ${quarter}`,
      type: "KPI Achievement Report",
      period: quarter,
      generatedAt: new Date().toISOString().slice(0, 10),
      format: "PDF",
      content: lines.join("\n"),
    };
    store = [item, ...store];
    return latency(item, 350);
  },
};
