import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useApp } from './context/AppContext.jsx';
import { currentNav, isRouteAvailable } from './lib/nav.js';
// Login and ForcedPasswordChange render before the route switch below even
// exists (see the early returns further down) — they're what every signed-
// out visitor sees first, so they stay ordinary eager imports rather than
// adding a loading flicker to the very first screen for a saving that's
// small anyway (neither pulls in a heavy library).
import Login from './pages/Login.jsx';
import ForcedPasswordChange from './pages/ForcedPasswordChange.jsx';
import Layout from './components/Layout.jsx';

// Every other page is lazy-loaded — this app renders exactly one page at a
// time (no nested routes), so a given signed-in account only ever fetches
// the handful of pages actually in their own nav, not all fifteen bundled
// together. Originally only Planning/Reports were split out this way,
// specifically because they pull in jsPDF/jspdf-autotable (themselves
// further dynamically imported only when Download PDF is actually
// clicked — see each page's own downloadPdf); every page below gets the
// same treatment now for the same reason at smaller scale — an Employee
// account, say, never pays for Organisation Builder's or Permissions'
// code just because those exist in the bundle for CPU/ICT admin.
const Overview = lazy(() => import('./pages/Overview.jsx'));
const OverviewPerformance = lazy(() => import('./pages/OverviewPerformance.jsx'));
const Entry = lazy(() => import('./pages/Entry.jsx'));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Framework = lazy(() => import('./pages/Framework.jsx'));
const KpiManagement = lazy(() => import('./pages/KpiManagement.jsx'));
const OrganisationBuilder = lazy(() => import('./pages/OrganisationBuilder.jsx'));
const Planning = lazy(() => import('./pages/Planning.jsx'));
const Compliance = lazy(() => import('./pages/Compliance.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const ReportsPerformance = lazy(() => import('./pages/ReportsPerformance.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Permissions = lazy(() => import('./pages/Permissions.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));

const PAGES = {
  overview: Overview,
  overviewPerformance: OverviewPerformance,
  entry: Entry,
  approvals: Approvals,
  framework: Framework,
  kpiManagement: KpiManagement,
  orgBuilder: OrganisationBuilder,
  planning: Planning,
  compliance: Compliance,
  complianceProgress: Compliance,
  compliancePerformance: Compliance,
  reports: Reports,
  reportsPerformance: ReportsPerformance,
  audit: Audit,
  settings: Settings,
  users: Users,
  permissions: Permissions,
  profile: Profile,
};

export default function App() {
  const { booting, user, hasPerm, restoreSelNode } = useApp();
  const [route, setRouteState] = useState('overview');
  const setRoute = useCallback((nextRoute) => {
    if (route === nextRoute) return;
    window.history.pushState({
      zouApp: {
        userId: user.id,
        route: nextRoute,
        selNode: window.history.state?.zouApp?.userId === user.id ? window.history.state.zouApp.selNode : null,
      },
    }, '', window.location.href);
    setRouteState(nextRoute);
  }, [route, user]);
  const nav = user ? currentNav(user, hasPerm) : [];

  // Restore this account's last app location on reload, or start on the
  // first page available in its navigation. Each transition is stored in
  // the browser history so its native Back/Forward controls work as expected.
  useEffect(() => {
    if (user) {
      const saved = window.history.state?.zouApp;
      const sameUser = saved?.userId === user.id;
      const nextRoute = sameUser && isRouteAvailable(saved.route, nav) ? saved.route : (nav[0] || 'overview');
      const nextNode = sameUser ? saved.selNode || null : null;
      window.history.replaceState({ zouApp: { userId: user.id, route: nextRoute, selNode: nextNode } }, '', window.location.href);
      setRouteState(nextRoute);
      restoreSelNode(nextNode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    function restoreFromHistory(event) {
      const saved = event.state?.zouApp;
      if (!user || saved?.userId !== user.id) return;
      if (saved.route !== 'profile' && !isRouteAvailable(saved.route, currentNav(user, hasPerm))) return;
      setRouteState(saved.route);
      restoreSelNode(saved.selNode || null);
    }
    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, [user, hasPerm, restoreSelNode]);

  if (booting) {
    return <div className="min-h-dvh flex items-center justify-center text-ink-muted text-sm">Loading…</div>;
  }
  if (!user) return <Login />;
  // A real server-side gate (see middleware/auth.js's requireAuth), not
  // just a UI nicety — every other route already 403s for this account
  // until this clears, so rendering anything else here would just be a
  // Layout full of screens that can't actually load their own data.
  if (user.must_change_password) return <ForcedPasswordChange />;

  // 'profile' (My Profile — reached from the header, see Layout.jsx) is a
  // self-service page open to every account regardless of permissions.
  // Everything else must actually be in the caller's nav — so if ICT admin
  // revokes, say, view_overview from someone mid-session, the default
  // 'overview' route state doesn't quietly keep rendering it anyway.
  const safeRoute = route === 'profile' || isRouteAvailable(route, nav) ? route : (nav[0] || 'overview');
  const Page = PAGES[safeRoute] || Overview;
  return (
    <Layout route={safeRoute} setRoute={setRoute}>
      <Suspense fallback={<div className="text-ink-muted text-[13px]">Loading…</div>}>
        <Page setRoute={setRoute} route={safeRoute} />
      </Suspense>
    </Layout>
  );
}
