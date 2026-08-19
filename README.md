# ZOU IRBM Performance Dashboard — Frontend

A complete, production-structured frontend for the Zimbabwe Open University
Integrated Results-Based Management (IRBM) Performance Dashboard. Built strictly
against the ZOU IRBM Discovery Questionnaire. Backend-free by design — every
page reads through an Axios-shaped service layer, so connecting the real
Laravel/REST API later is a drop-in change, not a rewrite.

## 1. Final project structure

    src/
      api/
        client.ts            Axios instance, base URL + bearer token interceptor
      services/               One file per domain, Axios-shaped async functions
        authService.ts programmeService.ts subProgrammeService.ts unitService.ts
        kpiService.ts performanceService.ts alertService.ts complianceService.ts
        reportService.ts userService.ts auditService.ts strategicPlanService.ts
      hooks/                  TanStack Query wrappers around every service
        useProgrammes.ts useSubProgrammes.ts useUnits.ts useKpis.ts
        usePerformance.ts useAlerts.ts useCompliance.ts useReports.ts
        useUsers.ts useAudit.ts useStrategicPlans.ts
      context/
        AuthContext.tsx       Mock login (email/password + one-click role switch)
      forms/                  Zod schemas consumed by React Hook Form
        loginSchema.ts kpiSchema.ts performanceSubmissionSchema.ts
        overrideSchema.ts reviewSchema.ts
      types/                  Kpi, Programme, SubProgramme, OrgUnit, User, Alert,
                               ComplianceRecord, ReportItem, AuditEntry, StrategicGoal
      data/                   Realistic mock data matching ZOU's real Programme
                               structure (3 Programmes, 6 Sub-programmes, 14 Units,
                               15 KPIs, submissions, alerts, audit log, compliance)
      config/
        nav.ts                Role-aware navigation config (which roles see what)
        roleLabels.ts
      components/
        ui/                   shadcn-style primitives on Radix (Button, Card, Badge,
                               Input, Select, Dialog, ConfirmDialog, Tabs,
                               DropdownMenu, Toast, FormField, Label, Textarea)
        shared/                DataTable, EmptyState, ErrorState, Skeleton,
                               Breadcrumbs, StatCard, RagBadge, WorkflowBadge,
                               Sparkline, ProgressBar
        charts/                TrendChart, TargetVsActualChart, RagDonut,
                               ComplianceBarChart, ProgrammeComparisonChart,
                               PerformanceDistributionChart
        layout/                Sidebar (role-filtered), Header
      layouts/
        AppLayout.tsx AuthLayout.tsx
      routes/
        ProtectedRoute.tsx     Redirects to /login when not authenticated
      pages/
        auth/LoginPage.tsx
        dashboard/ExecutiveDashboard.tsx
        cpu/CpuDashboardPage.tsx          Automated quarterly analytics, tier/unit/KPI-category filters
        appraisal/                        Staff Reporting & Appraisal Procedure
          StaffWeeklyReportPage.tsx        Staff submit weekly job activity reports
          UnitHeadAppraisalPage.tsx        Unit Head appraises staff reports (0-100% score)
          UnitHeadPerformancePage.tsx      Unit Head submits own weekly performance report
          AdministrationEvaluationPage.tsx Administration evaluates, auto-forwards to CPU
          OperationalPlansPage.tsx         Unit Head → Programme Head → VC → Governance → CPU,
                                            with automatic archiving on submission
        programmes/ProgrammesPage.tsx ProgrammeDetailPage.tsx
        subprogrammes/SubProgrammesPage.tsx SubProgrammeDetailPage.tsx
        units/UnitsPage.tsx
        kpis/KpisListPage.tsx KpiDetailPage.tsx KpiFormPage.tsx
        performance/SubmitPerformancePage.tsx SubmissionsListPage.tsx CpuReviewPage.tsx
        analytics/AnalyticsPage.tsx
        reports/ReportsPage.tsx
        alerts/AlertsPage.tsx
        compliance/CompliancePage.tsx
        audit/AuditPage.tsx
        users/UsersPage.tsx
        settings/SettingsPage.tsx   (includes RAG threshold config + Manual Override)
      utils/
        cn.ts format.ts
      App.tsx main.tsx vite-env.d.ts

