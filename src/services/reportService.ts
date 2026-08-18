import { latency } from "./mockUtils";
import { reports as seedReports } from "@/data/reports";
import type { ReportItem } from "@/types/report";
import type { AppraisalTier } from "@/types/appraisal";

let store: ReportItem[] = [...seedReports];

export const reportService = {
  list: () => latency(store),
  // Placeholder for backend-generated exports. Returns instantly in the mock
  // layer; a real implementation would call e.g. POST /api/reports/{id}/export
  // and return a signed download URL or blob.
  export: async (_reportId: string, _format: "PDF" | "XLSX"): Promise<{ url: string }> => {
    await latency(null, 400);
    return { url: "#" };
  },

  // CPU Dashboard requirement: automatically generate structured performance
  // reports for a tier (staff / unit head) for a given quarter, pulling from
  // the analytics engine's rolling averages.
  generateAppraisalReport: async (tier: AppraisalTier, quarter: string): Promise<ReportItem> => {
    const item: ReportItem = {
      id: `r-${Date.now()}`,
      title: `${tier === "staff" ? "Staff" : "Unit Head"} appraisal report — ${quarter}`,
      type: "KPI Achievement Report",
      period: quarter,
      generatedAt: new Date().toISOString().slice(0, 10),
      format: "PDF",
    };
    store = [item, ...store];
    return latency(item, 350);
  },
};
