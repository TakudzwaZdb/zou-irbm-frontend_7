import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { currentNav, NAV_ITEMS } from '../lib/nav.js';
import { avatarClass, initialsOf, ROLE_LABEL } from '../lib/scope.js';
import AlertsBell from './AlertsBell.jsx';
import LiveIndicator from './LiveIndicator.jsx';
import OrgTree from './OrgTree.jsx';
import SoundToggle from './SoundToggle.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const SCOPED_ROLES = ['rep', 'unithead', 'individual', 'programme'];

// A one-time welcome, not a toast: Layout only ever mounts once a user is
// actually signed in (App.jsx renders <Login/> in their place otherwise),
// so a mount-only effect here fires exactly once per sign-in — never again
// while they navigate around the app — and unmounts (and can fire again)
// the next time someone signs in, since signing out drops back to <Login/>
// and unmounts this whole tree. Keyed by user.id so the 10s window always
// restarts fresh for whoever just signed in, even in the unlikely case this
// component were ever reused across two different accounts without a full
// unmount in between.
function GreetingBanner({ name }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 10000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div
      role="status"
      className="fixed top-[78px] left-1/2 -translate-x-1/2 z-50 rounded-full bg-ink text-page text-[13px] font-semibold px-4 py-2 shadow-lg animate-[fadeIn_.25s_ease]"
    >
      Welcome back, {name}
    </div>
  );
}

