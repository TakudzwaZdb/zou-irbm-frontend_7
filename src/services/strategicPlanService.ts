import { latency } from "./mockUtils";
import { strategicGoals } from "@/data/strategicPlans";

export const strategicPlanService = {
  list: (programmeId?: string) => latency(programmeId ? strategicGoals.filter((g) => g.programmeId === programmeId) : strategicGoals),
};
