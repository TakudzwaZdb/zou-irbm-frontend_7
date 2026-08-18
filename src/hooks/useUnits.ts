import { useQuery } from "@tanstack/react-query";
import { unitService } from "@/services/unitService";

export const useUnits = (subProgrammeId?: string) =>
  useQuery({ queryKey: ["units", subProgrammeId], queryFn: () => unitService.list(subProgrammeId) });
