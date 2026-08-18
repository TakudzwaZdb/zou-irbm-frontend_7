import { latency } from "./mockUtils";
import { staffAppraisalService } from "./staffAppraisalService";
import { unitHeadAppraisalService } from "./unitHeadAppraisalService";
import { computeQuarterlyAverages, availableQuarters } from "@/utils/quarterlyAnalytics";
import type { QuarterlyAppraisalSummary } from "@/types/appraisal";

export const analyticsService = {
  // Runs the analytics engine on demand in this mock layer. In production
  // this would fetch a precomputed row from a scheduled Laravel job instead
  // of recalculating — same call signature either way.
  getQuarterlySummaries: async (quarter: string): Promise<QuarterlyAppraisalSummary[]> => {
    const [staff, unitHeads] = await Promise.all([staffAppraisalService.list(), unitHeadAppraisalService.list()]);
    return latency(computeQuarterlyAverages(staff, unitHeads, quarter), 300);
  },

  getAvailableQuarters: async (): Promise<string[]> => {
    const [staff, unitHeads] = await Promise.all([staffAppraisalService.list(), unitHeadAppraisalService.list()]);
    return latency(availableQuarters(staff, unitHeads));
  },
};
