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
  // The University Council's own authority: the one gate the compiled
  // Annual Plan (and the structure it's built from — every Programme's
  // compiled position beneath it) must pass before it's official for the
  // cycle — see routes/plans.js's POST /university/approve|return. Kept as
  // a real, revocable permission (not a hardcoded role check) so ICT admin
  // can extend or narrow exactly who sits on Council the same way every
  // other authority in this app works.
  { key: 'validate_annual_plan', label: 'Validate & approve the University Annual Plan (University Council)', group: 'Governance' },
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
  // The university-wide "Overall Institutional Performance" rollup (the
  // root of Overview's drill-down, above every Programme) used to be
  // automatically visible to whoever held one of four hardcoded roles
  // (exec/cpu/ictadmin/council) — no permission gated it at all, unlike
  // Overview/Framework above. It's now a real, revocable permission of its
  // own: ICT admin decides who can see and navigate to the institution-wide
  // aggregate, the same way every other visibility permission here already
  // works, rather than it being an automatic consequence of a person's
  // role. See pages/Overview.jsx and components/OrgTree.jsx.
  { key: 'view_institutional_performance', label: 'View Overall Institutional Performance (All Programmes)', group: 'Visibility' },
];

// Role -> default permission set, used only at seed time. Permissions live
// per-user in the database from then on, not hardcoded to role at request time.
const DEFAULT_PERMS_BY_ROLE = {
  exec: ['view_reports', 'view_audit', 'view_overview', 'view_framework', 'view_institutional_performance'],
  cpu: ['approve_own_tier', 'manage_settings', 'create_kpi', 'edit_targets', 'manage_org_units', 'manage_framework', 'submit_annual_plan', 'view_reports', 'view_audit', 'view_overview', 'view_framework', 'view_institutional_performance'],
  // ICT System Administrators manage the organisational structure (units,
  // departments, faculties, regions, and individuals), the KPI catalogue
  // itself (creating new KPIs, not just editing targets on existing ones),
  // and overrides, by default, in addition to their exclusive
  // permission-management role — they don't have to grant these to
  // themselves first.
  ictadmin: ['manage_users', 'manage_org_units', 'create_kpi', 'edit_targets', 'apply_override', 'view_audit', 'view_overview', 'view_framework', 'view_institutional_performance'],
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
  // 'approve_own_tier' is the SAME permission Sub Reps/Unit Heads already
  // hold, now also granted here: a Sub-programme's own KPI performance
  // submission (owner_type = 'sub') stops at the Programme Head first for
  // review before it ever reaches CPU — see routes/kpis.js's isApprover
  // and the two-stage 'submitted' -> 'programme_approved' -> 'approved'
  // flow on kpi_values.status.
  programme: ['data_entry', 'approve_own_tier', 'view_overview', 'view_framework', 'view_reports'],
  // University Council: the final sign-off tier above CPU's own compiled
  // submission — read-only everywhere else in the app (no data_entry, no
  // approve_own_tier — Council doesn't run any tier's day-to-day KPI
  // cascade), but the one account type that can actually validate/approve
  // or return the University Annual Plan once CPU has submitted it. See
  // routes/plans.js.
  council: ['view_reports', 'view_overview', 'view_framework', 'validate_annual_plan', 'view_institutional_performance'],
};

module.exports = { PERMISSIONS, DEFAULT_PERMS_BY_ROLE };
