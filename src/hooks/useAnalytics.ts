import { useQuery } from "@tanstack/react-query";
import { analyticsService } from "@/services/analyticsService";

export const useAvailableQuarters = () => useQuery({ queryKey: ["quarters"], queryFn: analyticsService.getAvailableQuarters });
export const useQuarterlySummaries = (quarter?: string) =>
  useQuery({ queryKey: ["quarterlySummaries", quarter], queryFn: () => analyticsService.getQuarterlySummaries(quarter!), enabled: !!quarter });
