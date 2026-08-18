import { useQuery } from "@tanstack/react-query";
import { strategicPlanService } from "@/services/strategicPlanService";

export const useStrategicGoals = (programmeId?: string) =>
  useQuery({ queryKey: ["strategicGoals", programmeId], queryFn: () => strategicPlanService.list(programmeId) });
