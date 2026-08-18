import { latency } from "./mockUtils";
import { orgUnits } from "@/data/organisation";
import type { OrgUnit } from "@/types/organisation";

export const unitService = {
  list: (subProgrammeId?: string): Promise<OrgUnit[]> =>
    latency(subProgrammeId ? orgUnits.filter((u) => u.subProgrammeId === subProgrammeId) : orgUnits),
};
