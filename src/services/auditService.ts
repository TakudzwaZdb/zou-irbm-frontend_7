import { latency } from "./mockUtils";
import { auditLog } from "@/data/auditLog";

export const auditService = {
  list: () => latency(auditLog),
};
