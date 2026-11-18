export const NAV_ITEMS = {
  overview: { label: 'Overview', icon: '◆', perm: 'view_overview' },
  entry: { label: 'My Data Entry', icon: '✎', perm: 'data_entry' },
  approvals: { label: 'Approvals Queue', icon: '✓', perm: 'approve_own_tier' },
  framework: { label: 'Framework', icon: '▦', perm: 'view_framework' },
  // Two admin pages split out of Framework's old create/edit/delete forms
  // (see pages/KpiManagement.jsx, OrgStructure.jsx) — each gated by an
  // array of permissions (see currentNav below): visible to whoever holds
  // ANY one of them, since a permission in this app can be granted to a
  // single account independent of role (e.g. `edit_targets` or
  // `add_employee` handed to just one person), not only to its default
  // holders (cpu/ictadmin). Organisation Maintenance used to be two separate
  // pages (Organisation Structure + People & Roles), each showing its own
  // full copy of the org tree — merged into one page/one nav entry so
  // every structural and personnel change (create/delete Programmes/Subs/
  // Units, add/edit/remove Employees, change an account's role) happens
  // on the one platform, not a repeated tree display across pages.
  kpiManagement: { label: 'KPI Management', icon: '🎯', perm: ['create_kpi', 'edit_targets'] },
  // Organisation Setup (create a Programme/Sub-programme/Unit, update an
  // existing one's own name/head, add an Employee) and Organisation
  // Maintenance (remove/restore, edit/role-change an existing Employee)
  // are two distinct nav entries for what used to be one page mixing create,
  // update, remove, and restore in a single scroll — same "any one of
  // these" permission-array gating as every other admin page here.
  // create_org_units/edit_org_units are the narrower, independently-
  // grantable siblings of manage_org_units (see utils/permissions.js on the
  // backend) — either one alone is enough to reach this page (its own
  // Create/Update navigation then further narrows what a holder of just one
  // of them can actually do — see OrganisationBuilder.jsx).
  orgBuilder: { label: 'Organisation Setup', icon: '🏗', perm: ['manage_org_units', 'create_org_units', 'edit_org_units', 'add_employee'] },
  planning: { label: 'Annual Plan & Budget', icon: '🧾' },
  compliance: { label: 'Compliance & Escalations', icon: '⏱', perm: 'view_performance_alerts' },
  reports: { label: 'Reports', icon: '▤', perm: 'view_reports' },
  audit: { label: 'Audit Log', icon: '≣', perm: 'view_audit' },
  settings: { label: 'Settings', icon: '⚙', perm: 'manage_settings' },
  // Users is the account directory (profile, password/MFA, overview limit,
  // Executive Owner, remove) — role assignment and organisation-scope
  // changes both moved to Permissions & Roles below (see pages/Users.jsx
  // and pages/Permissions.jsx's own header notes). Reachable on EITHER
  // manage_users (ictadmin — full edit access) OR the narrower view_users
  // (granted to cpu by default — read-only: Users.jsx itself hides every
  // action button when the viewer holds view_users but not manage_users).
  // Permissions & Roles stays manage_users-only, full stop — there is no
  // view-only version of granting/revoking permissions or changing roles.
  users: { label: 'Users', icon: '🔑', perm: ['manage_users', 'view_users'] },
  permissions: { label: 'Roles and Permissions', icon: '☷', perm: 'manage_users' },
};