## 2. Technologies used

- React 19 + TypeScript, built with Vite
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- shadcn-style component layer hand-assembled on Radix UI primitives
  (`@radix-ui/react-dialog`, `-dropdown-menu`, `-tabs`, `-toast`, `-select`, `-label`) —
  the shadcn CLI itself pulls from a registry domain outside this build
  environment's network allowlist, so the components are the same Radix +
  Tailwind + `class-variance-authority` pattern shadcn generates, assembled
  directly instead of fetched
- React Router v6 for routing, with a `ProtectedRoute` guard
- TanStack Query for all data fetching/mutation state (loading, caching, invalidation)
- React Hook Form + Zod for every form (login, KPI create/edit, performance
  submission, manual override)
- Axios, configured with a base URL and bearer-token interceptor, ready for a
  real backend
- Recharts for all charts
- lucide-react for icons

## 3. Available routes

    /login                        Public
    /dashboard                    Executive dashboard (protected, all roles)
    /programmes                   Programme list
    /programmes/:id               Programme detail — Sub-programme breakdown, charts
    /sub-programmes               Sub-programme list
    /sub-programmes/:id           Sub-programme detail — KPI drill-down
    /units                        Organisational units (Faculties, Directorates,
                                   Regional Campuses, Departments)
    /kpis                         KPI list, filterable by Programme/status
    /kpis/new                     Create KPI (validated form)
    /kpis/:id                     KPI detail — overview / milestones / history / override tabs
    /kpis/:id/edit                Edit KPI
    /performance/submit           Monthly performance submission (Sub-programme Rep)
    /performance/submissions      All submissions, filterable by status
    /performance/review           CPU validation & approval queue
    /analytics                    Drill-down analytics (Programme → Sub-programme → Unit)
    /reports                      Report list, preview dialog, export action
    /alerts                       Alerts & escalation, with email-sent indicators
    /compliance                   Submission compliance dashboard
    /audit                        Audit trail
    /users, /roles                Users & roles
    /settings                     RAG thresholds, cadence, notifications, manual override

Unauthenticated visits to any protected route redirect to `/login`. Unknown
routes redirect to `/dashboard`.

## 4. Mock user roles

Every role can be previewed instantly from the login screen's role buttons —
no password needed for those. For the credentials form, any listed email
below with password `zou-demo-2026` works:

| Role | Email | Sidebar scope |
|---|---|---|
| Staff | t.marufu@zou.ac.zw | Submit weekly job activity reports |
| Unit Head | j.zvomuya@zou.ac.zw | Appraise staff, submit own performance, operational plans |
| Administration | administration@zou.ac.zw | Evaluate Unit Head performance reports |
| Vice-Chancellor | vc@zou.ac.zw | Full read access, CPU dashboard, audit trail |
| University Council | council@zou.ac.zw | Executive views |
| Programme Head | t.mangwiro@zou.ac.zw | Structure + KPI management for their Programme |
| Sub-programme Head | k.moyo@zou.ac.zw | KPI management, submission |
| Sub-programme Rep | p.ndlovu@zou.ac.zw | Submit performance only |
| Corporate Planning Unit | cpu@zou.ac.zw | Full access incl. CPU dashboard, validation, audit, settings |
| ICT Administrator | ictadmin@zou.ac.zw | Full access incl. users & settings |

