import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { X, ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { NAV } from "@/config/nav";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/config/roleLabels";
import { initials } from "@/utils/format";
import zouLogo from "@/assets/zou-logo.png";

const COLLAPSE_KEY = "zou_irbm_sidebar_collapsed";

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 transform flex-col bg-indigo-950 transition-all duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-20" : ""}`}
      >
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          {collapsed ? (
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1">
              <img src={zouLogo} alt="ZOU" className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="min-w-0 flex-1 rounded-lg bg-white p-2">
              <img src={zouLogo} alt="Zimbabwe Open University" className="h-auto w-full" />
            </div>
          )}
          <button onClick={onClose} className="text-indigo-300 lg:hidden" aria-label="Close menu"><X size={18} /></button>
        </div>

        {!collapsed && (
          <div className="px-5 pb-3">
            <p className="text-sm font-bold leading-tight text-white">ZOU IRBM</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide leading-tight text-indigo-400">Performance dashboard</p>
          </div>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="mx-4 mb-3 hidden items-center justify-center gap-1.5 rounded-lg border border-indigo-800 py-1.5 text-[10px] font-medium text-indigo-300 transition-colors hover:bg-indigo-900 hover:text-white lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight size={13} /> : (<><ChevronsLeft size={13} /> Collapse</>)}
        </button>

        <nav className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {NAV.map((section) => {
            const visibleItems = section.items.filter((item) => !role || item.roles.includes(role));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.group}>
                {!collapsed && <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wide text-indigo-400">{section.group}</p>}
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg border-l-[3px] px-2.5 py-2 text-xs font-bold transition-colors ${
                          isActive ? "border-indigo-400 bg-indigo-800 text-white" : "border-transparent text-indigo-200 hover:bg-indigo-900 hover:text-white"
                        } ${collapsed ? "justify-center" : ""}`
                      }
                    >
                      <item.icon size={15} className="shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {user && (
          <div className="border-t border-indigo-900 p-3">
            <div className={`flex items-center gap-2.5 rounded-lg px-1 py-1.5 ${collapsed ? "justify-center" : ""}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-700 text-[11px] font-medium text-white" title={collapsed ? user.name : undefined}>
                {initials(user.name)}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">{user.name}</p>
                  <p className="truncate text-[10px] text-indigo-400">{ROLE_LABEL[user.role]}</p>
                </div>
              )}
              <button onClick={handleLogout} title="Sign out" aria-label="Sign out" className="shrink-0 text-indigo-400 hover:text-white">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
