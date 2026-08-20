# ZOU IRBM Performance Dashboard — Frontend

A frontend for the Zimbabwe Open University Integrated Results-Based
Management (IRBM) Performance Dashboard, built strictly against the ZOU
IRBM Discovery Questionnaire (Q1–Q32). React + TypeScript + Tailwind CSS,
backend-free by design — every page reads through an Axios-shaped service
layer, so connecting a real Laravel/REST API later is a drop-in change,
not a rewrite.

**This project was deliberately re-scoped back to the questionnaire.** An
earlier iteration grew to include a Staff Appraisal system, Operational
Plans, an AI Assistant, and self-registration — none of which are in this
questionnaire. All four were removed. What's left is what the questionnaire
actually asks for, plus the gaps it identified as still open, closed.

## 1. Project structure

    src/
      types/                  Kpi, Programme, SubProgramme, OrgUnit, User,
                               Alert, ComplianceRecord, ReportItem, AuditEntry
      data/                   Realistic mock data matching ZOU's real
                               Programme/Sub-programme/Unit structure
      services/                Axios-shaped async functions per domain —
                               kpiService, programmeService, subProgrammeService,
                               unitService, performanceService, complianceService,
                               alertService, reportService, userService,
                               auditService, authService, settingsService
      hooks/                  TanStack Query wrappers around every service
      context/
        AuthContext.tsx        Session state, rehydrated from localStorage
        ThemeContext.tsx       Light/dark theme
      forms/                  Zod schemas for React Hook Form
      config/
        nav.ts                 Role-aware navigation + DEFAULT_ROUTE per role
        roleLabels.ts
      utils/
        ragStatus.ts            RAG threshold computation (Q14)
        reportingPeriods.ts      Monthly reporting calendar (Q22)
        escalation.ts            Live escalation-chain computation (Q31)
        persistedStore.ts        localStorage-backed mock persistence
      components/
        ui/                     shadcn-style primitives on Radix
        shared/                 DataTable, StatCard, RagBadge, WorkflowBadge...
        charts/                 Recharts wrappers
        layout/                 Sidebar (resizable, collapsible), Header
      layouts/
        AppLayout.tsx AuthLayout.tsx
      routes/
        ProtectedRoute.tsx RoleGuard.tsx DefaultRedirect.tsx
      pages/
        auth/LoginPage.tsx
        dashboard/ExecutiveDashboard.tsx
        programmes/ · subprogrammes/ · units/     Structure browsing
        kpis/                   List, detail (with cascade chain — Q16),
                                 create/edit (with linked-Programme tag — Q13)
        performance/            Submit (calendar-enforced — Q22), CPU review
        analytics/              Drill-down analytics
        reports/                Real report generation (Q32)
        alerts/                 Live-escalating alerts (Q31)
        compliance/             Submission compliance (Q23)
        audit/                  Audit trail (Q19)
        users/                  Users & roles
        settings/               RAG thresholds (Q14), manual override (Q24)
        profile/                Self-service account profile
      App.tsx main.tsx vite-env.d.ts

## 2. Technologies used

- React 19 + TypeScript, Vite
- Tailwind CSS v4
- shadcn-style components on Radix UI (`@radix-ui/react-dialog`,
  `-dropdown-menu`, `-tabs`, `-toast`, `-select`, `-label`)
- React Router v6, TanStack Query, React Hook Form + Zod, Axios, Recharts,
  lucide-react
- Vitest for the pure-logic test suite

## 3. Mock user roles

Three-tier access model per Q21 (Council/VC read-only, Sub-programme Reps
data-entry, CPU/ICT full admin), plus Programme Head and Sub-programme Head
for the cascading target-setting workflow (Q16). Any listed email below
with password `zou-demo-2026` works, or use the login screen's role-preview
buttons:

| Role | Email | Sidebar scope |
|---|---|---|
| Vice-Chancellor | vc@zou.ac.zw | Executive dashboard, full read access |
| University Council | council@zou.ac.zw | Reports, structure browsing |
| Programme Head | t.mangwiro@zou.ac.zw | KPI management + cascade for their Programme |
| Sub-programme Head | k.moyo@zou.ac.zw | KPI management + cascade for their Sub-programme |
| Sub-programme Rep | p.ndlovu@zou.ac.zw | Submit performance only |
| Corporate Planning Unit | cpu@zou.ac.zw | Full access incl. validation, audit, settings |
| ICT Administrator | ictadmin@zou.ac.zw | Full access incl. users & settings |

## 4. How to run

    npm install
    npm run dev

Build for production:

    npm run build
    npm run preview

Run the test suite:

    npm test

Verified in a sandbox: `npx tsc -b` passes with zero errors, `npm run build`
produces a clean `dist/` bundle, and `npm test` passes 18 tests.

## 5. Questionnaire alignment

This section exists because the questionnaire, not a running list of
feature requests, is the actual spec this project is scoped against.

### Implemented

