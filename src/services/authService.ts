// Mock auth. Swap the body of login() for a real
// `apiClient.post('/auth/login', credentials)` call when the Laravel API exists —
// the return shape (user + token) is already what that endpoint should return.
import { latency } from "./mockUtils";
import { users } from "@/data/users";
import type { Role, User } from "@/types/user";

export interface LoginResult { user: User; token: string }

const DEMO_PASSWORD = "zou-demo-2026";

export const authService = {
  login: async (email: string, password: string): Promise<LoginResult> => {
    if (password !== DEMO_PASSWORD) {
      await latency(null, 300);
      throw new Error("Invalid email or password.");
    }
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      await latency(null, 300);
      throw new Error("No account found for that email.");
    }
    return latency({ user, token: `mock-token-${user.id}` }, 400);
  },

  loginAsRole: async (role: Role): Promise<LoginResult> => {
    const user = users.find((u) => u.role === role) ?? users[0];
    return latency({ user, token: `mock-token-${user.id}` }, 250);
  },

  logout: async (): Promise<void> => latency(undefined, 150),
};
