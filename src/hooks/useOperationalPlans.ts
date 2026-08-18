import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationalPlanService } from "@/services/operationalPlanService";
import type { OperationalPlanStatus } from "@/types/appraisal";

export const useOperationalPlans = (filters?: { programmeId?: string; status?: OperationalPlanStatus; unitHeadId?: string }) =>
  useQuery({ queryKey: ["operationalPlans", filters], queryFn: () => operationalPlanService.list(filters) });

export function useSubmitOperationalPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: operationalPlanService.submit, onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }) });
}

export function useApproveOperationalPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approvedBy }: { id: string; approvedBy: string }) => operationalPlanService.approve(id, approvedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }),
  });
}
