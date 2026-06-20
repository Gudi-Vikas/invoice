import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import api from '../api';
import { useToast } from '../context/ToastContext';

/**
 * TenantLayout — App shell wrapper for tenant-scoped pages.
 * Renders the Sidebar + main content area using React Router's <Outlet>.
 */
export const TenantLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [checkingSubscription, setCheckingSubscription] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const checkSubscription = async () => {
      if (location.pathname === '/subscription') {
        setCheckingSubscription(false);
        return;
      }

      try {
        const data = await api.getSubscriptionStatus();
        if (!cancelled && !data.isActive) {
          showToast('Please activate Starter to use this workspace.', 'error');
          navigate('/subscription', { replace: true });
        }
      } catch (err) {
        if (!cancelled) showToast(err.message, 'error');
      } finally {
        if (!cancelled) setCheckingSubscription(false);
      }
    };

    checkSubscription();

    return () => { cancelled = true; };
  }, [location.pathname, navigate, showToast]);

  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        {checkingSubscription && location.pathname !== '/subscription' ? (
          <p style={{ color: 'var(--text-secondary)' }}>Checking subscription...</p>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
};

export default TenantLayout;