The sidebar and available actions change based on the signed-in role — see
`src/config/nav.ts` for the exact role → navigation-item mapping. Every route
is also guarded server-side-equivalent in the frontend: `src/routes/RoleGuard.tsx`
wraps each route and redirects anyone without permission to their own default
landing page (`DEFAULT_ROUTE` in `nav.ts`), rather than showing a role a page
that isn't theirs. The Executive Dashboard, for example, is restricted to
Vice-Chancellor and CPU only — everyone else who tries the URL directly is
redirected to their relevant page instead.

## Staff Reporting & Appraisal Procedure

A second workflow layered onto the existing KPI/RAG system, following ZOU's
Staff Reporting and Appraisal Procedure:

- **Staff → Unit Head**: weekly job activity reports, appraised on a 0–100%
  score (`src/pages/appraisal/StaffWeeklyReportPage.tsx` +
  `UnitHeadAppraisalPage.tsx`)
- **Unit Head → Administration → CPU**: Unit Heads submit their own weekly
  performance report; Administration evaluates it (also 0–100%) and the
  evaluation auto-forwards to the CPU in the same action
  (`UnitHeadPerformancePage.tsx` + `AdministrationEvaluationPage.tsx`)
- **Operational Plans**: one uniform protocol for every Unit, Department,
  Faculty, and Regional Campus — Unit Head submits to their Programme Head
  for approval → Programme Head approves and forwards to the
  Vice-Chancellor → VC approves and forwards to CPU → CPU gives final
  evaluation, monitoring, approval and validation against budget and
  feasibility (`OperationalPlansPage.tsx`, `operationalPlanService.ts`). CPU's
  validation requires both a budget assessment and a feasibility assessment
  before a plan is marked `validated`. Every plan is submitted as an
  attached document (required), and every stage — submission, Programme Head
  review, VC review, rejection at any stage, and CPU validation — is
  independently timestamped. A copy is archived the moment a plan is
  submitted, independent of how far it's progressed through approval.
- **Required document attachments**: staff weekly reports, Unit Head
  performance reports, and operational plans all require an uploaded
  document at submission (`src/components/shared/FileAttachmentField.tsx`).
  The actual `File` object is kept on the record (not just a filename), so
  reviewers can download the original document, not just a filename label.
- **Downloads with timestamps**: every report, evaluation, and operational
  plan can be downloaded as a plain-text summary that includes every
  timestamp on the record — submission, review/approval, rejection, and
  validation (`src/utils/downloadText.ts`: `buildStaffReportText`,
  `buildUnitHeadReportText`, `buildOperationalPlanText`). Where an original
  document was uploaded, it can be downloaded separately alongside the
  summary. All client-side, no backend needed.
- **Feedback**: a Unit Head can send free-text feedback to a staff member at
  any time, independent of scoring — visible on the sender's own history
  view with a timestamp, and included in their downloadable summary
  (`staffAppraisalService.sendFeedback`).
- **CPU Dashboard** (`src/pages/cpu/CpuDashboardPage.tsx`): the automated
  analytics engine. `src/utils/quarterlyAnalytics.ts` is a pure function that
  buckets every scored weekly appraisal into its calendar quarter and
  averages per subject, per tier (staff / Unit Head), rolled up per unit —
  this is the "automatically average every 3 months" requirement. The
  dashboard lets CPU filter the resulting summaries by tier and unit, filter
  Programme KPIs by output/outcome category, and one-click generate a
  structured report per tier for the selected quarter (filed alongside the
  existing Programme KPI reports).

This module deliberately keeps its own scoring model (`score: number` 0–100,
no baseline/target) separate from the `Kpi` type, since staff and Unit Head
evaluations are direct percentage scores rather than baseline-relative RAG
KPIs — see `src/types/appraisal.ts`.

## 5. How to run the application

    npm install
    npm run dev

Open the local URL Vite prints (usually `http://localhost:5173`).

Build for production:

    npm run build
    npm run preview

Run the test suite:

    npm test

