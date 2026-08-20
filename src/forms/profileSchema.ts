import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().min(2, "Enter a full name"),
  email: z.string().email("Enter a valid email address"),
  role: z.enum([
    "staff", "unit_head", "administration", "vc", "council",
    "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict",
  ]),
  stationId: z.string().min(1, "Select a station"),
});
export type ProfileFormValues = z.infer<typeof profileSchema>;
