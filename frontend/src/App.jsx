import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ToastProvider } from './context/ToastContext';

// Auth Pages
import LoginPage from './components/auth/LoginPage';
import JoinPage from './components/auth/JoinPage';
import ProtectedRoute from './components/auth/ProtectedRoute';

// Tenant Layout + Pages
import TenantLayout from './components/TenantLayout';
import Dashboard from './components/Dashboard';
import Clients from './components/Clients';
import Documents from './components/Documents';
import Vendors from './components/Vendors';
import Settings from './components/Settings';
import SubscriptionPage from './components/SubscriptionPage';

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

/**
 * Main Application Shell.
 *
 * Provider hierarchy:
 *   ToastProvider → AuthProvider → BrowserRouter → Routes
 *
 * SettingsProvider is nested inside TenantLayout because
 * settings are tenant-scoped and should only fetch when authenticated.
 */
function App() {
  return (
    <ToastProvider>
      <AuthProvider>
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
              <Route path="/documents" element={<Documents initialView="list" />} />
              <Route path="/documents/create" element={<Documents initialView="create" />} />
              <Route path="/vendors" element={<Vendors />} />
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
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
