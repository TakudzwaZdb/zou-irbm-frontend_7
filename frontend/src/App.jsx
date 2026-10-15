import { lazy, Suspense, useEffect, useState } from 'react';
import { useApp } from './context/AppContext.jsx';
import { currentNav } from './lib/nav.js';
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
const Entry = lazy(() => import('./pages/Entry.jsx'));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Framework = lazy(() => import('./pages/Framework.jsx'));
const KpiManagement = lazy(() => import('./pages/KpiManagement.jsx'));
const OrganisationBuilder = lazy(() => import('./pages/OrganisationBuilder.jsx'));
const Planning = lazy(() => import('./pages/Planning.jsx'));
const Compliance = lazy(() => import('./pages/Compliance.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Permissions = lazy(() => import('./pages/Permissions.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));

const PAGES = {
  overview: Overview,
  entry: Entry,
  approvals: Approvals,
  framework: Framework,
  kpiManagement: KpiManagement,
  orgBuilder: OrganisationBuilder,
  planning: Planning,
  compliance: Compliance,
  reports: Reports,
  audit: Audit,
  settings: Settings,
  users: Users,
  permissions: Permissions,
  profile: Profile,
  messages: Messages,
};

export default function App() {
  const { booting, user, hasPerm } = useApp();
  const [route, setRoute] = useState('overview');
  const nav = user ? currentNav(user, hasPerm) : [];

  // Land on whatever's first in this person's own nav — same as the
  // original prototype (a data-entry role opens straight to My Data Entry,
  // an oversight role opens to Overview) — the moment they sign in, not on
  // every render (that would fight anyone who's since navigated away).
  useEffect(() => {
    if (user) setRoute(nav[0] || 'overview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
  const safeRoute = route === 'profile' || nav.includes(route) ? route : (nav[0] || 'overview');
  const Page = PAGES[safeRoute] || Overview;
  return (
    <Layout route={safeRoute} setRoute={setRoute}>
      <Suspense fallback={<div className="text-ink-muted text-[13px]">Loading…</div>}>
        <Page />
      </Suspense>
    </Layout>
  );
}
