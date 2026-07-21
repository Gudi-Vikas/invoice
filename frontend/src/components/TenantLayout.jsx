import { useEffect, useState, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationPanel from './NotificationPanel';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { useNotifications } from '../context/NotificationContext';
import { Bell } from 'lucide-react';

/**
 * TenantLayout — App shell wrapper for tenant-scoped pages.
 * Renders the Sidebar + main content area using React Router's <Outlet>.
 * Tracks sidebar collapsed state to adjust main content margin.
 */
export const TenantLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { togglePanel, isPanelOpen, globalUnreadCount } = useNotifications();
  const [checkingSubscription, setCheckingSubscription] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true'; }
    catch { return false; }
  });


  const handleCollapsedChange = useCallback((val) => {
    setSidebarCollapsed(val);
  }, []);

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
      <Sidebar onCollapsedChange={handleCollapsedChange} />
      <NotificationPanel />
      
      <button 
        className="floating-notification-btn" 
        onClick={togglePanel}
        style={{
          backgroundColor: isPanelOpen ? 'var(--bg-active)' : 'var(--bg-card)'
        }}
      >
        <Bell size={20} />
        {globalUnreadCount > 0 && (
          <span className="notification-dot">
            {globalUnreadCount > 99 ? '99+' : globalUnreadCount}
          </span>
        )}
      </button>

      <main className={`main-content${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
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
