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
  // `add_individual` handed to just one person), not only to its default
  // holders (cpu/ictadmin). Organisation Maintenance used to be two separate
  // pages (Organisation Structure + People & Roles), each showing its own
  // full copy of the org tree — merged into one page/one nav entry so
  // every structural and personnel change (create/delete Programmes/Subs/
  // Units, add/edit/remove Individuals, change an account's role) happens
  // on the one platform, not a repeated tree display across pages.
  kpiManagement: { label: 'KPI Management', icon: '🎯', perm: ['create_kpi', 'edit_targets'] },
  // Organisation Setup (create a Programme/Sub-programme/Unit, update an
  // existing one's own name/head, add an Individual) and Organisation
  // Maintenance (remove/restore, edit/role-change an existing Individual)
  // are two distinct nav entries for what used to be one page mixing create,
  // update, remove, and restore in a single scroll — same "any one of
  // these" permission-array gating as every other admin page here.
  // create_org_units/edit_org_units are the narrower, independently-
  // grantable siblings of manage_org_units (see utils/permissions.js on the
  // backend) — either one alone is enough to reach this page (its own
  // Create/Update navigation then further narrows what a holder of just one
  // of them can actually do — see OrganisationBuilder.jsx).
  orgBuilder: { label: 'Organisation Setup', icon: '🏗', perm: ['manage_org_units', 'create_org_units', 'edit_org_units', 'add_individual'] },
  orgStructure: { label: 'Organisation Maintenance', icon: '🏛', perm: ['manage_org_units', 'add_individual'] },
  planning: { label: 'Annual Plan & Budget', icon: '🧾' },
  compliance: { label: 'Compliance & Escalations', icon: '⏱' },
  reports: { label: 'Reports', icon: '▤', perm: 'view_reports' },
  audit: { label: 'Audit Log', icon: '≣', perm: 'view_audit' },
  settings: { label: 'Settings', icon: '⚙', perm: 'manage_settings' },
  users: { label: 'Permissions', icon: '🔑', perm: 'manage_users' },
  // No `perm` gate — internal messaging is deliberately open to every
  // signed-in account regardless of role or permissions, since the whole
  // point is real communication reaching straight across tiers.
  messages: { label: 'Messages', icon: '✉' },
};

// Framework is on every role's nav — everyone can see the programmes /
// sub-programmes / units / individuals tree read-only (it's the org chart
// they're part of), even if they hold none of the permissions that would
// let them add a unit, create a KPI, or edit targets from that same page.
// Compliance & Escalations is the org-wide oversight view (late-submission
// compliance and Red-KPI performance escalation, both surfaced from real
// data — see lib/compliance usage in pages/Compliance.jsx) — visible to the
// two roles who actually act on an escalation (Programme Head / VC chain):
// Corporate Planning Unit and Executives. It isn't a per-tier data-entry
// concern, so Reps/Unit Heads/Individuals don't need it in their nav.
// Overview and Framework are visible to every role by default (every seeded
// account holds view_overview/view_framework — see utils/permissions.js on
// the backend) but, like Reports/Audit/Settings/Users below, that's now a
// real, revocable permission ICT admin can take away from one specific
// person, not a hardcoded "everyone always sees this" rule.
// Annual Plan & Budget is the yearly planning cascade (see pages/Planning.jsx):
// Units submit a narrative + budget proposal for the next cycle, Sub-programme
// Reps approve those and submit their own sub-level narrative (its budget is
// always the derived sum of its units, never typed in), and CPU compiles each
// Programme and finally the whole University Annual Plan. Individuals and ICT
// Admin don't own a unit/sub in this workflow, so it's not in their nav.
// Order mirrors the original prototype's flow: a person whose job is data
// entry sees "My Data Entry" (and, once they have someone reporting to
// them, their review queue) before Overview, since that's the task they
// open the app to do — Overview is the look-around page, not the landing
// task. Global/oversight roles (exec/cpu/ictadmin) keep Overview first,
// since for them IT is the landing task.
// Programme Head: read-only oversight of every Sub-programme in their own
// Programme (Overview/Framework, same as everyone else) plus the one real
// action that's theirs at their tier — compiling & submitting (or approving
// a Sub-programme's proposal up into) their Programme's Annual Plan &
// Budget, see routes/plans.js's isProgrammeHeadOwner. No "My Data Entry" —
// a Programme never owns a KPI directly, so there's nothing at their own
// tier to fill in.
// kpiManagement/orgBuilder/orgStructure are added to exactly the role lists
// whose DEFAULT permission set (utils/permissions.js, backend) can hold
// create_kpi/edit_targets/manage_org_units/add_individual, plus
// rep/unithead for orgBuilder/orgStructure specifically — add_individual is
// designed to be grantable to a Sub Rep or Unit Head for their own scope
// (see its comment in OrganisationBuilder.jsx's AddIndividualForm), so
// their nav needs the key present for that grant to ever become reachable.
// orgBuilder is always placed immediately before orgStructure — build it,
// then maintain it — wherever both appear. Same convention every other
// permissioned nav key here already follows (e.g. 'settings' only in cpu's
// list) — perm-gating inside currentNav is the second filter, not the only
// one.
export const ROLE_NAV_KEYS = {
  exec: ['overview', 'framework', 'planning', 'compliance', 'reports', 'messages'],
  individual: ['entry', 'overview', 'framework', 'messages'],
  unithead: ['entry', 'approvals', 'overview', 'framework', 'orgBuilder', 'orgStructure', 'planning', 'messages'],
  rep: ['entry', 'approvals', 'overview', 'framework', 'orgBuilder', 'orgStructure', 'planning', 'messages'],
  cpu: ['overview', 'approvals', 'framework', 'kpiManagement', 'orgBuilder', 'orgStructure', 'planning', 'compliance', 'reports', 'audit', 'settings', 'messages'],
  // ICT System Administrator keeps 'framework' — the org chart read-only,
  // same as every other role — alongside the pages that act on the org
  // (KPI Management / Organisation Setup / Organisation Maintenance).
  ictadmin: ['overview', 'framework', 'kpiManagement', 'orgBuilder', 'orgStructure', 'users', 'audit', 'messages'],
  // 'approvals' added: a Sub-programme's own KPI submission is approved by
  // its own Programme Head, finally (see lib/scope.js's isApprover /
  // routes/kpis.js) — CPU has no role in this cascade — so Programme Head
  // needs a real Approvals Queue of their own now, not just read-only
  // oversight.
  programme: ['overview', 'approvals', 'framework', 'planning', 'reports', 'messages'],
  // University Council: read-only oversight (Overview/Framework/Reports,
  // same as every other role) plus the one real action that's theirs —
  // validating and approving (or returning) the University Annual Plan on
  // Annual Plan & Budget once CPU has submitted it. See pages/Planning.jsx's
  // CouncilPanel / routes/plans.js's POST /university/approve|return.
  council: ['overview', 'planning', 'framework', 'reports', 'messages'],
};

export function currentNav(user, hasPerm) {
  const keys = ROLE_NAV_KEYS[user.role] || ['overview'];
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