// Framework is on every role's nav — everyone can see the programmes /
// sub-programmes / units / employees tree read-only (it's the org chart
// they're part of), even if they hold none of the permissions that would
// let them add a unit, create a KPI, or edit targets from that same page.
// Compliance & Escalations includes durable alerts and corrective-action
// workflows scoped to the user's authorised branch, alongside the existing
// live compliance view. Management roles at Programme, Sub-programme, and
// Unit tiers need the same workflow access as institutional reviewers.
// Overview and Framework are visible to every role by default (every seeded
// account holds view_overview/view_framework — see utils/permissions.js on
// the backend) but, like Reports/Audit/Settings/Users below, that's now a
// real, revocable permission ICT admin can take away from one specific
// person, not a hardcoded "everyone always sees this" rule.
// Annual Plan & Budget is the yearly planning cascade (see pages/Planning.jsx):
// Units submit a narrative with a budget and/or measurable targets; Reps and
// Programme Heads add their tier's plan content; CPU approves every tier and
// compiles the University Annual Plan. Employees and ICT
// Admin don't own a unit/sub in this workflow, so it's not in their nav.
// Order mirrors the original prototype's flow: a person whose job is data
// entry sees "My Data Entry" (and, once they have someone reporting to
// them, their review queue) before Overview, since that's the task they
// open the app to do — Overview is the look-around page, not the landing
// task. Global/oversight roles (exec/cpu/ictadmin) keep Overview first,
// since for them IT is the landing task.
// Programme Head: read-only oversight of every Sub-programme in their own
// Programme plus compiling and submitting their Programme's plan to CPU for
// approval, see routes/plans.js's isProgrammeHeadOwner. No "My Data Entry" —
// a Programme never owns a KPI directly, so there's nothing at their own
// tier to fill in.
// kpiManagement/orgBuilder/orgStructure are added to exactly the role lists
// whose DEFAULT permission set (utils/permissions.js, backend) can hold
// create_kpi/edit_targets/manage_org_units/add_employee, plus
// rep/unithead for orgBuilder/orgStructure specifically — add_employee is
// grantable to a Sub Rep or Unit Head same as anyone else (see the note
// above OrganisationBuilder.jsx's Field component for why there's no
// own-scope restriction on it), so their nav needs the key present for
// that grant to ever become reachable.
// orgBuilder is always placed immediately before orgStructure — build it,
// then maintain it — wherever both appear. Same convention every other
// permissioned nav key here already follows (e.g. 'settings' only in cpu's
// list) — perm-gating inside currentNav is the second filter, not the only
// one.
export const ROLE_NAV_KEYS = {
  exec: ['overview', 'framework', 'planning', 'compliance', 'reports'],
  // Vice Chancellor — same read-only nav as Executive (see utils/permissions.js
  // on the backend: identical default permission set), now its own role
  // instead of an 'exec' account carrying the Executive Owner flag.
  vc: ['overview', 'framework', 'planning', 'compliance', 'reports'],
  employee: ['entry', 'overview', 'framework'],
  unithead: ['entry', 'overview', 'framework', 'orgBuilder', 'planning', 'compliance'],
  rep: ['entry', 'overview', 'framework', 'orgBuilder', 'planning', 'compliance'],
  // 'users' added explicitly (not left to the granted-permission fallback
  // in currentNav below) so it lands in this deliberate position rather
  // than tacked on at the very end — CPU holds view_users by default (see
  // utils/permissions.js on the backend), which gets it into the Users
  // directory read-only; Users.jsx itself hides every action button for a
  // viewer who lacks manage_users.
  cpu: ['overview', 'approvals', 'framework', 'kpiManagement', 'orgBuilder', 'planning', 'compliance', 'reports', 'users', 'audit', 'settings'],
  // ICT System Administrator keeps 'framework' — the org chart read-only,
  // same as every other role — alongside the pages that act on the org
  // (KPI Management / Organisation Setup / Organisation Maintenance).
  ictadmin: ['overview', 'framework', 'kpiManagement', 'orgBuilder', 'compliance', 'users', 'permissions', 'audit'],
  // 'approvals' added: a Sub-programme's own KPI submission is approved by
  // its own Programme Head, finally (see lib/scope.js's isApprover /
  // routes/kpis.js) — CPU has no role in this cascade — so Programme Head
  // needs a real Approvals Queue of their own now, not just read-only
  // oversight.
  programme: ['overview', 'framework', 'planning', 'reports', 'compliance'],
  // University Council: read-only oversight of the annual plan and reports.
  council: ['overview', 'planning', 'framework', 'reports'],
};

export const NAV_CHILDREN = {
  overview: [
    { route: 'overviewPerformance', label: 'Performance' },
    { route: 'overview', label: 'Progress' },
  ],
  reports: [
    { route: 'reportsPerformance', label: 'Performance' },
    { route: 'reports', label: 'Progress' },
  ],
};

const ROUTE_PARENTS = {
  overviewPerformance: 'overview',
  reportsPerformance: 'reports',
};

export function isRouteAvailable(route, nav) {
  return nav.includes(route) || (ROUTE_PARENTS[route] != null && nav.includes(ROUTE_PARENTS[route]));
}

export function currentNav(user, hasPerm) {
  const roleKeys = ROLE_NAV_KEYS[user.role] || ['overview'];
  // A permission grant must be enough to make its page reachable, even when
  // the recipient's role did not originally list that page. Role lists still
  // control pages with no permission gate, such as Planning.
  const grantedKeys = Object.keys(NAV_ITEMS).filter((key) => NAV_ITEMS[key].perm && !roleKeys.includes(key));
  const keys = [...roleKeys, ...grantedKeys];
  return keys.filter((k) => {
    const item = NAV_ITEMS[k];
    if (!item.perm) return true;
    // item.perm can be a single key (existing usage) or an array — an array
    // means "any one of these", since some pages (the new admin pages
    // above) make sense to reach on either a broad permission or a
    // narrower, independently-grantable sibling of it.
    return Array.isArray(item.perm) ? item.perm.some(hasPerm) : hasPerm(item.perm);
  });
}
