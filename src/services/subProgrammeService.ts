import { latency } from "./mockUtils";
import { subProgrammes } from "@/data/organisation";
import type { SubProgramme } from "@/types/organisation";

export const subProgrammeService = {
  list: (programmeId?: string): Promise<SubProgramme[]> =>
    latency(programmeId ? subProgrammes.filter((s) => s.programmeId === programmeId) : subProgrammes),
  getById: (id: string): Promise<SubProgramme | undefined> => latency(subProgrammes.find((s) => s.id === id)),
};
