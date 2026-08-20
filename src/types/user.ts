// Three-tier access model per the questionnaire (Q21): Council & VC
// (read-only executive), Sub-programme Representatives (data entry), CPU &
// ICT (full admin, including framework structure edits). Programme Head and
// Sub-programme Head are added because Q16's cascading target-setting
// workflow requires them as distinct actors, not because of anything
// outside this questionnaire.
export type Role =
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
