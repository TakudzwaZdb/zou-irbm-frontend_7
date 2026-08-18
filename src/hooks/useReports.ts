import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportService } from "@/services/reportService";

export const useReports = () => useQuery({ queryKey: ["reports"], queryFn: reportService.list });
export const useExportReport = () =>
  useMutation({ mutationFn: ({ id, format }: { id: string; format: "PDF" | "XLSX" }) => reportService.export(id, format) });

export function useGenerateAppraisalReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tier, quarter }: { tier: import("@/types/appraisal").AppraisalTier; quarter: string }) =>
      reportService.generateAppraisalReport(tier, quarter),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}
