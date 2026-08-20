import { latency } from "./mockUtils";
import { users as seed } from "@/data/users";
import { loadStore, saveStore } from "@/utils/persistedStore";
import { auditService } from "./auditService";
import type { User } from "@/types/user";

const KEY = "zou_irbm_store_users";
let store: User[] = loadStore(KEY, seed);

function persist() {
  saveStore(KEY, store);
}

export const userService = {
  list: (): Promise<User[]> => latency(store),
  getById: (id: string): Promise<User | undefined> => latency(store.find((u) => u.id === id)),

  create: (payload: Omit<User, "id" | "status" | "lastLogin">, createdBy: string): Promise<User> => {
    const created: User = { ...payload, id: `u-${Date.now()}`, status: "active", lastLogin: "Never" };
    store = [created, ...store];
    persist();
    auditService.append({ user: createdBy, role: "Administrator", action: "created", module: "User Management", record: `${created.name} (${created.email})`, previousValue: null, newValue: created.role });
    return latency(created);
  },

  update: (id: string, changes: Partial<User>, updatedBy: string): Promise<User> => {
    const before = store.find((u) => u.id === id);
    store = store.map((u) => (u.id === id ? { ...u, ...changes } : u));
    persist();
    if (before) auditService.append({ user: updatedBy, role: "Account holder", action: "edited", module: "User Profile", record: `${before.name} (${before.email})`, previousValue: before.role, newValue: changes.role ?? before.role });
    return latency(store.find((u) => u.id === id)!);
  },
};
