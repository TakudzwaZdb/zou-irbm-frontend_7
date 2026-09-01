import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, setToken, setUnauthorizedHandler } from '../lib/api.js';
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

  const login = useCallback(async (email, password) => {
    setLoginError(null);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      tokenRef.current = r.token;
      setToken(r.token);
      localStorage.setItem('zou_token', r.token);
      setUser(r.user);
      await loadCore(currentPeriod());
    } catch (err) {
      setLoginError(err.message || 'Login failed.');
    }
  }, [loadCore]);

  const refreshUser = useCallback(async () => {
    const r = await api('/auth/me');
    setUser(r.user);
  }, []);

  useEffect(() => {
    (async () => {
      if (!tokenRef.current) { setBooting(false); return; }
      setToken(tokenRef.current);
      try {
        await refreshUser();
        await loadCore(currentPeriod());
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

  const value = {
    booting, user, loginError, login, logout, hasPerm, refreshUser,
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
