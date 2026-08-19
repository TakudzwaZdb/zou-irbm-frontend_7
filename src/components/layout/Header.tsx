import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, Search, Bell, ChevronDown, LogOut, Sun, Moon, Target, Building2, FileText, X, UserCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useAlerts } from "@/hooks/useAlerts";
import { useKpis } from "@/hooks/useKpis";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useReports } from "@/hooks/useReports";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { ROLE_LABEL } from "@/config/roleLabels";
import { initials } from "@/utils/format";

interface SearchResult { id: string; label: string; sub: string; to: string; icon: typeof Target }

function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: kpis = [] } = useKpis();
  const { data: programmes = [] } = useProgrammes();
  const { data: reports = [] } = useReports();

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return [
      ...kpis.filter((k) => k.name.toLowerCase().includes(q)).slice(0, 4).map((k) => ({ id: k.id, label: k.name, sub: "KPI", to: `/kpis/${k.id}`, icon: Target })),
      ...programmes.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 3).map((p) => ({ id: p.id, label: p.name, sub: "Programme", to: `/programmes/${p.id}`, icon: Building2 })),
      ...reports.filter((r) => r.title.toLowerCase().includes(q)).slice(0, 3).map((r) => ({ id: r.id, label: r.title, sub: "Report", to: "/reports", icon: FileText })),
    ].slice(0, 8);
  }, [query, kpis, programmes, reports]);

  function go(to: string) {
    navigate(to);
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }

  return (
    <div className="relative hidden sm:block">
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
        <Search size={14} className="text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => e.key === "Escape" && (setQuery(""), inputRef.current?.blur())}
          placeholder="Search KPIs, programmes, reports…"
          className="w-64 bg-transparent text-xs text-slate-600 outline-none placeholder:text-slate-400 dark:text-slate-300"
        />
        {query && (
          <button onClick={() => setQuery("")} className="text-slate-300 hover:text-slate-500" aria-label="Clear search"><X size={12} /></button>
        )}
      </div>

      {focused && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {results.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-xs text-slate-400">No matches for &ldquo;{query}&rdquo;</p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.sub}-${r.id}`}
                onMouseDown={() => go(r.to)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <r.icon size={13} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">{r.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{r.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { data: alerts } = useAlerts();
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = (alerts ?? []).filter((a) => !a.acknowledged).length;

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
      <div className="flex items-center gap-3">
        <button onClick={onMenuClick} className="text-slate-500 dark:text-slate-400 lg:hidden" aria-label="Open menu"><Menu size={20} /></button>
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <div className="relative">
          <button onClick={() => setNotifOpen((o) => !o)} className="relative rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" aria-label="Notifications">
            <Bell size={17} />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-medium text-white">{unread}</span>}
          </button>
          {notifOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Recent alerts</p>
              {(alerts ?? []).slice(0, 4).map((a) => (
                <div key={a.id} className="rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.kpiName}</p>
                  <p className="text-[11px] text-slate-400">{a.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                {user ? initials(user.name) : "—"}
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-xs font-medium leading-tight text-slate-700 dark:text-slate-200">{user?.name}</p>
                <p className="text-[10px] leading-tight text-slate-400">{user ? ROLE_LABEL[user.role] : ""}</p>
              </div>
              <ChevronDown size={14} className="hidden text-slate-400 sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate("/profile")} className="flex items-center gap-2">
              <UserCircle2 size={13} /> My profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2 text-rose-600">
              <LogOut size={13} /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
