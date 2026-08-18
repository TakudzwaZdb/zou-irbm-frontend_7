import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { DEFAULT_ROUTE } from "@/config/nav";

// Sends a signed-in user to the page relevant to their role instead of a
// one-size-fits-all dashboard. Used for "/" and unmatched routes.
export function DefaultRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={DEFAULT_ROUTE[user.role]} replace />;
}
