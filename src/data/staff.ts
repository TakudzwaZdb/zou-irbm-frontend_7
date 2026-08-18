export interface StaffMember {
  id: string;
  name: string;
  unitId: string;
  role: string;
}

export const staffMembers: StaffMember[] = [
  { id: "st1", name: "T. Marufu", unitId: "u1", role: "Network Technician" },
  { id: "st2", name: "N. Chapfika", unitId: "u1", role: "Systems Officer" },
  { id: "st3", name: "R. Museva", unitId: "u2", role: "Developer" },
  { id: "st4", name: "C. Dzingirai", unitId: "u3", role: "Helpdesk Agent" },
  { id: "st5", name: "B. Mutasa", unitId: "u4", role: "Accounts Officer" },
  { id: "st6", name: "S. Chikanga", unitId: "u6", role: "Registry Clerk" },
  { id: "st7", name: "P. Nleya", unitId: "u8", role: "Faculty Administrator" },
  { id: "st8", name: "M. Gwatidzo", unitId: "u11", role: "Campus Librarian" },
  { id: "st9", name: "L. Chirara", unitId: "u13", role: "Grants Officer" },
];