The build was verified in a sandbox: `npx tsc -b` (the same check `npm run
build` runs) passes with zero errors, `npm run build` produces a clean
`dist/` bundle, and `npm test` passes 27 tests covering the RAG threshold
logic, the quarterly analytics engine, and the AI assistant's intent
detection and role-access mapping — the three pieces of pure logic in this
project most likely to break silently without a test catching it.

## Reliability & UX improvements

**Latest pass — Profile & registration:**

- **A self-service Profile page** (`src/pages/profile/ProfilePage.tsx`, route
  `/profile`), reachable by every role from the "My profile" item in the
  header's account menu — no `RoleGuard` restriction, unlike almost every
  other route in the app. Lets anyone view and edit their own full name,
  email, role, and **station** — a Regional Campus, Department, Directorate,
  or Faculty, selected from the real `orgUnits` list rather than free text.
- **A real "Register user" flow on Users & Roles**, replacing what used to
  be a decorative button with no handler. Admins (CPU/ICT) fill the same
  four fields — full name, email, role (all ten), station — in a dialog,
  and the account is created immediately and shows up in the table.
- **Both forms share one Zod schema** (`src/forms/profileSchema.ts`), so
  "editing your own profile" and "an admin registering someone else" are the
  same validated shape, not two different implementations that could drift.
- **Editing your own profile updates the live session immediately** — no
  logout/login needed to see your new name or role reflected in the header
  and sidebar. `AuthContext` gained `updateCurrentUser()` specifically for
  this, keeping the in-memory session and `localStorage` in sync with
  whatever was just saved to the user record.
- `userService` is now mutable and persisted (`create`/`update`, both
  writing to the Audit Trail), matching every other service in the app
  instead of being the one remaining read-only stub.

**Earlier pass — the sidebar and page content now scroll independently:**

- **Fixed the actual bug, not just the symptom.** On desktop, the sidebar
  used `lg:static` so it could participate in the page's flex layout
  (needed for the resize/collapse work). But the outer shell only had
  `min-h-screen` — a *minimum* height, not a locked one — so once page
  content grew taller than the viewport, the whole shell grew with it, and
  the sidebar (now a normal flex item, no longer pinned) grew and scrolled
  right along with the page instead of staying put.
- **The fix**: `AppLayout.tsx`'s shell is now locked to `h-dvh overflow-hidden`
  — an exact viewport height that never grows — with exactly two places
  allowed to scroll inside it: the sidebar's `<nav>` (`flex-1 overflow-y-auto`,
  itself confined by the sidebar's own `h-dvh overflow-hidden`), and the page
  content in `<main>` (`flex-1 overflow-y-auto`). The `<html>`/`<body>` and
  every wrapping div in between never scroll — there is no single "page
  scroll" left to have.
- **Sidebar text enlarged and restyled** — nav item labels moved from 12px to
  14px, group headers from 10px to 12px with wider letter-spacing, the "ZOU
  IRBM" title to 16px extra-bold, icons from 15px to 17px, and the numbered
  workflow badges are visibly bigger (20px, up from 16px). Active items now
  also get a subtle shadow alongside the existing accent bar and background
  highlight, and hover states got a matching left-border cue instead of just
  a background change.

**Earlier pass — sidebar and page content now resize independently:**

- **The sidebar has a real drag-to-resize handle** (desktop only, on its
  right edge) — drag it inward to narrow the sidebar, outward to widen it
  (208–360px range), independent of whatever page is showing. Double-click
  the handle to reset to the default width. The chosen width persists per
  browser, same as the existing collapse-to-icons toggle, which still works
  alongside it.
- **The two are architecturally independent, not just visually.** The
  sidebar's width lives entirely in its own component state
  (`src/components/layout/Sidebar.tsx`) and is never read by the main
  content area. The main content column in `AppLayout.tsx` is a plain
  `flex-1 min-w-0` — it reflows to fill whatever space is left the instant
  the sidebar's width changes, via ordinary CSS flexbox, with no
  coordination or shared state between the two. Resizing, collapsing, or
  opening/closing the mobile drawer never triggers any layout logic in the
  page being viewed.
