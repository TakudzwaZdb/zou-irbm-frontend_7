import { latency } from "./mockUtils";
import { alerts as seed } from "@/data/alerts";
import { loadStore, saveStore } from "@/utils/persistedStore";
import type { Alert } from "@/types/alert";

const KEY = "zou_irbm_store_alerts";
let store: Alert[] = loadStore(KEY, seed);
let counter = store.length;

export const alertService = {
  list: (): Promise<Alert[]> => latency(store),

  acknowledge: (id: string): Promise<Alert> => {
    store = store.map((a) => (a.id === id ? { ...a, acknowledged: true } : a));
    saveStore(KEY, store);
    return latency(store.find((a) => a.id === id)!);
  },

  // Called by other services when something alert-worthy happens (a plan
  // gets rejected, a KPI misses target repeatedly, etc).
  append: (alert: Omit<Alert, "id" | "createdAt" | "acknowledged">): Alert => {
    counter += 1;
    const created: Alert = { ...alert, id: `al${counter}`, createdAt: new Date().toISOString().slice(0, 10), acknowledged: false };
    store = [created, ...store];
    saveStore(KEY, store);
    return created;
  },
};
