import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

// The whole app shell is locked to the viewport height (h-dvh — accounts for
// mobile browser chrome better than 100vh) with overflow hidden at every
// level except the two places that should actually scroll: the sidebar's
// own nav list, and the page content in <main>. Neither the <html>/<body>
// nor this root div ever scrolls, so the sidebar and the current page are
// two independent scroll regions instead of one long document.
export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
