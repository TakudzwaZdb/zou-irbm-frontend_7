export type Role =
  | "staff"
  | "unit_head"
  | "administration"
  | "vc"
  | "council"
  | "programme_head"
  | "subprogramme_head"
  | "subprogramme_rep"
  | "cpu"
  | "ict";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  unit: string;
  status: "active" | "suspended";
  lastLogin: string;
}
