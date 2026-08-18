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
- **Operational Plans**: two protocols depending on the submitting unit's
  type. Faculty Deans and Regional Campus Directors submit directly to the
  Vice-Chancellor (Unit Head → VC → Governance → CPU); every other Unit Head
  goes through the standard chain (Unit Head → Programme Head → VC →
  Governance → CPU). `src/services/operationalPlanService.ts` exports
  `getPlanChain(unitId)`, which picks the right chain from the unit's `type`
  — the page renders whichever chain applies per plan rather than one fixed
  sequence. A copy is archived automatically the moment a plan is submitted,
  not at the end of the chain, and Governance's approval automatically
  forwards the plan to CPU (`OperationalPlansPage.tsx`)
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

The build was verified in a sandbox: `npx tsc --noEmit` passes with zero
errors, and `npm run build` produces a clean `dist/` bundle.

## Reliability & UX improvements

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
#   z o u - i r b m - f r o n t e n d _ 7  
 