- **Q7–Q12** — 3 Programmes / strategic pillars, fixed 2-level Programme →
  Sub-programme → Unit hierarchy, output/outcome typing, baseline/target/
  quarterly-milestone model
- **Q13** — tree-shaped KPI model with an optional `linkedProgrammeId` tag
  for genuinely cross-cutting KPIs, shown as a badge on KPI detail
  (`KpiFormPage.tsx`, `KpiDetailPage.tsx`)
- **Q14** — no hardcoded RAG standard; thresholds are configurable in
  Settings and every KPI's status is recomputed live from them
  (`utils/ragStatus.ts`, `settingsService.ts`)
- **Q16** — cascading target-setting: a Programme Head or Sub-programme
  Head can take a KPI they're accountable for and "Cascade target" into a
  new KPI at the level below, tracked via `parentKpiId`. KPI Detail shows
  the full cascade chain (`KpiFormPage.tsx` cascade mode, `KpiDetailPage.tsx`)
- **Q17–Q19** — role-separated data entry, the
  Submitted → Pending CPU Review → Approved/Visible workflow, and a real
  Audit Trail (every submit/approve/reject/edit/override writes a
  timestamped entry)
- **Q21** — three-tier access model, enforced by `RoleGuard` on every route
- **Q22** — monthly reporting cadence is a real calendar, not free text
  (`utils/reportingPeriods.ts`) — the submission form only offers actual
  months, and flags when the selected one is already past its due date
- **Q23** — late submissions are computed from real dates (not hardcoded),
  and feed a live Submission Compliance page per Sub-programme
- **Q24** — manual override: the system-calculated value stays visible
  alongside an annotated override (`Kpi.override`)
- **Q25** — near-real-time within a session via TanStack Query's cache
  invalidation on every mutation (literal push/streaming would need real
  backend infrastructure this frontend can't provide alone)
- **Q31** — escalation follows the org hierarchy and now actually climbs
  it: `utils/escalation.ts` computes an alert's current escalation step
  live from how long it's sat unacknowledged, instead of trusting a static
  field set once at creation
- **Q32** — reports are generated directly from live data, not a parallel
  manual process: `reportService.generateKpiAchievementReport()`,
  `generateProgrammePerformanceReport()`, and `generateComplianceReport()`
  pull from the same services every other page reads from and produce real,
  downloadable content

### Addressed by what's absent, not by a lock screen

- **Q4** — Programme-level structure (create/rename/retire) sits at
  Ministry level per the questionnaire and cannot be changed unilaterally
  by the University. There is no create/edit UI for Programmes anywhere in
  this app — the constraint is satisfied by the capability not existing,
  and the Programmes page states the governance reason explicitly rather
  than leaving it implicit.
- **Q5** — the same page states the 5-year plan cycle and annual review
  checkpoint. There's no structural-edit capability to gate against ad hoc
  changes, so there's nothing to lock.

### Partial

- **Q2** — Strategic Plans exist as a general concept referenced in the UI,
  but "Annual Plan" and "Sub-Programme Plan" as distinct tracked documents
  aren't modeled
- **Q9** — the Unit/Faculty/Regional Campus/Department layer exists and
  holds real KPIs; a target cascading specifically to *an individual person*
  (as opposed to an organizational unit) isn't modeled
- **Q11** — Target + quarterly Milestone are real, editable fields; the
  Goal → Objective → Strategy layer above them is a single free-text
  description, not a modeled hierarchy
- **Q20** — RAG thresholds exist and an alert fires automatically when an
  approved submission lands off-track; whether an explanation is
  *mandatory* before submitting an off-target figure at the form level is
  unconfirmed — check `SubmitPerformancePage.tsx` directly if this matters
- **Q26** — the data model supports entering a baseline per KPI; there's no
  dedicated setup wizard for bulk-entering a year of prior baselines at
  go-live

### Not in scope

Q1, Q3, Q6, Q15, Q27–Q30 are organizational/process questions (who has
signing authority, national templates, etc.) without a corresponding
buildable frontend feature, or weren't reached in this pass.

## 6. Remaining backend/API integration points

Every page calls a hook in `src/hooks/`, which calls a function in
`src/services/`, which currently reads from `src/data/` mock arrays (with a
simulated network delay) or a `localStorage`-backed mock store. To connect
a real Laravel API:

1. Replace each service function's body with an `apiClient` call to the
   matching endpoint — the TypeScript types in `src/types/` already define
   the contract both sides should agree on.
2. Move RAG threshold logic (`utils/ragStatus.ts`), escalation logic
   (`utils/escalation.ts`), and report generation
   (`reportService.generate*`) to run server-side against real data, with
   the frontend just fetching results — they're pure functions today
   specifically so that move is mechanical, not a rewrite.
3. `RoleGuard` is real UX but not real security — a client can't enforce
   its own access control. Every permission check here needs to be
   re-implemented server-side against the authenticated session, not
   trusted from the client.
