import { z } from "zod";

export const performanceSubmissionSchema = z.object({
  kpiId: z.string().min(1, "Select a KPI"),
  period: z.string().min(1, "Select a reporting period"),
  actual: z.coerce.number().min(0, "Enter the actual value achieved"),
  explanation: z.string().min(10, "Provide at least a short explanation (10+ characters)"),
  evidenceFileName: z.string().optional(),
});
export type PerformanceSubmissionFormValues = z.infer<typeof performanceSubmissionSchema>;