export default function Layout({ route, setRoute, children }) {
  const { user, logout, unreadMessages } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { hasPerm } = useApp();
  const nav = currentNav(user, hasPerm);
  // The org tree is always available to a global role (cpu/exec/ictadmin —
  // they can look anywhere) but, for a scoped role, only while they're on
  // Overview — it's a way of drilling into *their own* structure to see
  // it, not a general-purpose nav item competing with My Data Entry etc.
  const showTree = !SCOPED_ROLES.includes(user.role) || route === 'overview';

  // Belt-and-braces for mobile: with the shell now locked to h-dvh (see
  // below) the document itself shouldn't scroll at all, but iOS Safari in
  // particular can still rubber-band the whole page on a touch drag that
  // starts over the backdrop. Blocking body scroll only while the overlay
  // sidebar is open makes sure that drag always scrolls the sidebar list
  // it's over, never the page underneath it.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [sidebarOpen]);

  return (
    // A hard-capped h-dvh + overflow-hidden shell, not min-h-dvh: with only
    // a *minimum* height, this wrapper used to grow taller than the
    // viewport whenever either the sidebar or the page content ran long,
    // which put a second, page-level scrollbar in play alongside the
    // sidebar's and main's own — on mobile that reads as janky, scroll
    // events fighting each other. Locking the shell to exactly the
    // viewport height means header stays put and the two overflow-y-auto
    // regions below (the sidebar `nav` and `main`) are the ONLY things
    // that ever scroll, fully independently of one another.
    <div className="h-dvh flex flex-col overflow-hidden bg-sunken">
      <GreetingBanner key={user.id} name={user.name} />
      <header className="no-print h-16 flex-none flex items-center gap-3 sm:gap-3.5 px-3 sm:px-4 border-b border-line bg-surface">
        <button
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg border border-line-strong flex-none"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Menu"
          aria-haspopup="true"
          aria-expanded={sidebarOpen}
        ><span aria-hidden="true">☰</span></button>
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          {/* The FULL ZOU logo — crest + "Zimbabwe Open University" wordmark
              + tagline, the same lockup the Login screen uses — not just the
              crest cropped out of it, from sm: up where there's room for it.
              w-auto (no fixed width) lets its own ~6.9:1 aspect ratio decide
              the width, so it always renders complete, never stretched or
              edge-clipped. The wordmark's dark ink sits on a transparent
              background in the source file, so a light plate behind it
              (rather than the header's own bg-surface, which turns dark in
              dark mode) is what keeps it legible in both themes — the exact
              same white the Login card already provides it for free. Below
              sm, the full lockup's ~200px width would crowd out the
              hamburger and the header's own action icons on a phone, so a
              narrow viewport keeps just the compact crest instead. */}
          <span className="hidden sm:flex items-center bg-white border border-line rounded-lg px-2 py-1 flex-none">
            <img src="/assets/zou-logo.png" alt="Zimbabwe Open University" className="h-7 w-auto object-contain" />
          </span>
          <img src="/assets/zou-mark.png" alt="Zimbabwe Open University" className="sm:hidden h-10 w-auto object-contain flex-none" />
          <span className="hidden sm:block w-px self-stretch bg-line" aria-hidden="true" />
          <div className="leading-tight min-w-0">
            <div className="font-display font-extrabold text-[15.5px] truncate">Strategic Plan Monitor</div>
            <div className="text-[11.5px] text-ink-secondary truncate">IRBM Monitoring &amp; Evaluation</div>
          </div>
        </div>
        <div className="flex-1" />
        <LiveIndicator />
        <SoundToggle />
        <ThemeToggle />
        <AlertsBell setRoute={setRoute} />
        <button
          className="hidden sm:flex items-center gap-2 rounded-full bg-sunken border border-line pr-2.5 pl-1 py-1 hover:bg-sunken/70 transition-colors"
          onClick={() => setRoute('profile')}
          title="My Profile"
        >
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-[30px] h-[30px] rounded-full object-cover flex-none" />
          ) : (
            <span className={`w-[30px] h-[30px] rounded-full flex items-center justify-center text-[11.5px] font-bold flex-none ${avatarClass(user.id)}`}>
              {initialsOf(user.name)}
            </span>
          )}
          <div className="leading-tight min-w-0 text-left">
            <div className="text-[12.5px] font-bold truncate max-w-[180px] flex items-center gap-1.5">
              <span className="truncate">{user.name}</span>
              {user.is_executive_owner && (
                <span className="chip bg-accent-500 text-white text-[9px] px-1.5 py-0.5 flex-none" title="Accountable for overall institutional performance against the Plan">
                  Executive Owner
                </span>
              )}
            </div>
            <div className="text-[10.8px] text-ink-secondary truncate max-w-[180px]">{user.title || user.role}</div>
          </div>
        </button>
        <button className="btn btn-sm" onClick={logout}>Sign out</button>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        {sidebarOpen && (
          <div className="fixed inset-0 top-16 bg-black/25 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        <nav
          aria-label="Primary"
          className={`no-print w-56 flex-none border-r border-line bg-surface p-2.5 overflow-y-auto overscroll-contain
            fixed md:static top-16 bottom-0 left-0 z-40 transition-transform
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        >
          <div className="text-[10.8px] uppercase tracking-wide text-ink-muted font-bold px-2.5 mb-1.5">
            {ROLE_LABEL[user.role] || user.role}
          </div>
          <div className="flex flex-col gap-0.5">
            {/* Self-service account settings (avatar, password) — open to
                every role regardless of permissions, so it's pinned here
                unconditionally rather than filtered through currentNav()
                like everything below. This also covers mobile, where the
                header's profile button is hidden. */}
            <button
              onClick={() => { setRoute('profile'); setSidebarOpen(false); }}
              aria-current={route === 'profile' ? 'page' : undefined}
              className={`sm:hidden flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.8px] font-semibold text-left
                ${route === 'profile' ? 'bg-accent-50 text-accent-600' : 'text-ink-secondary hover:bg-sunken'}`}
            >
              <span className="w-4 text-center flex-none" aria-hidden="true">👤</span>
              My Profile
            </button>
            {nav.map((k) => {
              const item = NAV_ITEMS[k];
              const active = route === k;
              return (
                <button
                  key={k}
                  onClick={() => { setRoute(k); setSidebarOpen(false); }}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.8px] font-semibold text-left
                    ${active ? 'bg-accent-50 text-accent-600' : 'text-ink-secondary hover:bg-sunken'}`}
                >
                  <span className="w-4 text-center flex-none" aria-hidden="true">{item.icon}</span>
                  {item.label}
                  {k === 'messages' && unreadMessages > 0 && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-critical text-white text-[10px] font-bold flex items-center justify-center flex-none" aria-label={`, ${unreadMessages} unread`}>
                      {unreadMessages > 9 ? '9+' : unreadMessages}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {showTree && (
            <>
              <div className="text-[10.8px] uppercase tracking-wide text-ink-muted font-bold px-2.5 mt-4 mb-1.5">
                Programme structure
              </div>
              <OrgTree setRoute={setRoute} onNavigate={() => setSidebarOpen(false)} />
            </>
          )}
        </nav>
        <main className="flex-1 min-w-0 overflow-y-auto overscroll-contain p-5 md:p-7 pb-16">{children}</main>
      </div>
    </div>
  );
}
