import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';

// Auth Pages
import LoginPage from './components/auth/LoginPage';
import JoinPage from './components/auth/JoinPage';
import ProtectedRoute from './components/auth/ProtectedRoute';

// Tenant Layout + Pages
import TenantLayout from './components/TenantLayout';
import Dashboard from './components/Dashboard';
import Clients from './components/Clients';
import Documents from './components/Documents';
import Settings from './components/Settings';
import SubscriptionPage from './components/SubscriptionPage';
import Team from './components/Team';

// Client Portal (public, magic-link authenticated)
import ClientPortal from './components/ClientPortal';

// Master Admin
import MasterLogin from './components/master/MasterLogin';
import MasterLayout from './components/master/MasterLayout';
import MasterDashboard from './components/master/MasterDashboard';
import MasterTenants from './components/master/MasterTenants';
import MasterTenantDetail from './components/master/MasterTenantDetail';
import MasterBilling from './components/master/MasterBilling';
import MasterAdmins from './components/master/MasterAdmins';
import MasterPlans from './components/master/MasterPlans';

/**
 * Main Application Shell.
 *
 * Provider hierarchy:
 *   ThemeProvider → ToastProvider → AuthProvider → BrowserRouter → Routes
 *
 * SettingsProvider is nested inside TenantLayout because
 * settings are tenant-scoped and should only fetch when authenticated.
 */
function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <NotificationProvider>
          <BrowserRouter>
          <Routes>
            {/* ── Public Auth Routes ──────────────────────────── */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/join" element={<JoinPage />} />

            {/* ── Client Portal (public, magic-link) ─────────── */}
            <Route path="/portal/documents/:token" element={<ClientPortal />} />

            {/* ── Tenant-Scoped Routes ────────────────────────── */}
            <Route
              element={
                <ProtectedRoute>
                  <SettingsProvider>
                    <TenantLayout />
                  </SettingsProvider>
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/invoices" element={<Documents defaultType="invoice" initialView="list" />} />
              <Route path="/invoices/create" element={<Documents defaultType="invoice" initialView="create" />} />
              <Route path="/invoices/:id" element={<Documents defaultType="invoice" initialView="details" />} />
              <Route path="/quotes" element={<Documents defaultType="quote" initialView="list" />} />
              <Route path="/quotes/create" element={<Documents defaultType="quote" initialView="create" />} />
              <Route path="/quotes/:id" element={<Documents defaultType="quote" initialView="details" />} />

              <Route path="/team" element={<Team />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/subscription" element={<SubscriptionPage />} />
            </Route>

            {/* ── Master Admin Routes ─────────────────────────── */}
            <Route path="/master/login" element={<MasterLogin />} />
            <Route
              element={
                <ProtectedRoute requireMaster>
                  <MasterLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/master/dashboard" element={<MasterDashboard />} />
              <Route path="/master/plans" element={<MasterPlans />} />
              <Route path="/master/tenants" element={<MasterTenants />} />
              <Route path="/master/tenants/:id" element={<MasterTenantDetail />} />
              <Route path="/master/billing" element={<MasterBilling />} />
              <Route path="/master/admins" element={<MasterAdmins />} />
            </Route>

            {/* ── Catch-all redirect ──────────────────────────── */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
          </NotificationProvider>
        </AuthProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
