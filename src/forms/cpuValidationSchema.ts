import { z } from "zod";

export const cpuValidationSchema = z.object({
  budgetComment: z.string().min(10, "Assess budget alignment (10+ characters)"),
  feasibilityComment: z.string().min(10, "Assess feasibility (10+ characters)"),
});
export type CpuValidationFormValues = z.infer<typeof cpuValidationSchema>;
