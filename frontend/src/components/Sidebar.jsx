import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import TenantSwitcher from './TenantSwitcher';
import ThemeToggle from './ThemeToggle';
import {
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  CreditCard,
  LogOut,
  Layers,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  Bell
} from 'lucide-react';

/**
 * Sidebar Navigation Panel Component.
 * Features:
 *  - Notification badges on Invoices, Quotations
 *  - Subscription expiry pill badge on Subscription item
 *  - Collapse/expand toggle (persisted to localStorage)
 */
export const Sidebar = ({ onCollapsedChange }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, activeTenant } = useAuth();
  const { tenantCounts, togglePanel, isPanelOpen } = useNotifications();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true'; }
    catch { return false; }
  });

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      onCollapsedChange?.(next);
      return next;
    });
  };

  const totalNotifications = (tenantCounts.feed || []).length;

  // Notify parent on mount
  useEffect(() => {
    onCollapsedChange?.(collapsed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const menuItems = [
    { path: '/dashboard',    name: 'Dashboard',    icon: LayoutDashboard, key: 'dashboard' },
    { path: '/clients',      name: 'Clients',      icon: Users,           key: 'clients' },
    { path: '/invoices',     name: 'Invoices',     icon: FileText,        key: 'invoices' },
    { path: '/quotes',       name: 'Quotations',   icon: FileText,        key: 'quotes' },
    { path: '/team',         name: 'Team Invites', icon: UserPlus,        key: 'team' },
    { path: '/settings',     name: 'Settings',     icon: Settings,        key: 'settings' },
    { path: '/subscription', name: 'Subscription', icon: CreditCard,      key: 'subscription' }
  ];

  const visibleMenuItems = menuItems.filter(item => {
    if (activeTenant?.role === 'admin') return true;
    if (activeTenant?.permissions === null) return true;
    if (Array.isArray(activeTenant?.permissions)) {
      return activeTenant.permissions.includes(item.key);
    }
    return false;
  });

  // ── Badge resolution per nav item ──────────────────────────
  const getBadge = (key) => {
    return null; // Temporarily disabled per user request
    const { pendingQuotes, overdueInvoices, unpaidInvoices, pendingVerificationInvoices, subscription } = tenantCounts;

    if (key === 'invoices') {
      const total = overdueInvoices + unpaidInvoices + (pendingVerificationInvoices || 0);
      if (total === 0) return null;
      let variant = 'warning';
      if (pendingVerificationInvoices > 0) variant = 'info'; // Action required: verify UTR
      if (overdueInvoices > 0) variant = 'danger'; // Overdue takes highest precedence
      return { count: total, variant };
    }
    if (key === 'quotes') {
      if (pendingQuotes === 0) return null;
      return { count: pendingQuotes, variant: 'warning' };
    }
    if (key === 'subscription' && subscription) {
      const { status, daysRemaining } = subscription;
      if (status !== 'active') {
        return { label: '!', variant: 'danger', isExpiry: true };
      }
      if (daysRemaining !== null && daysRemaining <= 14) {
        const cls = daysRemaining <= 3 ? 'critical' : daysRemaining <= 7 ? 'warning' : 'notice';
        return { label: `${daysRemaining}d`, variant: cls, isExpiry: true };
      }
    }
    return null;
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* Brand Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', minWidth: 0 }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'var(--glow-shadow)'
        }}>
          <Layers size={22} color="#fff" />
        </div>
        <div className="sidebar-brand-text" style={{ minWidth: 0, overflow: 'hidden' }}>
          <h2 style={{
            fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-display)',
            background: 'linear-gradient(to right, var(--text-primary), var(--text-secondary))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            whiteSpace: 'nowrap'
          }}>
            UltraKey
          </h2>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Billing SaaS
          </span>
        </div>
      </div>

      {/* Tenant Switcher */}
      <div className="sidebar-switcher" style={{ marginBottom: '1.5rem' }}>
        <TenantSwitcher />
      </div>

      {/* Navigation Menu Links */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
        {visibleMenuItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          const badge = getBadge(item.key);

          return (
            <div key={item.path} className="sidebar-nav-item">
              <button
                id={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
                onClick={() => navigate(item.path)}
                className={`btn sidebar-nav-btn`}
                title={collapsed ? item.name : undefined}
                style={{
                  justifyContent: 'flex-start',
                  padding: '0.8rem 1.1rem',
                  backgroundColor: isActive ? 'var(--accent-primary)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-secondary)',
                  boxShadow: isActive ? 'var(--glow-shadow)' : 'none',
                  borderRadius: '10px',
                  transition: 'all 0.2s ease',
                  width: '100%',
                  fontWeight: isActive ? 600 : 500,
                  gap: '0.75rem',
                  overflow: 'hidden'
                }}
              >
                <Icon size={17} style={{ opacity: isActive ? 1 : 0.65, flexShrink: 0 }} />
                <span className="sidebar-label" style={{ fontSize: '0.9rem', flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {item.name}
                </span>

                {/* Badge: notification count or expiry pill */}
                {badge && !collapsed && (
                  badge.isExpiry ? (
                    <span className={`sub-expiry-pill ${badge.variant}`}>
                      {badge.label}
                    </span>
                  ) : (
                    <span className={`sidebar-badge ${badge.variant}`}>
                      {badge.count > 99 ? '99+' : badge.count}
                    </span>
                  )
                )}
              </button>

              {/* Dot badge visible in collapsed mode */}
              {badge && collapsed && (
                badge.isExpiry ? (
                  <span className={`sub-expiry-pill ${badge.variant}`} />
                ) : (
                  <span className={`sidebar-badge ${badge.variant}`} />
                )
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer: User Info + Theme Toggle + Logout */}
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
        


        <div className="sidebar-user-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem' }}>
          <div style={{ overflow: 'hidden' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Logged in as:</p>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 500, marginTop: '0.15rem', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || 'Unknown'}
            </p>
          </div>
          <ThemeToggle style={{ flexShrink: 0 }} />
        </div>
        {!collapsed && (
          <button
            id="btn-logout"
            onClick={handleLogout}
            className="btn"
            style={{
              width: '100%', justifyContent: 'flex-start', gap: '0.6rem',
              padding: '0.65rem 1rem', background: 'none',
              color: 'var(--accent-danger)', fontSize: '0.85rem',
              fontWeight: 500, border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '10px'
            }}
          >
            <LogOut size={15} /> Sign Out
          </button>
        )}
        {collapsed && (
          <button
            id="btn-logout-collapsed"
            onClick={handleLogout}
            className="btn"
            title="Sign Out"
            style={{
              width: '100%', justifyContent: 'center',
              padding: '0.65rem 0.5rem', background: 'none',
              color: 'var(--accent-danger)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '10px'
            }}
          >
            <LogOut size={15} />
          </button>
        )}

        {/* Collapse toggle */}
        <button className="sidebar-toggle-btn" onClick={toggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /><span className="sidebar-label">Collapse</span></>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
