import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffAppraisalService } from "@/services/staffAppraisalService";
import type { AppraisalStatus } from "@/types/appraisal";

export const useStaffAppraisals = (filters?: { unitId?: string; recipientUnitId?: string; status?: AppraisalStatus; staffId?: string }) =>
  useQuery({ queryKey: ["staffAppraisals", filters], queryFn: () => staffAppraisalService.list(filters) });

export function useSubmitStaffAppraisal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: staffAppraisalService.submit, onSuccess: () => qc.invalidateQueries({ queryKey: ["staffAppraisals"] }) });
}

export function useAppraiseStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, score, comment, appraisedBy }: { id: string; score: number; comment: string; appraisedBy: string }) =>
      staffAppraisalService.appraise(id, score, comment, appraisedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staffAppraisals"] }),
  });
}

export function useReturnStaffAppraisal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => staffAppraisalService.returnForCorrection(id, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staffAppraisals"] }),
  });
}
