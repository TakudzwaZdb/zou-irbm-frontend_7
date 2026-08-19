import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { performanceService } from "@/services/performanceService";
import type { WorkflowStatus } from "@/types/kpi";

export const useSubmissions = (status?: WorkflowStatus) =>
  useQuery({ queryKey: ["submissions", status], queryFn: () => performanceService.list(status) });

export function useSubmitPerformance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: performanceService.submit,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["submissions"] }),
  });
}

export function useDecideSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: "approved" | "rejected" | "returned"; comment?: string }) =>
      performanceService.decide(id, decision, comment ?? ""),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["submissions"] }),
  });
}
