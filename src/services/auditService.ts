import { latency } from "./mockUtils";
import { auditLog as seed } from "@/data/auditLog";
import { loadStore, saveStore } from "@/utils/persistedStore";
import type { AuditEntry } from "@/types/audit";

const KEY = "zou_irbm_store_auditLog";
let store: AuditEntry[] = loadStore(KEY, seed);
let counter = store.length;

export const auditService = {
  list: () => latency(store),

  // Called by other services after a real action happens (submit, approve,
  // reject, override, evaluate...) so the audit trail reflects live
  // activity instead of staying frozen at seed data.
  append: (entry: Omit<AuditEntry, "id" | "timestamp" | "device">): AuditEntry => {
    counter += 1;
    const created: AuditEntry = {
      ...entry,
      id: `a${counter}`,
      timestamp: new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      device: "Web session",
    };
    store = [created, ...store];
    saveStore(KEY, store);
    return created;
  },
};
