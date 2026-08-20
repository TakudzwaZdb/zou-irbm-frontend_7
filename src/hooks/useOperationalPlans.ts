import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationalPlanService } from "@/services/operationalPlanService";
import type { OperationalPlanStatus } from "@/types/appraisal";

export const useOperationalPlans = (filters?: { programmeId?: string; status?: OperationalPlanStatus; unitHeadId?: string }) =>
  useQuery({ queryKey: ["operationalPlans", filters], queryFn: () => operationalPlanService.list(filters) });

export function useSubmitOperationalPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: operationalPlanService.submit, onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }) });
}

export function useApproveByProgrammeHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approvedBy }: { id: string; approvedBy: string }) => operationalPlanService.approveByProgrammeHead(id, approvedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }),
  });
}

export function useApproveByVc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approvedBy }: { id: string; approvedBy: string }) => operationalPlanService.approveByVc(id, approvedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }),
  });
}

export function useValidateByCpu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, validatedBy, budgetComment, feasibilityComment }: { id: string; validatedBy: string; budgetComment: string; feasibilityComment: string }) =>
      operationalPlanService.validateByCpu(id, validatedBy, budgetComment, feasibilityComment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }),
  });
}

export function useRejectOperationalPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage, rejectedBy, reason }: { id: string; stage: import("@/types/appraisal").ApprovalStage; rejectedBy: string; reason: string }) =>
      operationalPlanService.reject(id, stage, rejectedBy, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }),
  });
}

export function useResubmitOperationalPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resubmittedBy }: { id: string; resubmittedBy: string }) => operationalPlanService.resubmit(id, resubmittedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operationalPlans"] }),
  });
}
