import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { X, ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { NAV } from "@/config/nav";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/config/roleLabels";
import { initials } from "@/utils/format";
import zouLogo from "@/assets/zou-logo.png";

const COLLAPSE_KEY = "zou_irbm_sidebar_collapsed";
const WIDTH_KEY = "zou_irbm_sidebar_width";
const MIN_WIDTH = 208;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 256;

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  // The sidebar resizes itself entirely from its own drag state — it never
  // reads or writes anything about the main content area's layout. The main
  // content column is a plain `flex-1 min-w-0` in AppLayout, so it reflows
  // on its own the instant the sidebar's width (or the drawer's open/closed
  // state on mobile) changes, with no coordination between the two needed.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (collapsed) return;
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startWidth = asideRef.current?.getBoundingClientRect().width ?? width;
    document.body.classList.add("select-none");

    function handleMove(ev: PointerEvent) {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setWidth(next);
    }
    function handleUp() {
      setDragging(false);
      document.body.classList.remove("select-none");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, width]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <aside
        ref={asideRef}
        style={collapsed ? undefined : { width: `${width}px` }}
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-64 shrink-0 transform flex-col overflow-hidden bg-indigo-950 lg:static lg:translate-x-0 ${
          collapsed ? "lg:w-20" : ""
        } ${dragging ? "" : "transition-[width,transform] duration-200"} ${open ? "translate-x-0" : "-translate-x-full"}`}
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
            <p className="text-base font-extrabold leading-tight tracking-tight text-white">ZOU IRBM</p>
            <p className="text-[11px] font-semibold uppercase tracking-wider leading-tight text-indigo-300">Performance dashboard</p>
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
                {!collapsed && (
                  <p className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-indigo-400">
                    {section.group}
                  </p>
                )}
                <div className="space-y-1">
                  {visibleItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg border-l-[3px] px-3 py-2.5 text-sm font-bold tracking-tight transition-all ${
                          isActive
                            ? "border-indigo-400 bg-indigo-800 text-white shadow-sm"
                            : "border-transparent text-indigo-100 hover:border-indigo-600 hover:bg-indigo-900 hover:text-white"
                        } ${collapsed ? "justify-center" : ""}`
                      }
                    >
                      <item.icon size={17} className="shrink-0" />
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
                  <p className="truncate text-sm font-bold text-white">{user.name}</p>
                  <p className="truncate text-xs text-indigo-300">{ROLE_LABEL[user.role]}</p>
                </div>
              )}
              <button onClick={handleLogout} title="Sign out" aria-label="Sign out" className="shrink-0 text-indigo-400 hover:text-white">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Drag handle — lets someone manually widen ("outwards") or narrow
            ("inwards") the sidebar, independent of any page it's showing.
            Desktop only; hidden on mobile where the sidebar is a fixed-width
            overlay drawer instead. Double-click resets to the default width. */}
        {!collapsed && (
          <div
            onPointerDown={handlePointerDown}
            onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize · double-click to reset"
            className="absolute inset-y-0 -right-1 hidden w-2 cursor-col-resize lg:block"
          >
            <div className={`mx-auto h-full w-px transition-colors ${dragging ? "bg-indigo-400" : "bg-transparent hover:bg-indigo-700"}`} />
          </div>
        )}
      </aside>
    </>
  );
}
