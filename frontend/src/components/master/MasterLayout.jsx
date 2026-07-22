import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import ThemeToggle from '../ThemeToggle';
import NotificationPanel from '../NotificationPanel';
import {
  LayoutDashboard, Building2, Receipt, ShieldCheck, LogOut,
  Layers, CreditCard, ChevronLeft, ChevronRight, Bell
} from 'lucide-react';

/**
 * MasterLayout — App shell for the Master Admin panel.
 * Features:
 *  - Badge counts on Tenants and Billing nav items
 *  - Collapse/expand sidebar toggle (persisted to localStorage)
 */
export const MasterLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, masterPermissions } = useAuth();
  const { masterCounts, togglePanel, isPanelOpen, globalUnreadCount } = useNotifications();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('master_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });

  const [mainCollapsed, setMainCollapsed] = useState(collapsed);

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('master_sidebar_collapsed', String(next));
      setMainCollapsed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    setMainCollapsed(collapsed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allMenuItems = [
    { path: '/master/dashboard', name: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' },
    { path: '/master/plans',     name: 'Plans',     icon: CreditCard,      perm: 'plans' },
    { path: '/master/tenants',   name: 'Tenants',   icon: Building2,       perm: 'tenants' },
    { path: '/master/billing',   name: 'Billing',   icon: Receipt,         perm: 'billing' },
    { path: '/master/admins',    name: 'Admins',    icon: ShieldCheck,     perm: 'admins' }
  ];

  const menuItems = masterPermissions === null || masterPermissions === undefined
    ? allMenuItems
    : allMenuItems.filter(item => masterPermissions.includes(item.perm));

  // ── Badge logic for master sidebar items ────────────────────
  const getMasterBadge = (perm) => {
    return null; // Temporarily disabled per user request
    const { newTenants, inactiveTenants, overdueInvoices, pendingBilling } = masterCounts;

    if (perm === 'tenants') {
      const total = newTenants + inactiveTenants;
      if (total === 0) return null;
      return {
        count: total,
        variant: inactiveTenants > 0 ? 'danger' : 'info',
        title: `${newTenants} new, ${inactiveTenants} suspended`
      };
    }
    if (perm === 'billing') {
      const total = overdueInvoices + pendingBilling;
      if (total === 0) return null;
      return {
        count: total,
        variant: overdueInvoices > 0 ? 'danger' : 'warning',
        title: `${overdueInvoices} overdue, ${pendingBilling} pending`
      };
    }
    return null;
  };

  const handleLogout = () => {
    logout();
    navigate('/master/login');
  };

  return (
    <div className="app-container">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} style={{ borderRight: '1px solid rgba(139, 92, 246, 0.15)' }}>
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2.5rem', minWidth: 0 }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--accent-secondary) 0%, var(--accent-danger) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 15px rgba(139, 92, 246, 0.4)'
          }}>
            <Layers size={22} color="#fff" />
          </div>
          <div className="sidebar-brand-text" style={{ minWidth: 0, overflow: 'hidden' }}>
            <h2 style={{
              fontSize: '1.15rem', fontWeight: 800, fontFamily: 'var(--font-display)',
              background: 'linear-gradient(to right, var(--text-primary), var(--text-secondary))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              whiteSpace: 'nowrap'
            }}>
              UltraKey
            </h2>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Platform Admin
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
          {menuItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            const badge = getMasterBadge(item.perm);

            return (
              <div key={item.path} className="sidebar-nav-item">
                <button
                  id={`master-nav-${item.perm}`}
                  onClick={() => navigate(item.path)}
                  className="btn sidebar-nav-btn"
                  title={collapsed ? item.name : badge?.title}
                  style={{
                    justifyContent: 'flex-start',
                    padding: '0.8rem 1.1rem',
                    backgroundColor: isActive ? 'var(--accent-secondary)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    boxShadow: isActive ? '0 0 15px rgba(139, 92, 246, 0.4)' : 'none',
                    borderRadius: '10px', transition: 'all 0.2s ease',
                    width: '100%', fontWeight: isActive ? 600 : 500,
                    gap: '0.75rem', overflow: 'hidden'
                  }}
                >
                  <Icon size={17} style={{ opacity: isActive ? 1 : 0.65, flexShrink: 0 }} />
                  <span className="sidebar-label" style={{ fontSize: '0.9rem', flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </span>
                  {badge && !collapsed && (
                    <span className={`sidebar-badge ${badge.variant}`}>
                      {badge.count > 99 ? '99+' : badge.count}
                    </span>
                  )}
                </button>

                {/* Dot badge in collapsed mode */}
                {badge && collapsed && (
                  <span className={`sidebar-badge ${badge.variant}`} />
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
          


          <div className="sidebar-user-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem' }}>
            <div style={{ overflow: 'hidden' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Master Admin:</p>
              <p style={{ color: 'var(--text-secondary)', fontWeight: 500, marginTop: '0.15rem', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email || 'admin'}
              </p>
            </div>
            <ThemeToggle style={{ flexShrink: 0 }} />
          </div>

          {!collapsed ? (
            <button
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
          ) : (
            <button
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
            {collapsed
              ? <ChevronRight size={15} />
              : <><ChevronLeft size={15} /><span className="sidebar-label">Collapse</span></>}
          </button>
        </div>
      </aside>

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

      <main className={`main-content${mainCollapsed ? ' sidebar-collapsed' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
};

export default MasterLayout;
