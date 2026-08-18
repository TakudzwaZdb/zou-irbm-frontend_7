import { useQuery } from "@tanstack/react-query";
import { subProgrammeService } from "@/services/subProgrammeService";

export const useSubProgrammes = (programmeId?: string) =>
  useQuery({ queryKey: ["subProgrammes", programmeId], queryFn: () => subProgrammeService.list(programmeId) });
export const useSubProgramme = (id?: string) =>
  useQuery({ queryKey: ["subProgramme", id], queryFn: () => subProgrammeService.getById(id!), enabled: !!id });
