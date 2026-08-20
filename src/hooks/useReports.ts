import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportService, type GeneratableReportType } from "@/services/reportService";
import type { ReportItem } from "@/types/report";

export const useReports = () => useQuery({ queryKey: ["reports"], queryFn: reportService.list });
export const useExportReport = () =>
  useMutation({ mutationFn: ({ id, format }: { id: string; format: "PDF" | "XLSX" }) => reportService.export(id, format) });

const GENERATORS: Record<GeneratableReportType, (period: string) => Promise<ReportItem>> = {
  "KPI Achievement Report": reportService.generateKpiAchievementReport,
  "Programme Performance Report": reportService.generateProgrammePerformanceReport,
  "Submission Compliance Report": reportService.generateComplianceReport,
};

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, period }: { type: GeneratableReportType; period: string }) => GENERATORS[type](period),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}
