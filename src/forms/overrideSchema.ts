import { z } from "zod";

export const overrideSchema = z.object({
  overrideValue: z.coerce.number().min(0, "Enter the override value"),
  reason: z.string().min(10, "Explain why this override is necessary (10+ characters)"),
});
export type OverrideFormValues = z.infer<typeof overrideSchema>;
