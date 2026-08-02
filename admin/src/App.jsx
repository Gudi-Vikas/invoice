import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';

// Auth Pages
import ProtectedRoute from './components/auth/ProtectedRoute';

// Master Admin
import MasterLogin from './components/master/MasterLogin';
import MasterLayout from './components/master/MasterLayout';
import MasterDashboard from './components/master/MasterDashboard';
import MasterTenants from './components/master/MasterTenants';
import MasterTenantDetail from './components/master/MasterTenantDetail';
import MasterBilling from './components/master/MasterBilling';
import MasterAdmins from './components/master/MasterAdmins';
import MasterPlans from './components/master/MasterPlans';
import MasterSettings from './components/master/MasterSettings';

/**
 * Master Admin Application Shell.
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
                <Route path="/login" element={<MasterLogin />} />

                {/* ── Master Admin Routes ─────────────────────────── */}
                <Route
                  element={
                    <ProtectedRoute requireMaster>
                      <MasterLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/dashboard" element={<MasterDashboard />} />
                  <Route path="/plans" element={<MasterPlans />} />
                  <Route path="/tenants" element={<MasterTenants />} />
                  <Route path="/tenants/:id" element={<MasterTenantDetail />} />
                  <Route path="/billing" element={<MasterBilling />} />
                  <Route path="/admins" element={<MasterAdmins />} />
                  <Route path="/settings" element={<MasterSettings />} />
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
