import { z } from "zod";

export const reviewSchema = z.object({
  comment: z.string().optional(),
});
export type ReviewFormValues = z.infer<typeof reviewSchema>;
