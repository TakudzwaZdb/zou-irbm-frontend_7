import type { Role } from "@/types/user";

export const ROLE_LABEL: Record<Role, string> = {
  vc: "Vice-Chancellor",
  council: "University Council",
  programme_head: "Programme Head",
  subprogramme_head: "Sub-programme Head",
  subprogramme_rep: "Sub-programme Rep",
  cpu: "Corporate Planning Unit",
  ict: "ICT Administrator",
};