- Fixed a mobile-specific edge case introduced while building this: since
  the collapse toggle button is desktop-only, the collapsed flag no longer
  leaks onto the mobile drawer — a sidebar collapsed on desktop still opens
  at full width on mobile, where there's no way to un-collapse it.

**Earlier pass — real report generation and a real test suite:**

- **Appraisal reports generated from the CPU Dashboard now have real content.**
  Previously "Generate report" only added a list entry with nothing behind
  it — clicking Export always returned a placeholder URL, regardless of
  which report you picked. Now `reportService.generateAppraisalReport()`
  builds an actual text summary from the quarterly analytics engine
  (subject, unit, average score, weeks scored per person), stores it on the
  report, and Export/Download on the Reports page triggers a real file
  download for it. Seed reports standing in for a future backend-rendered
  PDF/XLSX are now labeled clearly as having no generated content, instead
  of silently behaving the same as a real report.
- **A real test suite** — `npm test` runs 27 Vitest tests across the three
  pieces of pure logic most likely to break silently: `ragStatus.ts` (RAG
  threshold boundaries, division-by-zero safety), `quarterlyAnalytics.ts`
  (quarter bucketing, averaging, tier separation, unscored-week exclusion),
  and `aiService.ts` (intent-detection regex matching, and that every role
  has a non-empty, correctly-restricted data-access list). See `npm test`
  in the run instructions above.

**Earlier pass — the performance-submission workflow is now actually real:**

- **Approving a performance submission now updates the KPI.** This was the
  most significant gap in the app: `performanceService.decide()` marked a
  submission "approved" but never wrote the new actual value onto the KPI
  record, so the Executive Dashboard, Analytics, and RAG status all stayed
  frozen regardless of what got approved. Now approval writes the new
  `actual` and appends to `trend`, and — because `kpiService` already
  recomputes status live from the configured thresholds — the KPI's RAG
  status updates immediately, everywhere it's shown.
- **Submission lateness is now a real calculation, not a hardcoded `false`.**
  A submission made after the 5th of the month is genuinely marked late
  (`DUE_DAY` in `performanceService.ts`), matching the due-day shown in
  Settings → Reporting cadence.
- **Submission Compliance reflects real activity.** Every performance
  submission now upserts a `ComplianceRecord` for its Sub-programme and
  month (`complianceService.recordSubmission()`), instead of that page only
  ever showing its original seed data regardless of what gets submitted.
- **Two new alert triggers**: a late submission generates a warning alert,
  and a KPI that ends up off-track after an approved submission generates a
  critical one — both tied to the same code path as the fix above, so
  Alerts coverage grew alongside the workflow it's meant to monitor.
- **Centralized the `unitHeadId` convention.** The `head-${unitId}` string
  pattern was duplicated across five call sites in four files; it's now a
  single `unitHeadIdFor()` helper in `src/utils/unitHeadId.ts`, so the
  convention only needs to change in one place if it ever does.

**Earlier pass — audit correctness, AI scoping, and workflow parity:**

- **Unit Head performance reports now have a reject/return path** — previously
  Administration and Programme Head could only evaluate-and-forward, with no
  way to send a report back for correction (staff appraisals already had
  this). `unitHeadAppraisalService.returnForCorrection()` and the shared
  `UnitHeadEvaluateRow` component now support it, and the returned reason is
  visible on the Unit Head's own submission history.
- **The AI Assistant now scopes answers to what each role actually sees on
  the real pages, not just which domains they can query.** A Programme Head
  asking about operational plans or KPIs now gets counts limited to their
  own Programme; a Unit Head asking about staff appraisals gets counts
  limited to reports sent to them; Administration/Programme Head get counts
  limited to reports addressed to them — matching the filtering already
  enforced on the Operational Plans page and the evaluation queues.
