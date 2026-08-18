import { useQuery } from "@tanstack/react-query";
import { programmeService } from "@/services/programmeService";

export const useProgrammes = () => useQuery({ queryKey: ["programmes"], queryFn: programmeService.list });
export const useProgramme = (id?: string) =>
  useQuery({ queryKey: ["programme", id], queryFn: () => programmeService.getById(id!), enabled: !!id });
