import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import {
  subsOfProgramme, unitsOfSub, individualsOfUnit, nodeOwnKpis, nodeRagCls,
  performanceRollup, institutionalRollup, defaultNodeForRole, nodeAncestryChain, canDrillToKind,
} from '../lib/scope.js';

const RAG_DOT = {
  'chip-rag-green': 'bg-good', 'chip-rag-amber': 'bg-warning', 'chip-rag-red': 'bg-critical', 'chip-rag-none': 'bg-ink-muted',
};

// The sidebar's "Programme structure" tree — the same click-to-drill-down
// navigation as the original prototype. A global role (cpu/exec/ictadmin)
// sees the whole org; a scoped role (rep/unithead/individual) sees only
// their own branch (their Programme → their Sub-programme → …), matching
// what they're actually allowed to view elsewhere in the app.
export default function OrgTree({ setRoute, onNavigate }) {
  const { org, kpis, perfValues, settings, user, selNode, selectNode, clearSelNode, hasPerm } = useApp();
  const forced = defaultNodeForRole(user);
  // A global role (forced === null) browsing every Programme side-by-side
  // IS a way to navigate the institution-wide picture, same as the "All
  // Programmes" aggregate on Overview itself — so it's gated behind the
  // exact same permission (see utils/permissions.js's
  // view_institutional_performance), not left open as a back door around
  // that gate. A scoped role is unaffected: `forced` already restricts them
  // to their own branch regardless of this permission.
  const canViewInstitutional = hasPerm('view_institutional_performance');
  const effectiveNode = selNode || forced;

  // Whichever node is currently showing on Overview — wherever it came
  // from (this tree, or a card clicked on the page itself) — always has
  // its own container ancestors open, exactly like the original: selecting
  // a node reveals its children rather than leaving the tree collapsed
  // around the very thing you just navigated to. A user can still close a
  // level by hand afterwards; `manual` below only ever overrides this.
  const autoOpenKeys = useMemo(() => {
    const keys = new Set();
    if (!effectiveNode) return keys;
    nodeAncestryChain(org, effectiveNode.kind, effectiveNode.id).forEach((c) => {
      if (c.kind === 'programme') keys.add(`p:${c.id}`);
      else if (c.kind === 'sub') keys.add(`s:${c.id}`);
      else if (c.kind === 'unit') keys.add(`u:${c.id}`);
    });
    return keys;
  }, [org, effectiveNode]);
  const [manual, setManual] = useState({});
  const isOpen = (key) => (key in manual ? manual[key] : autoOpenKeys.has(key));
  function toggle(key) { setManual((m) => ({ ...m, [key]: !isOpen(key) })); }

  // A scoped role's own ancestor chain — used below to restrict the tree to
  // just their own branch, at each level, the same as the original: a Rep
  // sees only their own Sub-programme (but every Unit and Individual under
  // it, since they manage the whole thing); a Unit Head sees only their own
  // Unit within it (but everyone in it); an Individual sees only themself.
  const ownChain = forced ? nodeAncestryChain(org, forced.kind, forced.id) : null;
  const ownProgrammeId = ownChain?.find((c) => c.kind === 'programme')?.id;
  const ownSubId = ownChain?.find((c) => c.kind === 'sub')?.id;
  const ownUnitId = ownChain?.find((c) => c.kind === 'unit')?.id;

  const programmes = useMemo(() => {
    if (!forced) return canViewInstitutional ? org.programmes : [];
    return org.programmes.filter((p) => p.id === ownProgrammeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, forced, ownProgrammeId, canViewInstitutional]);

  function visibleSubs(programmeId) {
    const subs = subsOfProgramme(org, programmeId);
    if (['rep', 'unithead', 'individual'].includes(user.role)) return subs.filter((s) => s.id === ownSubId);
    return subs;
  }
  function visibleUnits(subId) {
    const units = unitsOfSub(org, subId);
    if (['unithead', 'individual'].includes(user.role)) return units.filter((u) => u.id === ownUnitId);
    return units;
  }
  function visibleIndividuals(unitId) {
    const inds = individualsOfUnit(org, unitId);
    if (user.role === 'individual') return inds.filter((i) => i.id === forced.id);
    return inds;
  }

  function select(kind, id) {
    selectNode(kind, id);
    if (setRoute) setRoute('overview');
    if (onNavigate) onNavigate();
  }
  // Pinned above the tree (global roles with the permission only — a
  // scoped role's `forced` default means they never have an institutional
  // level to return to in the first place, same gate the "Home" breadcrumb
  // link and Overview.jsx's own card already use) — a single click back to
  // "Overall Institutional Performance" that's always in the same place
  // whether the tree below is fully collapsed or three levels deep, unlike
  // the breadcrumb, which only exists once you've already drilled in.
  function goHome() {
    clearSelNode();
    if (setRoute) setRoute('overview');
    if (onNavigate) onNavigate();
  }
  function ragDot(kind, id) {
    const cls = nodeRagCls(performanceRollup(nodeOwnKpis(org, kpis, kind, id), perfValues, settings), settings);
    return <span className={`w-1.5 h-1.5 rounded-full flex-none ${RAG_DOT[cls]}`} />;
  }
  function row(kind, id, label, depth, hasChildren, expandedKey) {
    const isSel = effectiveNode ? effectiveNode.kind === kind && effectiveNode.id === id : false;
    const open = hasChildren && isOpen(expandedKey);
    // Same Overview navigation ceiling Overview.jsx's ChildCards enforces
    // (see lib/scope.js's canDrillToKind) — a restricted row still shows
    // (so the tree's shape stays honest about what exists) but isn't
    // clickable, with a lock cursor rather than a click that silently does
    // nothing.
    const restricted = !canDrillToKind(user, kind);
    return (
      <div
        key={expandedKey}
        onClick={() => { if (!restricted) select(kind, id); }}
        title={restricted ? 'Restricted for your account by your ICT System Administrator' : undefined}
        className={`flex items-center gap-1.5 py-1.5 px-1.5 rounded-md text-[12.3px] ${restricted ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'} ${isSel ? 'bg-accent-50 text-accent-600 font-semibold' : 'text-ink-secondary hover:bg-sunken'}`}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
      >
        {hasChildren ? (
          <span
            className="w-3 text-center text-[9px] text-ink-muted flex-none"
            onClick={(e) => { e.stopPropagation(); toggle(expandedKey); }}
          >{open ? '▾' : '▸'}</span>
        ) : <span className="w-3 flex-none" />}
        {ragDot(kind, id)}
        <span className="truncate">{label}</span>
        {restricted && <span className="flex-none text-[10px]">🔒</span>}
      </div>
    );
  }

  if (!forced && !canViewInstitutional) {
    return (
      <p className="text-[11.3px] text-ink-muted px-1.5 leading-snug">
        Restricted — ask your ICT System Administrator for the "View Overall Institutional Performance" permission.
      </p>
    );
  }

  const showHome = !forced && canViewInstitutional;
  const homeSelected = showHome && !selNode;
  const homeRagCls = showHome ? nodeRagCls(institutionalRollup(org, kpis, perfValues, settings).performance, settings) : null;

  return (
    <div className="flex flex-col gap-0.5">
      {showHome && (
        <div
          onClick={goHome}
          className={`flex items-center gap-1.5 py-1.5 px-1.5 rounded-md text-[12.3px] cursor-pointer mb-1 pb-2 border-b border-line ${homeSelected ? 'bg-accent-50 text-accent-600 font-semibold' : 'text-ink-secondary hover:bg-sunken'}`}
          style={{ paddingLeft: '6px' }}
        >
          <span className="w-3 flex-none" />
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${RAG_DOT[homeRagCls]}`} />
          <span className="truncate">All Programmes</span>
        </div>
      )}
      {programmes.map((p) => {
        const pKey = `p:${p.id}`;
        const pOpen = isOpen(pKey);
        return (
          <div key={p.id}>
            {row('programme', p.id, p.name, 0, true, pKey)}
            {pOpen && visibleSubs(p.id).map((s) => {
              const sKey = `s:${s.id}`;
              const sOpen = isOpen(sKey);
              return (
                <div key={s.id}>
                  {row('sub', s.id, s.name, 1, true, sKey)}
                  {sOpen && visibleUnits(s.id).map((u) => {
                    const uKey = `u:${u.id}`;
                    const inds = visibleIndividuals(u.id);
                    const uOpen = inds.length > 0 && isOpen(uKey);
                    return (
                      <div key={u.id}>
                        {row('unit', u.id, u.name, 2, inds.length > 0, uKey)}
                        {uOpen && inds.map((i) => row('individual', i.id, i.name, 3, false, `i:${i.id}`))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