- **Logins are now recorded in the Audit Trail** — every `login()` /
  `loginAsRole()` call appends a "logged in" entry, closing the one gap
  where the trail was live everywhere except authentication events.
- **Fixed an unsafe render-body `setState`** in `RagThresholdsPanel` — the
  threshold values were being hydrated from a query result directly inside
  the render function instead of a `useEffect`, which works but isn't a
  safe React pattern. Moved to `useEffect`.
- **"Clear conversation" in the AI Assistant now confirms first** — using
  the app's existing `ConfirmDialog` component, which (worth noting) had
  been built earlier but never actually used anywhere until now. Also
  brought `Dialog`/`ConfirmDialog` up to dark-mode parity with the rest of
  the app while wiring it in.

**Earlier pass — persistence, live audit/alerts, and workflow completeness:**

- **Everything persists across a refresh now** — KPIs, staff/Unit Head
  appraisals, operational plans, performance submissions, alerts, and the
  audit trail all survive a reload via `src/utils/persistedStore.ts`
  (`localStorage`-backed). One real limitation: uploaded `File` objects
  aren't JSON-serializable, so attachment metadata (name, upload date)
  persists but the original file bytes don't — "Download document" is only
  available for attachments uploaded in the current session. A real backend
  removes this limitation entirely.
- **The Audit Trail is live**, not frozen seed data — appraising, returning,
  evaluating, approving, rejecting, validating, and overriding all append a
  real timestamped entry now (`auditService.append()`, called from every
  mutating service function).
- **Alerts generate from real activity** — rejecting an operational plan now
  creates a critical alert automatically (`alertService.append()`), instead
  of the Alerts page only ever reflecting its seed data.
- **"Return for correction" sends a real reason** — the Unit Head types
  their own note in a textarea before returning a staff report; it used to
  send a hardcoded placeholder string regardless of what was typed.
- **Rejected operational plans can be resubmitted** — `operationalPlanService.resubmit()`
  restarts the chain at Programme Head, keeping the rejection in the audit
  trail rather than just leaving the plan dead-ended.
- **File attachments are validated** — type-restricted (PDF/Word/images) and
  capped at 10 MB with inline errors, instead of silently accepting anything.
- **Operational Plans page has status/programme filters** on its main list,
  matching every other list page in the app.
- **CPU Dashboard shows the operational-plans pipeline** (counts by stage),
  not just appraisal analytics.
- **AI Assistant persists its conversation per-user** and has a real error
  state instead of hanging silently if a query fails.
- **Sidebar redesign** — regrouped into a real hierarchy: Overview → **Your
  workflow** (the signed-in role's own action items, numbered and visually
  highlighted) → Organisation → Performance & reporting → Administration.

Beyond the core IRBM and appraisal features, the following were added to close
gaps between what the UI implies works and what actually does:

- **Auth survives a refresh** — `AuthContext` rehydrates from `localStorage`
  instead of dropping the session on reload.
- **RAG thresholds are real** — Settings → RAG thresholds now persists to
  `localStorage` via `settingsService`, and `kpiService` recomputes every
  KPI's status live from those thresholds (`src/utils/ragStatus.ts`) instead
  of a value baked in at seed time.
- **Working global search** — the header search bar queries KPIs, Programmes,
  and Reports and links straight to the match.
- **Error boundary** — a single top-level boundary (`src/components/shared/ErrorBoundary.tsx`)
  catches render errors app-wide instead of showing a blank white screen.
- **Skeleton loading states** — replaced blank-screen loading on detail pages
  with `PageLoading`, consistent with the skeletons already used in tables.
- **Code splitting** — every page is `React.lazy`-loaded behind a `Suspense`
  boundary; the initial JS payload dropped from one ~1.1 MB bundle to a
  ~460 KB main chunk plus per-page chunks loaded on demand.
- **Sidebar** — collapsible (persisted per browser), an accent bar on the
  active item, and a footer with the signed-in user's name, role, and a
  one-click sign-out.
