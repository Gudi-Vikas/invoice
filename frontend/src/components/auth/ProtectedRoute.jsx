
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * ProtectedRoute — Route guard wrapper.
 *
 * Usage:
 *   <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
 *   <Route path="/master/*" element={<ProtectedRoute requireMaster><MasterLayout /></ProtectedRoute>} />
 */
export const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  // Still hydrating auth state from localStorage
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', color: 'var(--text-secondary)',
        fontFamily: 'var(--font-body)', fontSize: '0.95rem'
      }}>
        Loading...
      </div>
    );
  }

  // Not authenticated → redirect to appropriate login page
  if (!isAuthenticated) {
    return <Navigate to={'/login'} replace />;
  }

  return children;
};

export default ProtectedRoute;
