import { z } from "zod";

export const operationalPlanSchema = z.object({
  title: z.string().min(5, "Give the plan a clear title"),
  period: z.string().min(1, "Select a reporting period"),
  programmeId: z.string().min(1, "Select the Programme"),
});
export type OperationalPlanFormValues = z.infer<typeof operationalPlanSchema>;
