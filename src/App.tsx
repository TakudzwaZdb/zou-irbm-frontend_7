import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleGuard } from "./routes/RoleGuard";
import { DefaultRedirect } from "./routes/DefaultRedirect";
import { PageLoading } from "./components/shared/PageLoading";

import LoginPage from "./pages/auth/LoginPage";

function SuspenseOutlet() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Outlet />
    </Suspense>
  );
}

const ExecutiveDashboard = lazy(() => import("./pages/dashboard/ExecutiveDashboard"));
const ProgrammesPage = lazy(() => import("./pages/programmes/ProgrammesPage"));
const ProgrammeDetailPage = lazy(() => import("./pages/programmes/ProgrammeDetailPage"));
const SubProgrammesPage = lazy(() => import("./pages/subprogrammes/SubProgrammesPage"));
const SubProgrammeDetailPage = lazy(() => import("./pages/subprogrammes/SubProgrammeDetailPage"));
const UnitsPage = lazy(() => import("./pages/units/UnitsPage"));
const KpisListPage = lazy(() => import("./pages/kpis/KpisListPage"));
const KpiDetailPage = lazy(() => import("./pages/kpis/KpiDetailPage"));
const KpiFormPage = lazy(() => import("./pages/kpis/KpiFormPage"));
const SubmitPerformancePage = lazy(() => import("./pages/performance/SubmitPerformancePage"));
const SubmissionsListPage = lazy(() => import("./pages/performance/SubmissionsListPage"));
const CpuReviewPage = lazy(() => import("./pages/performance/CpuReviewPage"));
const AnalyticsPage = lazy(() => import("./pages/analytics/AnalyticsPage"));
const ReportsPage = lazy(() => import("./pages/reports/ReportsPage"));
const AlertsPage = lazy(() => import("./pages/alerts/AlertsPage"));
const CompliancePage = lazy(() => import("./pages/compliance/CompliancePage"));
const AuditPage = lazy(() => import("./pages/audit/AuditPage"));
const UsersPage = lazy(() => import("./pages/users/UsersPage"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const ProfilePage = lazy(() => import("./pages/profile/ProfilePage"));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route element={<SuspenseOutlet />}>
              <Route path="/" element={<DefaultRedirect />} />

              <Route path="/dashboard" element={<RoleGuard roles={["vc", "cpu"]}><ExecutiveDashboard /></RoleGuard>} />
              <Route path="/profile" element={<ProfilePage />} />

              <Route path="/programmes" element={<RoleGuard roles={["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"]}><ProgrammesPage /></RoleGuard>} />
              <Route path="/programmes/:id" element={<RoleGuard roles={["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"]}><ProgrammeDetailPage /></RoleGuard>} />
              <Route path="/sub-programmes" element={<RoleGuard roles={["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"]}><SubProgrammesPage /></RoleGuard>} />
              <Route path="/sub-programmes/:id" element={<RoleGuard roles={["vc", "council", "programme_head", "subprogramme_head", "subprogramme_rep", "cpu", "ict"]}><SubProgrammeDetailPage /></RoleGuard>} />
              <Route path="/units" element={<RoleGuard roles={["vc", "programme_head", "subprogramme_head", "cpu", "ict"]}><UnitsPage /></RoleGuard>} />

              <Route path="/kpis" element={<RoleGuard roles={["vc", "programme_head", "subprogramme_head", "cpu", "ict"]}><KpisListPage /></RoleGuard>} />
              <Route path="/kpis/new" element={<RoleGuard roles={["vc", "programme_head", "subprogramme_head", "cpu", "ict"]}><KpiFormPage /></RoleGuard>} />
              <Route path="/kpis/:id" element={<RoleGuard roles={["vc", "programme_head", "subprogramme_head", "cpu", "ict"]}><KpiDetailPage /></RoleGuard>} />
              <Route path="/kpis/:id/edit" element={<RoleGuard roles={["vc", "programme_head", "subprogramme_head", "cpu", "ict"]}><KpiFormPage /></RoleGuard>} />

              <Route path="/performance/submit" element={<RoleGuard roles={["subprogramme_rep", "subprogramme_head", "ict"]}><SubmitPerformancePage /></RoleGuard>} />
              <Route path="/performance/submissions" element={<RoleGuard roles={["subprogramme_rep", "subprogramme_head", "cpu", "ict"]}><SubmissionsListPage /></RoleGuard>} />
              <Route path="/performance/review" element={<RoleGuard roles={["cpu", "ict"]}><CpuReviewPage /></RoleGuard>} />

              <Route path="/analytics" element={<RoleGuard roles={["vc", "council", "programme_head", "subprogramme_head", "cpu", "ict"]}><AnalyticsPage /></RoleGuard>} />
              <Route path="/reports" element={<RoleGuard roles={["vc", "council", "programme_head", "subprogramme_head", "cpu", "ict"]}><ReportsPage /></RoleGuard>} />
              <Route path="/alerts" element={<RoleGuard roles={["vc", "programme_head", "subprogramme_head", "cpu", "ict"]}><AlertsPage /></RoleGuard>} />
              <Route path="/compliance" element={<RoleGuard roles={["vc", "programme_head", "subprogramme_head", "cpu", "ict"]}><CompliancePage /></RoleGuard>} />
              <Route path="/audit" element={<RoleGuard roles={["cpu", "ict", "vc"]}><AuditPage /></RoleGuard>} />

              <Route path="/users" element={<RoleGuard roles={["ict", "cpu"]}><UsersPage /></RoleGuard>} />
              <Route path="/roles" element={<RoleGuard roles={["ict", "cpu"]}><UsersPage /></RoleGuard>} />
              <Route path="/settings" element={<RoleGuard roles={["ict", "cpu"]}><SettingsPage /></RoleGuard>} />

              <Route path="*" element={<DefaultRedirect />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
