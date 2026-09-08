import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, setToken, setUnauthorizedHandler, setPasswordChangeRequiredHandler } from '../lib/api.js';
import { currentPeriod, canDrillToKind } from '../lib/scope.js';
import { defaultIdx, rangeFor, latestInRange } from '../lib/period.js';
import { playTone } from '../lib/sound.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [org, setOrg] = useState({ programmes: [], subs: [], units: [], individuals: [] });
  const [kpis, setKpis] = useState([]);
  // The Unit-scoped "KPI for individuals" pool (see backend's kpi_templates
  // table / routes/kpiTemplates.js) — created once against a Unit, then
  // picked up by individuals in that unit as their own real KPI. Loaded
  // alongside kpis/org since it's the same kind of slow-changing catalog
  // data, not a per-period figure.
  const [templates, setTemplates] = useState([]);
  // Which Individual has been delegated which Unit-owned KPI as one of
  // their duties — see lib/scope.js's canEnterData/isAssignedIndividual and
  // backend/src/routes/kpis.js's kpi_assignments-backed isOwner.
  const [assignments, setAssignments] = useState([]);
  // A personal, per-user "not relevant to me" list (see backend's kpi_hidden
  // table / routes/kpis.js's GET|POST|DELETE /hidden) — an id set, not an
  // array, so every read site can do a cheap `.has()` instead of scanning.
  // This only ever hides a KPI from THIS person's own exploratory browsing
  // (Overview's drill-down); nothing that reads it is an accountability
  // surface — My Data Entry's owned/assigned KPIs and Approvals Queue's
  // pending items never consult it, so hiding something can never be used
  // to dodge a real duty.
  const [hiddenKpiIds, setHiddenKpiIds] = useState(() => new Set());
  const [settings, setSettings] = useState({});
  const [values, setValues] = useState({});
  // Each assignee's own monthly figure toward a shared Unit-owned KPI (see
  // lib/scope.js's canContribute / backend's kpi_contributions) — a flat
  // array like `assignments`, not a map, since more than one row can share
  // a kpi_id. Loaded per period exactly like `values`.
  const [contributions, setContributions] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  // Unread internal-messaging count (see pages/Messages.jsx / routes/messages.js)
  // — shown as a badge on the "Messages" nav item. Loaded on login/refresh/
  // after reading or sending, same as everything else here (no timer).
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Last unread count we actually knew, kept outside React state so
  // reloadUnread can compare "did this go up" without waiting on a render.
  // null means "haven't checked yet" (fresh login) — the very first check
  // just establishes that baseline silently; only a check AFTER that one
  // finding a higher count means something genuinely new arrived, which is
  // when the "received" ring tone below is earned.
  const unreadKnownRef = useRef(null);

  // Which org node (Programme / Sub-programme / Unit / Individual) the
  // sidebar tree / Overview drill-down is currently focused on — shared
  // between the two so clicking a tree row and clicking a card on Overview
  // are the same navigation action. null = "no explicit selection" (a
  // scoped role then falls back to their own place in the structure — see
  // lib/scope.js's defaultNodeForRole; a global role falls back to "All
  // Programmes"). Cleared on logout so the next sign-in starts fresh.
  const [selNode, setSelNode] = useState(null);
  // Enforces this account's own Overview navigation ceiling (see
  // lib/scope.js's canDrillToKind / users.overview_limit) right at the one
  // place every drill-down action funnels through — a no-op past the cap,
  // not just a rendering choice, so there's no second path that bypasses
  // it. Overview.jsx also avoids rendering the deeper cards as clickable in
  // the first place; this is the backstop.
  const selectNode = useCallback((kind, id) => {
    if (!canDrillToKind(user, kind)) return;
    setSelNode({ kind, id });
  }, [user]);
  const clearSelNode = useCallback(() => setSelNode(null), []);

  // A separate, read-only "performance lens" (Overview/Reports) — see
  // lib/period.js. Data entry always stays on the monthly `period` above.
  const initial = currentPeriod();
  const [perfPeriod, setPerfPeriod] = useState({ type: 'monthly', year: initial.year, idx: defaultIdx('monthly', initial.month) });
  const [perfValues, setPerfValues] = useState({});
  const tokenRef = useRef(localStorage.getItem('zou_token') || null);

  const logout = useCallback(() => {
    tokenRef.current = null;
    setToken(null);
    localStorage.removeItem('zou_token');
    setUser(null);
    setSelNode(null);
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  // Defense-in-depth mirror of the same must_change_password check
  // login/boot already do before ever calling loadCore (see below) — if
  // some other request ever reaches the API first and gets the server's
  // 403, just re-sync `user` from /me (exempt from the gate) so App.jsx's
  // must_change_password check renders the forced screen instead of
  // whatever silently failed.
  useEffect(() => { setPasswordChangeRequiredHandler(() => { api('/auth/me').then((r) => setUser(r.user)).catch(() => {}); }); }, []);

  const loadValuesForPeriod = useCallback(async (p) => {
    const r = await api(`/kpis/values?year=${p.year}&month=${p.month}`);
    const map = {};
    r.values.forEach((v) => { map[`${v.kpi_id}-${v.year}-${v.month}`] = v; });
    setValues(map);
    setLastSync(new Date());
  }, []);

  const loadContributionsForPeriod = useCallback(async (p) => {
    const r = await api(`/kpis/contributions?year=${p.year}&month=${p.month}`);
    setContributions(r.contributions);
  }, []);

  const loadPerfValues = useCallback(async (pp) => {
    const [fromMonth, toMonth] = rangeFor(pp.type, pp.idx);
    const r = await api(`/kpis/values-range?year=${pp.year}&fromMonth=${fromMonth}&toMonth=${toMonth}`);
    const byKpi = {};
    r.values.forEach((v) => { (byKpi[v.kpi_id] = byKpi[v.kpi_id] || []).push(v); });
    const map = {};
    Object.keys(byKpi).forEach((kpiId) => { map[kpiId] = latestInRange(byKpi[kpiId]); });
    setPerfValues(map);
  }, []);

  const changePerfPeriod = useCallback((next) => {
    setPerfPeriod(next);
    loadPerfValues(next);
  }, [loadPerfValues]);

  const reloadUnread = useCallback(async () => {
    try {
      const r = await api('/messages/unread-count');
      if (unreadKnownRef.current !== null && r.count > unreadKnownRef.current) {
        playTone('received');
      }
      unreadKnownRef.current = r.count;
      setUnreadMessages(r.count);
    } catch (_) { /* non-critical — leave the last known count showing */ }
  }, []);

  const reloadHidden = useCallback(async () => {
    const r = await api('/kpis/hidden');
    setHiddenKpiIds(new Set(r.hidden));
  }, []);

  const reloadTemplates = useCallback(async () => {
    const r = await api('/kpi-templates');
    setTemplates(r.templates);
  }, []);

  // Optimistic — the whole point of a personal declutter toggle is that it
  // feels instant, and a failed request just means it reappears (reconciled
  // from the server's own response) rather than silently pretending to work.
  const hideKpi = useCallback(async (kpiId) => {
    setHiddenKpiIds((prev) => new Set(prev).add(kpiId));
    try { await api(`/kpis/${kpiId}/hide`, { method: 'POST' }); }
    catch (_) { await reloadHidden(); }
  }, [reloadHidden]);
  const unhideKpi = useCallback(async (kpiId) => {
    setHiddenKpiIds((prev) => { const next = new Set(prev); next.delete(kpiId); return next; });
    try { await api(`/kpis/${kpiId}/hide`, { method: 'DELETE' }); }
    catch (_) { await reloadHidden(); }
  }, [reloadHidden]);

  const loadCore = useCallback(async (p) => {
    const [orgRes, kpiRes, settingsRes, assignRes] = await Promise.all([api('/org'), api('/kpis'), api('/settings'), api('/kpis/assignments')]);
    setOrg(orgRes);
    setKpis(kpiRes.kpis);
    setSettings(settingsRes.settings);
    setAssignments(assignRes.assignments);
    await Promise.all([loadValuesForPeriod(p), loadContributionsForPeriod(p), reloadHidden(), reloadTemplates()]);
    const pp = { type: 'monthly', year: p.year, idx: defaultIdx('monthly', p.month) };
    setPerfPeriod(pp);
    await loadPerfValues(pp);
    await reloadUnread();
  }, [loadValuesForPeriod, loadContributionsForPeriod, loadPerfValues, reloadUnread, reloadHidden, reloadTemplates]);

  // Refresh everything on demand (the header's Refresh control — see
  // LiveIndicator.jsx) — values, the performance lens, and the org/KPI
  // catalogue. This used to run automatically on a timer, but that
  // background polling was re-rendering the whole app (and resetting things
  // like an in-progress Overview drill-down or an open dropdown) every 20
  // seconds regardless of what the person was in the middle of doing, so
  // it's manual now: nothing refetches until you ask it to, or until an
  // action you took (save, submit, approve…) triggers its own reload.
  const refreshAll = useCallback(async () => {
    setSyncing(true);
    try {
      const [orgRes, kpiRes, settingsRes, assignRes] = await Promise.all([api('/org'), api('/kpis'), api('/settings'), api('/kpis/assignments')]);
      setOrg(orgRes); setKpis(kpiRes.kpis); setSettings(settingsRes.settings); setAssignments(assignRes.assignments);
      await Promise.all([loadValuesForPeriod(period), loadContributionsForPeriod(period), loadPerfValues(perfPeriod), reloadUnread(), reloadHidden(), reloadTemplates()]);
    } finally {
      setSyncing(false);
    }
  }, [period, perfPeriod, loadValuesForPeriod, loadContributionsForPeriod, loadPerfValues, reloadUnread, reloadHidden, reloadTemplates]);

  // The fast path: everyone's day-to-day reason to hit refresh is "did
  // anyone's figures move" — a value someone just saved, a contribution
  // submitted/approved, a new message — not "did the org chart or KPI
  // catalogue change", which happens rarely (a KPI created/edited/deleted, a
  // custodian assignment) and is what refreshAll's org/kpis/settings/
  // assignments calls are for. quickRefresh skips exactly those four slow,
  // rarely-changing calls and reloads only the period-scoped, fast-changing
  // data, so the common "is there anything new" check is a fraction of the
  // network work refreshAll does and feels instant.
  const quickRefreshing = useRef(false);
  const [quickSyncing, setQuickSyncing] = useState(false);
  const quickRefresh = useCallback(async () => {
    if (quickRefreshing.current) return;
    quickRefreshing.current = true;
    setQuickSyncing(true);
    try {
      await Promise.all([loadValuesForPeriod(period), loadContributionsForPeriod(period), loadPerfValues(perfPeriod), reloadUnread()]);
    } finally {
      setQuickSyncing(false);
      quickRefreshing.current = false;
    }
  }, [period, perfPeriod, loadValuesForPeriod, loadContributionsForPeriod, loadPerfValues, reloadUnread]);

  const changePeriod = useCallback((p) => {
    setPeriod(p);
    loadValuesForPeriod(p);
    loadContributionsForPeriod(p);
  }, [loadValuesForPeriod, loadContributionsForPeriod]);

  // Stores a fresh token + user from /login or /change-password, and — the
  // one branch point both share — only loads the rest of the app's data if
  // this account is actually clear to use it. An account still on a
  // temporary password (see SECURITY_REVIEW.md's finding #1) gets nothing
  // beyond `user` itself: App.jsx renders the forced change-password screen
  // instead of Layout the moment it sees user.must_change_password, and
  // every other API route would 403 anyway (see middleware/auth.js's
  // requireAuth) — this just avoids firing those doomed requests at all.
  const applyAuthResult = useCallback(async (r) => {
    tokenRef.current = r.token;
    setToken(r.token);
    localStorage.setItem('zou_token', r.token);
    setUser(r.user);
    if (!r.user.must_change_password) {
      await loadCore(currentPeriod());
    }
  }, [loadCore]);

  // An account with MFA enabled (see routes/auth.js) gets a short-lived
  // mfaToken back here instead of a real session — returned to the caller
  // (Login.jsx) so it can show the code-entry step, rather than this
  // function trying to own that UI state itself. Everything else about
  // signing in (error handling, applying the eventual real token) stays
  // exactly as it was for an account that never opted into MFA.
  const login = useCallback(async (email, password) => {
    setLoginError(null);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      if (r.mfaRequired) return { mfaRequired: true, mfaToken: r.mfaToken };
      await applyAuthResult(r);
      return { mfaRequired: false };
    } catch (err) {
      setLoginError(err.message || 'Login failed.');
      return { mfaRequired: false, error: true };
    }
  }, [applyAuthResult]);

  // Step 2 of an MFA sign-in: the mfaToken login() just handed back, plus
  // the 6-digit code (or a recovery code) the person entered. Same
  // apply-then-load-core transition every other successful auth action uses.
  const verifyMfa = useCallback(async (mfaToken, code) => {
    setLoginError(null);
    try {
      const r = await api('/auth/mfa/verify', { method: 'POST', body: { mfaToken, code } });
      await applyAuthResult(r);
      return true;
    } catch (err) {
      setLoginError(err.message || 'Verification failed.');
      return false;
    }
  }, [applyAuthResult]);

  // Called once the forced change-password screen's own submit succeeds —
  // the backend returns a freshly-signed token (the old one's token_version
  // is now stale — see routes/auth.js's /change-password) plus the updated
  // user with must_change_password cleared, so this is the same
  // apply-then-load-core transition login uses, just entered from a
  // different screen.
  const completePasswordChange = useCallback(async (r) => {
    await applyAuthResult(r);
  }, [applyAuthResult]);

  const refreshUser = useCallback(async () => {
    const r = await api('/auth/me');
    setUser(r.user);
    return r.user;
  }, []);

  useEffect(() => {
    (async () => {
      if (!tokenRef.current) { setBooting(false); return; }
      setToken(tokenRef.current);
      try {
        const u = await refreshUser();
        if (!u.must_change_password) {
          await loadCore(currentPeriod());
        }
      } catch (_) {
        logout();
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPerm = useCallback((key) => !!(user && user.permissions && user.permissions.includes(key)), [user]);

  const reloadAssignments = useCallback(async () => {
    const r = await api('/kpis/assignments');
    setAssignments(r.assignments);
  }, []);

  // "Sign out everywhere" — see routes/auth.js's /logout-everywhere. Bumps
  // the account's token_version server-side, which invalidates THIS
  // session's own token too (it's included), so the local cleanup below
  // mirrors logout() exactly rather than trying to keep this tab alive.
  const logoutEverywhere = useCallback(async () => {
    try { await api('/auth/logout-everywhere', { method: 'POST' }); } finally { logout(); }
  }, [logout]);

  const value = {
    booting, user, loginError, login, verifyMfa, logout, logoutEverywhere, completePasswordChange, hasPerm, refreshUser,
    org, kpis, settings, values, period, changePeriod,
    assignments, reloadAssignments,
    templates, reloadTemplates,
    hiddenKpiIds, hideKpi, unhideKpi,
    contributions, reloadContributions: () => loadContributionsForPeriod(period),
    selNode, selectNode, clearSelNode,
    perfPeriod, perfValues, changePerfPeriod,
    refreshAll, quickRefresh, quickSyncing,
    reloadCore: () => loadCore(period),
    reloadValues: () => Promise.all([loadValuesForPeriod(period), loadContributionsForPeriod(period)]),
    setSettings,
    lastSync, syncing,
    unreadMessages, reloadUnread,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
