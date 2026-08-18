import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsService } from "@/services/settingsService";
import type { RagThresholds } from "@/utils/ragStatus";

export const useThresholds = () => useQuery({ queryKey: ["ragThresholds"], queryFn: settingsService.getThresholds });

export function useUpdateThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (thresholds: RagThresholds) => settingsService.setThresholds(thresholds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ragThresholds"] });
      // Every KPI's status depends on these thresholds — refresh anywhere it's shown.
      qc.invalidateQueries({ queryKey: ["kpis"] });
      qc.invalidateQueries({ queryKey: ["kpi"] });
    },
  });
}
