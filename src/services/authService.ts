// Mock auth. Swap the bodies of login()/register() for real
// `apiClient.post('/auth/login', ...)` / `apiClient.post('/auth/register', ...)`
// calls when the Laravel API exists — the return shape (user + token) is
// already what those endpoints should return.
import { latency } from "./mockUtils";
import { userService } from "./userService";
import { alertService } from "./alertService";
import type { Role, User } from "@/types/user";

export interface LoginResult { user: User; token: string }

// Seed accounts all share this password until someone sets their own by
// registering; newly registered accounts get a real per-account password.
// A per-email map, not a single shared constant, is what makes "the login
// is the work email + password" actually mean something once real
// registration exists.
const DEFAULT_PASSWORD = "zou-demo-2026";
const CREDENTIALS_KEY = "zou_irbm_credentials";

function loadCredentials(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    // corrupted/unavailable — fall through
  }
  return {};
}
let credentials = loadCredentials();

function saveCredentials() {
  try {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch {
    // storage full/unavailable — this session's password just won't persist
  }
}

function expectedPasswordFor(workEmail: string): string {
  return credentials[workEmail.toLowerCase()] ?? DEFAULT_PASSWORD;
}

export const authService = {
  login: async (workEmail: string, password: string): Promise<LoginResult> => {
    // Reads the live, persisted user store — not the static seed data — so
    // a newly registered account can actually sign in with it.
    const users = await userService.list();
    const user = users.find((u) => u.email.toLowerCase() === workEmail.toLowerCase());
    if (!user) {
      await latency(null, 300);
      throw new Error("No account found for that work email.");
    }
    if (password !== expectedPasswordFor(user.email)) {
      await latency(null, 300);
      throw new Error("Incorrect password for that work email.");
    }
    if (user.status === "pending") {
      await latency(null, 300);
      throw new Error("Your registration is still pending approval from the Corporate Planning Unit.");
    }
    if (user.status === "rejected") {
      await latency(null, 300);
      throw new Error("This registration was declined. Contact the Corporate Planning Unit for details.");
    }
    if (user.status === "suspended") {
      await latency(null, 300);
      throw new Error("This account has been suspended. Contact the Corporate Planning Unit.");
    }
    return latency({ user, token: `mock-token-${user.id}` }, 400);
  },

  loginAsRole: async (role: Role): Promise<LoginResult> => {
    const users = await userService.list();
    const user = users.find((u) => u.role === role && u.status === "active") ?? users.find((u) => u.status === "active") ?? users[0];
    return latency({ user, token: `mock-token-${user.id}` }, 250);
  },

  // Self-registration for someone not yet in the system. The account is
  // created "pending" — it cannot log in until CPU/ICT approves it from
  // Users & Roles — so this does NOT return a usable session. Their work
  // email becomes their login going forward, alongside the password they
  // choose here.
  register: async (
    payload: { name: string; email: string; role: Role; stationId: string; unit: string },
    password: string
  ): Promise<User> => {
    const existing = await userService.list();
    if (existing.some((u) => u.email.toLowerCase() === payload.email.toLowerCase())) {
      await latency(null, 300);
      throw new Error("An account with that work email already exists — sign in instead.");
    }
    const created = await userService.create(payload, "Self-registration", "pending");
    credentials[payload.email.toLowerCase()] = password;
    saveCredentials();
    alertService.append({
      kpiId: created.id, kpiName: created.name, subProgramme: payload.unit,
      type: "pending_approval", level: "info",
      message: `${created.name} registered as ${payload.role} and is awaiting account approval.`,
      escalationStep: "Corporate Planning Unit", emailSent: false,
    });
    return latency(created, 500);
  },

  logout: async (): Promise<void> => latency(undefined, 150),
};
