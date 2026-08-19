import { createContext, useContext, useState, type ReactNode } from "react";
import { authService } from "@/services/authService";
import { auditService } from "@/services/auditService";
import { ROLE_LABEL } from "@/config/roleLabels";
import type { Role, User } from "@/types/user";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isRestoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginAsRole: (role: Role) => Promise<void>;
  logout: () => Promise<void>;
  updateCurrentUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const USER_KEY = "zou_irbm_user";
const TOKEN_KEY = "zou_irbm_token";

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const token = localStorage.getItem(TOKEN_KEY);
    if (!raw || !token) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Rehydrate synchronously from localStorage so a page refresh doesn't
  // bounce the user back to /login while a session token is still valid.
  const [user, setUser] = useState<User | null>(readStoredUser);

  function persist(user: User, token: string) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    setUser(user);
    auditService.append({ user: user.name, role: ROLE_LABEL[user.role], action: "logged in", module: "Authentication", record: "Session start", previousValue: null, newValue: null });
  }

  async function login(email: string, password: string) {
    const { user, token } = await authService.login(email, password);
    persist(user, token);
  }

  async function loginAsRole(role: Role) {
    const { user, token } = await authService.loginAsRole(role);
    persist(user, token);
  }

  async function logout() {
    await authService.logout();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  // Called after a successful Profile save so the header, sidebar footer,
  // and every place that reads `user` reflect the change immediately —
  // without this, editing your name or role would only show up after
  // logging out and back in.
  function updateCurrentUser(patch: Partial<User>) {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isRestoring: false, login, loginAsRole, logout, updateCurrentUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
