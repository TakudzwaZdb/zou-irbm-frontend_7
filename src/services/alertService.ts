import { latency } from "./mockUtils";
import { alerts as seedAlerts } from "@/data/alerts";
import type { Alert } from "@/types/alert";

let store: Alert[] = [...seedAlerts];

export const alertService = {
  list: (): Promise<Alert[]> => latency(store),
  acknowledge: (id: string): Promise<Alert> => {
    store = store.map((a) => (a.id === id ? { ...a, acknowledged: true } : a));
    return latency(store.find((a) => a.id === id)!);
  },
};
