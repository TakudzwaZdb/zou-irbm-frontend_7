import type { Programme, SubProgramme, OrgUnit } from "@/types/organisation";

export const programmes: Programme[] = [
  { id: "gov", code: "P1", name: "Governance & Administration", head: "Prof. T. Mangwiro", description: "Administration, Financial Services, ICT and Governance" },
  { id: "hcd", code: "P2", name: "Human Capital Development", head: "Prof. R. Chikafu", description: "Teaching & Learning, Library & Information Services" },
  { id: "rii", code: "P3", name: "Research, Innovation & Industrialisation", head: "Prof. N. Sithole", description: "Research, Innovation & Enterprises" },
];

export const subProgrammes: SubProgramme[] = [
  { id: "gov-ict", programmeId: "gov", name: "ICT", head: "Mr. K. Moyo" },
  { id: "gov-fin", programmeId: "gov", name: "Financial Services", head: "Mrs. P. Ndlovu" },
  { id: "gov-admin", programmeId: "gov", name: "Administration", head: "Mr. S. Gumbo" },
  { id: "hcd-tl", programmeId: "hcd", name: "Teaching & Learning", head: "Dr. F. Chirwa" },
  { id: "hcd-lib", programmeId: "hcd", name: "Library & Information Services", head: "Mrs. L. Banda" },
  { id: "rii-re", programmeId: "rii", name: "Research & Enterprises", head: "Dr. M. Chuma" },
];

export const orgUnits: OrgUnit[] = [
  { id: "u1", subProgrammeId: "gov-ict", name: "Infrastructure", type: "Directorate", head: "Mr. J. Zvomuya" },
  { id: "u2", subProgrammeId: "gov-ict", name: "Systems Development", type: "Directorate", head: "Ms. C. Mutasa" },
  { id: "u3", subProgrammeId: "gov-ict", name: "Helpdesk", type: "Directorate", head: "Mr. B. Ncube" },
  { id: "u4", subProgrammeId: "gov-fin", name: "Treasury", type: "Directorate", head: "Mrs. A. Dube" },
  { id: "u5", subProgrammeId: "gov-fin", name: "Payroll", type: "Directorate", head: "Mr. W. Sibanda" },
  { id: "u6", subProgrammeId: "gov-admin", name: "Registry", type: "Directorate", head: "Mrs. G. Moyo" },
  { id: "u7", subProgrammeId: "gov-admin", name: "Estates", type: "Directorate", head: "Mr. P. Chirinda" },
  { id: "u8", subProgrammeId: "hcd-tl", name: "Faculty of Arts", type: "Faculty", head: "Prof. E. Mafa" },
  { id: "u9", subProgrammeId: "hcd-tl", name: "Faculty of Science", type: "Faculty", head: "Prof. D. Katsande" },
  { id: "u10", subProgrammeId: "hcd-tl", name: "Faculty of Commerce", type: "Faculty", head: "Prof. S. Muleya" },
  { id: "u11", subProgrammeId: "hcd-lib", name: "Mashonaland Regional Campus", type: "Regional Campus", head: "Mrs. R. Nyathi" },
  { id: "u12", subProgrammeId: "hcd-lib", name: "Matabeleland Regional Campus", type: "Regional Campus", head: "Mr. T. Khumalo" },
  { id: "u13", subProgrammeId: "rii-re", name: "Research Grants Office", type: "Directorate", head: "Dr. L. Mudenda" },
  { id: "u14", subProgrammeId: "rii-re", name: "Innovation Hub", type: "Directorate", head: "Mr. F. Chikomo" },
];
