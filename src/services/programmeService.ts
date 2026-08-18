import { latency } from "./mockUtils";
import { programmes } from "@/data/organisation";
import type { Programme } from "@/types/organisation";

export const programmeService = {
  list: (): Promise<Programme[]> => latency(programmes),
  getById: (id: string): Promise<Programme | undefined> => latency(programmes.find((p) => p.id === id)),
};
