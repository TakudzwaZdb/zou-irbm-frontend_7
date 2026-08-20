// Q32: "The intent is for the dashboard to generate the periodic reports
// directly from the monthly-fed data, rather than running as a parallel
// system alongside separately-compiled manual reports." These generators
// pull live data from the same services every other page reads from, so a
// generated report reflects whatever's actually in the system right now.
import { latency } from "./mockUtils";
import { reports as seedReports } from "@/data/reports";
import { kpiService } from "./kpiService";
import { programmeService } from "./programmeService";
import { complianceService } from "./complianceService";
import type { ReportItem, ReportType } from "@/types/report";

let store: ReportItem[] = [...seedReports];

function addReport(item: ReportItem) {
  store = [item, ...store];
}

export const reportService = {
  list: () => latency(store),

  // Reports with generated content download as a real text file. Seed
  // reports standing in for other backend-rendered output types return a
  // placeholder URL rather than pretending to produce a file that doesn't
  // exist.
  export: async (reportId: string, _format: "PDF" | "XLSX"): Promise<{ url: string }> => {
    await latency(null, 400);
    const report = store.find((r) => r.id === reportId);
    if (report?.content) {
      const blob = new Blob([report.content], { type: "text/plain;charset=utf-8" });
      return { url: URL.createObjectURL(blob) };
    }
    return { url: "#" };
  },

  generateKpiAchievementReport: async (period: string): Promise<ReportItem> => {
    const kpis = await kpiService.list();
    const lines = [
      "ZOU IRBM — KPI Achievement Report",
      "=".repeat(50),
      `Period: ${period}`,
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      "",
      "KPI — Baseline — Target — Actual — Achievement — RAG",
      ...kpis.map((k) => {
        const achievement = Math.round((k.actual / k.target) * 100);
        return `${k.name} — ${k.baseline}${k.unit === "%" ? "%" : ""} — ${k.target}${k.unit === "%" ? "%" : ""} — ${k.actual}${k.unit === "%" ? "%" : ""} — ${achievement}% — ${k.status}`;
      }),
    ];
    const item: ReportItem = {
      id: `r-${Date.now()}`, title: `KPI achievement report — ${period}`, type: "KPI Achievement Report",
      period, generatedAt: new Date().toISOString().slice(0, 10), format: "PDF", content: lines.join("\n"),
    };
    addReport(item);
    return latency(item, 350);
  },

  generateProgrammePerformanceReport: async (period: string): Promise<ReportItem> => {
    const [programmes, kpis] = await Promise.all([programmeService.list(), kpiService.list()]);
    const lines = [
      "ZOU IRBM — Programme Performance Report",
      "=".repeat(50),
      `Period: ${period}`,
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      "",
      "Programme — KPIs — On track — At risk — Off track — Avg achievement",
      ...programmes.map((p) => {
        const pKpis = kpis.filter((k) => k.programmeId === p.id);
        const onTrack = pKpis.filter((k) => k.status === "on-track").length;
        const atRisk = pKpis.filter((k) => k.status === "at-risk").length;
        const offTrack = pKpis.filter((k) => k.status === "off-track").length;
        const avg = pKpis.length ? Math.round(pKpis.reduce((a, k) => a + Math.min(100, (k.actual / k.target) * 100), 0) / pKpis.length) : 0;
        return `${p.code} ${p.name} — ${pKpis.length} — ${onTrack} — ${atRisk} — ${offTrack} — ${avg}%`;
      }),
    ];
    const item: ReportItem = {
      id: `r-${Date.now()}`, title: `Programme performance report — ${period}`, type: "Programme Performance Report",
      period, generatedAt: new Date().toISOString().slice(0, 10), format: "PDF", content: lines.join("\n"),
    };
    addReport(item);
    return latency(item, 350);
  },

  generateComplianceReport: async (period: string): Promise<ReportItem> => {
    const records = await complianceService.list();
    const bySub = Array.from(new Set(records.map((r) => r.subProgramme)));
    const lines = [
      "ZOU IRBM — Submission Compliance Report",
      "=".repeat(50),
      `Period: ${period}`,
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      "",
      "Sub-programme — On time — Late — Missing",
      ...bySub.map((name) => {
        const subset = records.filter((r) => r.subProgramme === name);
        const onTime = subset.filter((r) => r.status === "on-time").length;
        const late = subset.filter((r) => r.status === "late").length;
        const missing = subset.filter((r) => r.status === "missing").length;
        return `${name} — ${onTime} — ${late} — ${missing}`;
      }),
    ];
    const item: ReportItem = {
      id: `r-${Date.now()}`, title: `Submission compliance report — ${period}`, type: "Submission Compliance Report",
      period, generatedAt: new Date().toISOString().slice(0, 10), format: "PDF", content: lines.join("\n"),
    };
    addReport(item);
    return latency(item, 350);
  },
};

export type GeneratableReportType = Extract<ReportType, "KPI Achievement Report" | "Programme Performance Report" | "Submission Compliance Report">;
