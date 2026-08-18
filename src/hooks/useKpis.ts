import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kpiService, type KpiFilters } from "@/services/kpiService";
import type { Kpi, WorkflowStatus } from "@/types/kpi";

export const useKpis = (filters?: KpiFilters) =>
  useQuery({ queryKey: ["kpis", filters], queryFn: () => kpiService.list(filters) });

export const useKpi = (id?: string) =>
  useQuery({ queryKey: ["kpi", id], queryFn: () => kpiService.getById(id!), enabled: !!id });

export function useCreateKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof kpiService.create>[0]) => kpiService.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpis"] }),
  });
}

export function useUpdateKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<Kpi> }) => kpiService.update(id, changes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpis"] }),
  });
}

export function useSetKpiWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workflow }: { id: string; workflow: WorkflowStatus }) => kpiService.setWorkflow(id, workflow),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpis"] }),
  });
}

export function useOverrideKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value, reason, user }: { id: string; value: number; reason: string; user: string }) =>
      kpiService.override(id, value, reason, user),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpis"] }),
  });
}
