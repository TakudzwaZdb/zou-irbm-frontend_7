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
  // References an OrgUnit id — the person's "station": a Faculty,
  // Directorate, Regional Campus, or Department. Optional because existing
  // seed accounts predate this field; anyone can set it from their Profile.
  stationId?: string;
  status: "active" | "suspended";
  lastLogin: string;
}
