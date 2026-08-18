export interface Programme {
  id: string;
  code: string;
  name: string;
  head: string;
  description: string;
}

export interface SubProgramme {
  id: string;
  programmeId: string;
  name: string;
  head: string;
}

export type OrgUnitType = "Faculty" | "Directorate" | "Regional Campus" | "Department";

export interface OrgUnit {
  id: string;
  subProgrammeId: string;
  name: string;
  type: OrgUnitType;
  head: string;
}
