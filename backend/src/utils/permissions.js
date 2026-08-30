// Single source of truth for the permission catalog, mirrored into the
// `permissions` table by seed.js. Every protected route re-checks the
// requesting user's CURRENT permission rows in the database — nothing is
// trusted from the JWT beyond "which user id is this" — so a revoke by ICT
// takes effect on the user's very next request, not just their next login.

const PERMISSIONS = [
  { key: 'data_entry', label: 'Enter & submit own data', group: 'Data' },
  { key: 'approve_own_tier', label: 'Approve submissions from the tier below', group: 'Data' },
  { key: 'apply_override', label: 'Apply manual overrides on automated KPIs', group: 'Data' },
  { key: 'edit_targets', label: 'Edit KPI baselines & targets', group: 'Framework' },
  { key: 'create_kpi', label: 'Create new KPIs', group: 'Framework' },
  { key: 'manage_org_units', label: 'Create Units / Departments / Faculties / Regions', group: 'Framework' },
  // Deliberately separate from manage_org_units: lets ICT admin hand a Sub
  // Rep or Unit Head just the ability to add an Individual under their own
  // scope, without also granting them unit-creation. See routes/org.js for
  // the scope check this permission is bound by when granted on its own.
  { key: 'add_individual', label: 'Add an Individual (within own scope)', group: 'Framework' },
  { key: 'manage_framework', label: 'Propose structural changes', group: 'Framework' },
  { key: 'submit_annual_plan', label: 'Compile & submit the university annual plan', group: 'Framework' },
  { key: 'manage_settings', label: 'Manage RAG thresholds & cutoffs', group: 'Admin' },
  { key: 'manage_users', label: 'Grant & revoke permissions', group: 'Admin' },
  { key: 'view_reports', label: 'View Reports', group: 'Visibility' },
  { key: 'view_audit', label: 'View Audit Log', group: 'Visibility' },
  // Overview and Framework used to be unconditionally visible to every
  // signed-in user (no permission gated them at all). They still are, by
  // default — every role below is seeded holding both — but making them
  // real, revocable permissions means ICT admin can now actually take a
  // specific person's Overview or Framework access away, the same way
  // Reports/Audit/Settings already work.
  { key: 'view_overview', label: 'View Overview page', group: 'Visibility' },
  { key: 'view_framework', label: 'View Framework page', group: 'Visibility' },
];

// Role -> default permission set, used only at seed time. Permissions live
// per-user in the database from then on, not hardcoded to role at request time.
const DEFAULT_PERMS_BY_ROLE = {
  exec: ['view_reports', 'view_audit', 'view_overview', 'view_framework'],
  cpu: ['approve_own_tier', 'manage_settings', 'create_kpi', 'edit_targets', 'manage_org_units', 'manage_framework', 'submit_annual_plan', 'view_reports', 'view_audit', 'view_overview', 'view_framework'],
  // ICT System Administrators manage the organisational structure (units,
  // departments, faculties, regions, and individuals), the KPI catalogue
  // itself (creating new KPIs, not just editing targets on existing ones),
  // and overrides, by default, in addition to their exclusive
  // permission-management role — they don't have to grant these to
  // themselves first.
  ictadmin: ['manage_users', 'manage_org_units', 'create_kpi', 'edit_targets', 'apply_override', 'view_audit', 'view_overview', 'view_framework'],
  rep: ['data_entry', 'approve_own_tier', 'view_overview', 'view_framework'],
  unithead: ['data_entry', 'approve_own_tier', 'view_overview', 'view_framework'],
  individual: ['data_entry', 'view_overview', 'view_framework'],
  // Programme Head: oversees one whole Programme — every Sub-programme
  // beneath it, read-only for the KPI/appraisal side (a Programme never
  // owns KPIs directly — see kpis.owner_type's CHECK constraint — so
  // there's nothing at their own tier to enter), but the real acting
  // authority at the Programme tier of the Annual Plan & Budget cascade:
  // compiling and submitting their Programme's plan once every
  // Sub-programme under them has been approved (see routes/plans.js's
  // isProgrammeHeadOwner). 'data_entry' is what gates that write, the same
  // permission every other tier's plan-entry route already requires.
  programme: ['data_entry', 'view_overview', 'view_framework', 'view_reports'],
};

module.exports = { PERMISSIONS, DEFAULT_PERMS_BY_ROLE };
