import { useEffect, useState } from 'react';
import { useApp } from './context/AppContext.jsx';
import { currentNav } from './lib/nav.js';
import Login from './pages/Login.jsx';
import ForcedPasswordChange from './pages/ForcedPasswordChange.jsx';
import Layout from './components/Layout.jsx';
import Overview from './pages/Overview.jsx';
import Entry from './pages/Entry.jsx';
import Approvals from './pages/Approvals.jsx';
import Framework from './pages/Framework.jsx';
import Planning from './pages/Planning.jsx';
import Compliance from './pages/Compliance.jsx';
import Reports from './pages/Reports.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';
import Users from './pages/Users.jsx';
import Profile from './pages/Profile.jsx';
import Messages from './pages/Messages.jsx';

const PAGES = {
  overview: Overview,
  entry: Entry,
  approvals: Approvals,
  framework: Framework,
  planning: Planning,
  compliance: Compliance,
  reports: Reports,
  audit: Audit,
  settings: Settings,
  users: Users,
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
      <Page />
    </Layout>
  );
}
