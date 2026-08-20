export type ReportType =
  | "Monthly Performance Report" | "Quarterly Performance Report" | "Bi-annual Performance Report"
  | "Annual Performance Report" | "KPI Achievement Report" | "Programme Performance Report"
  | "Sub-programme Performance Report" | "Submission Compliance Report" | "Underperformance Report" | "Audit Report";

export interface ReportItem {
  id: string;
  title: string;
  type: ReportType;
  period: string;
  generatedAt: string;
  format: "PDF" | "XLSX";
  // Present only for reports this app can actually generate from live data
  // (appraisal reports). Seed reports representing a future backend's
  // output (KPI/Programme/Compliance PDFs) have no content behind them yet.
  content?: string;
}
