import { latency } from "./mockUtils";
import { compliance } from "@/data/compliance";

export const complianceService = {
  list: () => latency(compliance),
};
