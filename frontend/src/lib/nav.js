export const NAV_ITEMS = {
  overview: { label: 'Overview', icon: '◆', perm: 'view_overview' },
  entry: { label: 'My Data Entry', icon: '✎', perm: 'data_entry' },
  approvals: { label: 'Approvals Queue', icon: '✓', perm: 'approve_own_tier' },
  framework: { label: 'Framework', icon: '▦', perm: 'view_framework' },
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
export const ROLE_NAV_KEYS = {
  exec: ['overview', 'framework', 'planning', 'compliance', 'reports', 'messages'],
  individual: ['entry', 'overview', 'framework', 'messages'],
  unithead: ['entry', 'approvals', 'overview', 'framework', 'planning', 'messages'],
  rep: ['entry', 'approvals', 'overview', 'framework', 'planning', 'messages'],
  cpu: ['overview', 'approvals', 'framework', 'planning', 'compliance', 'reports', 'audit', 'settings', 'messages'],
  ictadmin: ['overview', 'framework', 'users', 'audit', 'messages'],
  programme: ['overview', 'framework', 'planning', 'reports', 'messages'],
};

export function currentNav(user, hasPerm) {
  const keys = ROLE_NAV_KEYS[user.role] || ['overview'];
  return keys.filter((k) => {
    const item = NAV_ITEMS[k];
    return !item.perm || hasPerm(item.perm);
  });
}
