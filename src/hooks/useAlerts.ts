import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alertService } from "@/services/alertService";

export const useAlerts = () => useQuery({ queryKey: ["alerts"], queryFn: alertService.list });

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: alertService.acknowledge,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}
