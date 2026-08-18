import { z } from "zod";

export const unitHeadPerformanceSchema = z.object({
  recipient: z.string().min(1, "Select who this report should go to"),
  weekEnding: z.string().min(1, "Select the week ending date"),
  jobSummary: z.string().min(15, "Describe this week's performance (15+ characters)"),
});
export type UnitHeadPerformanceFormValues = z.infer<typeof unitHeadPerformanceSchema>;

export const evaluateScoreSchema = z.object({
  score: z.coerce.number().min(0, "Score must be 0 or higher").max(100, "Score cannot exceed 100%"),
  comment: z.string().min(5, "Add a short evaluation comment"),
});
export type EvaluateScoreFormValues = z.infer<typeof evaluateScoreSchema>;
