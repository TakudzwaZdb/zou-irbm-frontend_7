import type { OperationalPlan } from "@/types/appraisal";

export const operationalPlans: OperationalPlan[] = [
  {
    id: "op1",
    unitHeadId: "head-u1", unitHeadName: "Mr. J. Zvomuya", unitId: "u1", unitName: "Infrastructure",
    programmeId: "gov", title: "ICT Infrastructure Operational Plan — Q3 2026", period: "Q3 2026",
    status: "approved", vcApprovedBy: "Prof. E. Mavhu", vcApprovedAt: "2026-07-11",
    archived: true, archivedAt: "2026-07-05", submittedAt: "2026-07-05",
  },
  {
    id: "op2",
    unitHeadId: "head-u4", unitHeadName: "Mrs. A. Dube", unitId: "u4", unitName: "Treasury",
    programmeId: "gov", title: "Treasury Operational Plan — Q3 2026", period: "Q3 2026",
    status: "pending_vc",
    archived: true, archivedAt: "2026-07-10", submittedAt: "2026-07-10",
  },
  {
    id: "op3",
    unitHeadId: "head-u8", unitHeadName: "Prof. E. Mafa", unitId: "u8", unitName: "Faculty of Arts",
    programmeId: "hcd", title: "Faculty of Arts Operational Plan — Q3 2026", period: "Q3 2026",
    status: "approved", vcApprovedBy: "Prof. E. Mavhu", vcApprovedAt: "2026-08-04",
    archived: true, archivedAt: "2026-08-01", submittedAt: "2026-08-01",
  },
  {
    id: "op4",
    unitHeadId: "head-u11", unitHeadName: "Mrs. R. Nyathi", unitId: "u11", unitName: "Mashonaland Regional Campus",
    programmeId: "hcd", title: "Mashonaland Regional Campus Operational Plan — Q3 2026", period: "Q3 2026",
    status: "pending_vc",
    archived: true, archivedAt: "2026-07-15", submittedAt: "2026-07-15",
  },
  {
    id: "op5",
    unitHeadId: "head-u13", unitHeadName: "Dr. L. Mudenda", unitId: "u13", unitName: "Research Grants Office",
    programmeId: "rii", title: "Research Grants Operational Plan — Q3 2026", period: "Q3 2026",
    status: "approved", vcApprovedBy: "Prof. E. Mavhu", vcApprovedAt: "2026-07-20",
    archived: true, archivedAt: "2026-07-15", submittedAt: "2026-07-15",
  },
];
