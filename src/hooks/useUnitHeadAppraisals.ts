import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unitHeadAppraisalService } from "@/services/unitHeadAppraisalService";
import type { AppraisalStatus } from "@/types/appraisal";

export const useUnitHeadAppraisals = (filters?: { unitId?: string; status?: AppraisalStatus }) =>
  useQuery({ queryKey: ["unitHeadAppraisals", filters], queryFn: () => unitHeadAppraisalService.list(filters) });

export function useSubmitUnitHeadAppraisal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: unitHeadAppraisalService.submit, onSuccess: () => qc.invalidateQueries({ queryKey: ["unitHeadAppraisals"] }) });
}

export function useEvaluateUnitHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, score, comment, evaluatedBy }: { id: string; score: number; comment: string; evaluatedBy: string }) =>
      unitHeadAppraisalService.evaluate(id, score, comment, evaluatedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["unitHeadAppraisals"] }),
  });
}
