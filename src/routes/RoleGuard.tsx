import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { DEFAULT_ROUTE } from "@/config/nav";
import type { Role } from "@/types/user";
import type { ReactNode } from "react";

// Wraps a route element and redirects away if the signed-in role isn't
// permitted to see it — sends them to their own relevant landing page
// instead of a generic dashboard, so nobody lands on a blank/denied screen.
export function RoleGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to={DEFAULT_ROUTE[user.role]} replace />;
  return <>{children}</>;
}
