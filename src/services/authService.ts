// Mock auth. Swap the body of login() for a real
// `apiClient.post('/auth/login', credentials)` call when the Laravel API
// exists — the return shape (user + token) is already what that endpoint
// should return.
import { latency } from "./mockUtils";
import { userService } from "./userService";
import type { Role, User } from "@/types/user";

export interface LoginResult { user: User; token: string }

const DEMO_PASSWORD = "zou-demo-2026";

export const authService = {
  login: async (workEmail: string, password: string): Promise<LoginResult> => {
    if (password !== DEMO_PASSWORD) {
      await latency(null, 300);
      throw new Error("Invalid work email or password.");
    }
    // Reads the live, persisted user store — not static seed data — so an
    // account registered by an admin from Users & Roles can sign in too.
    const users = await userService.list();
    const user = users.find((u) => u.email.toLowerCase() === workEmail.toLowerCase());
    if (!user) {
      await latency(null, 300);
      throw new Error("No account found for that work email.");
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

  logout: async (): Promise<void> => latency(undefined, 150),
};
