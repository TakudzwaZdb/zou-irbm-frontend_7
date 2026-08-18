import { z } from "zod";

export const kpiSchema = z
  .object({
    name: z.string().min(3, "KPI name must be at least 3 characters"),
    type: z.enum(["output", "outcome"]),
    unit: z.enum(["%", "count", "number"]),
    programmeId: z.string().min(1, "Select a Programme"),
    subProgrammeId: z.string().min(1, "Select a Sub-programme"),
    unitId: z.string().min(1, "Select a Unit"),
    baseline: z.coerce.number().min(0, "Baseline must be 0 or greater"),
    target: z.coerce.number().min(0, "Target must be 0 or greater"),
    q1Target: z.coerce.number().min(0, "Must be 0 or greater").optional(),
    q2Target: z.coerce.number().min(0, "Must be 0 or greater").optional(),
    q3Target: z.coerce.number().min(0, "Must be 0 or greater").optional(),
    q4Target: z.coerce.number().min(0, "Must be 0 or greater").optional(),
    reportingFrequency: z.enum(["monthly", "quarterly", "bi-annual", "annual"]),
    dataSource: z.string().min(2, "Describe where this data comes from"),
    owner: z.string().min(2, "Assign a responsible owner"),
  })
  .refine((data) => data.target > data.baseline, {
    message: "Target must be greater than baseline",
    path: ["target"],
  });

export type KpiFormValues = z.infer<typeof kpiSchema>;
