import { z } from "zod";

export const staffWeeklyReportSchema = z.object({
  recipientUnitId: z.string().min(1, "Select who this report should go to"),
  weekEnding: z.string().min(1, "Select the week ending date"),
  activitySummary: z.string().min(15, "Describe this week's activity (15+ characters)"),
});
export type StaffWeeklyReportFormValues = z.infer<typeof staffWeeklyReportSchema>;

export const appraiseScoreSchema = z.object({
  score: z.coerce.number().min(0, "Score must be 0 or higher").max(100, "Score cannot exceed 100%"),
  comment: z.string().min(5, "Add a short appraisal comment"),
});
export type AppraiseScoreFormValues = z.infer<typeof appraiseScoreSchema>;