- **Programme Head evaluation inbox** (`ProgrammeHeadEvaluationPage.tsx`) —
  when a Unit Head addresses their performance report to a Programme Head
  instead of Administration, there's now a page to actually evaluate it.
- **Editable KPI milestones** — the KPI form now exposes Q1–Q4 target fields
  directly instead of always splitting the annual target evenly.
- **Audit trail search** — a text filter across record/user/module, alongside
  the existing action-type filter.
- **`.env.example`** for `VITE_API_BASE_URL`.

## AI Assistant

`src/pages/assistant/AiAssistantPage.tsx` — a role-scoped natural-language
query interface, available to every role from the sidebar.

**This is a mock, not a real LLM integration** — and deliberately so. A
browser cannot safely hold an LLM API key, so `src/services/aiService.ts`
demonstrates the *architecture* (detect what the question is about, check
whether the caller's role is allowed to see that data, assemble an answer
from only the permitted domains) using simple keyword matching against the
existing mock services instead of an actual model call.

`ROLE_DATA_ACCESS` in `aiService.ts` defines which data domains (KPIs,
Programmes, operational plans, compliance, audit, alerts, staff/Unit Head
appraisals, users) each role may query — mirroring the route-level access
rules already enforced in `src/config/nav.ts` and `src/routes/RoleGuard.tsx`.

**To connect a real LLM:**

1. Replace the body of `aiService.ask()` with a single
   `apiClient.post('/ai/query', { query })` call. Every page that uses the
   assistant (`AiAssistantPage.tsx`, via `useAskAssistant()`) keeps working
   unchanged — only this one function's implementation changes.
2. On the backend, derive the caller's role from their authenticated
   session — **never trust a role sent from the client**. The current
   frontend passes `user` into `ask()` for the mock's convenience, but a
   real backend must re-derive permissions server-side, not accept them as
   input.
3. Assemble only the data that role is allowed to see (same domain list as
   `ROLE_DATA_ACCESS`, enforced server-side this time) into the LLM's
   context, then send the question + that scoped context to the model.
4. Return the answer. The `{ answer, domains, denied }` response shape is
   already what the UI expects.

## 6. Remaining backend/API integration points

Every page calls a hook in `src/hooks/`, which calls a function in
`src/services/`, which currently reads from `src/data/` mock arrays with a
simulated network delay. To connect the real Laravel API:

1. In each `src/services/*.ts` file, replace the mock function body with an
   `apiClient` call to the matching endpoint — e.g.
   `kpiService.list()` → `apiClient.get('/kpis', { params: filters })`,
   `performanceService.submit()` → `apiClient.post('/performance-submissions', payload)`,
   `kpiService.override()` → `apiClient.post('/kpis/{id}/override', payload)`.
   The hooks and every page stay untouched — they only know about the
   service functions' return shape, defined in `src/types/`.
2. Replace `authService.login()` with a real
   `POST /auth/login` call (e.g. Laravel Sanctum), and store the returned
   token — `src/api/client.ts` already reads it from `localStorage` under
   `zou_irbm_token` on every request.
3. RAG thresholds are intentionally not hard-coded (the questionnaire states
   ZOU has no standard thresholds yet) — the Settings → RAG thresholds tab is
   wired to local component state as a placeholder; wire it to a real
   `GET/PUT /settings/rag-thresholds` endpoint once one exists, and have
   `kpiService` (or the backend) compute `status` from those thresholds
   instead of the current hard-coded 85%/60% split in `src/data/kpis.ts`.
4. Report export (`reportService.export`) returns a placeholder `{ url: "#" }`
   — connect it to whatever endpoint generates the PDF/XLSX server-side.
5. `VITE_API_BASE_URL` is read in `src/api/client.ts`; set it in a `.env` file
   once the backend exists (defaults to `/api`).

No routing, layout, or page component needs to change for any of the above —
that's the seam this architecture was built around.
