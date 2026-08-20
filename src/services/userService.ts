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

  // Registration — used both by a self-service Profile page (registering
  // your own account details) and by admins creating accounts for others
<<<<<<< HEAD
  // from Users & Roles. `status` defaults to "active" (an admin creating
  // the account already is the approval); self-registration explicitly
  // passes "pending" instead.
  create: (payload: Omit<User, "id" | "status" | "lastLogin">, createdBy: string, status: User["status"] = "active"): Promise<User> => {
    const created: User = { ...payload, id: `u-${Date.now()}`, status, lastLogin: "Never" };
    store = [created, ...store];
    persist();
    auditService.append({ user: createdBy, role: "Administrator", action: "created", module: "User Management", record: `${created.name} (${created.email})`, previousValue: null, newValue: status === "pending" ? "pending approval" : created.role });
=======
  // from Users & Roles.
  create: (payload: Omit<User, "id" | "status" | "lastLogin">, createdBy: string): Promise<User> => {
    const created: User = { ...payload, id: `u-${Date.now()}`, status: "active", lastLogin: "Never" };
    store = [created, ...store];
    persist();
    auditService.append({ user: createdBy, role: "Administrator", action: "created", module: "User Management", record: `${created.name} (${created.email})`, previousValue: null, newValue: created.role });
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
    return latency(created);
  },

  update: (id: string, changes: Partial<User>, updatedBy: string): Promise<User> => {
    const before = store.find((u) => u.id === id);
    store = store.map((u) => (u.id === id ? { ...u, ...changes } : u));
    persist();
    if (before) auditService.append({ user: updatedBy, role: "Account holder", action: "edited", module: "User Profile", record: `${before.name} (${before.email})`, previousValue: before.role, newValue: changes.role ?? before.role });
    return latency(store.find((u) => u.id === id)!);
  },
<<<<<<< HEAD

  approve: (id: string, approvedBy: string): Promise<User> => {
    const before = store.find((u) => u.id === id);
    store = store.map((u) => (u.id === id ? { ...u, status: "active" as const, statusReason: undefined } : u));
    persist();
    if (before) auditService.append({ user: approvedBy, role: "Administrator", action: "approved", module: "User Management", record: `${before.name} (${before.email})`, previousValue: "pending", newValue: "active" });
    return latency(store.find((u) => u.id === id)!);
  },

  reject: (id: string, rejectedBy: string, reason: string): Promise<User> => {
    const before = store.find((u) => u.id === id);
    store = store.map((u) => (u.id === id ? { ...u, status: "rejected" as const, statusReason: reason } : u));
    persist();
    if (before) auditService.append({ user: rejectedBy, role: "Administrator", action: "rejected", module: "User Management", record: `${before.name} (${before.email})`, previousValue: "pending", newValue: "rejected", reason });
    return latency(store.find((u) => u.id === id)!);
  },
=======
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
};
