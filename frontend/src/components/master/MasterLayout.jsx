
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../ThemeToggle';
import {
  LayoutDashboard, Building2, Receipt, ShieldCheck, LogOut, Layers
} from 'lucide-react';

/**
 * MasterLayout — App shell for the Master Admin panel.
 * Separate sidebar, separate brand identity.
 */
export const MasterLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const menuItems = [
    { path: '/master/dashboard', name: 'Dashboard',  icon: LayoutDashboard },
    { path: '/master/tenants',   name: 'Tenants',    icon: Building2 },
    { path: '/master/billing',   name: 'Billing',    icon: Receipt },
    { path: '/master/admins',    name: 'Admins',     icon: ShieldCheck }
  ];

  const handleLogout = () => {
    logout();
    navigate('/master/login');
  };

  return (
    <div className="app-container">
      <aside className="sidebar" style={{ borderRight: '1px solid rgba(139, 92, 246, 0.15)' }}>
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2.5rem' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--accent-secondary) 0%, var(--accent-danger) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 15px rgba(139, 92, 246, 0.4)'
          }}>
            <Layers size={22} color="#fff" />
          </div>
          <div>
            <h2 style={{
              fontSize: '1.15rem', fontWeight: 800, fontFamily: 'var(--font-display)',
              background: 'linear-gradient(to right, hsl(262, 83%, 75%), hsl(350, 89%, 75%))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
            }}>
              UltraKey
            </h2>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
              Platform Admin
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
          {menuItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);

            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="btn"
                style={{
                  justifyContent: 'flex-start',
                  padding: '0.8rem 1.1rem',
                  backgroundColor: isActive ? 'var(--accent-secondary)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-secondary)',
                  boxShadow: isActive ? '0 0 15px rgba(139, 92, 246, 0.4)' : 'none',
                  borderRadius: '10px', transition: 'all 0.2s ease',
                  width: '100%', fontWeight: isActive ? 600 : 500, gap: '0.75rem'
                }}
              >
                <Icon size={17} style={{ opacity: isActive ? 1 : 0.65, flexShrink: 0 }} />
                <span style={{ fontSize: '0.9rem' }}>{item.name}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer: Master Admin + Theme Toggle + Logout */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem' }}>
            <div style={{ overflow: 'hidden' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Master Admin:</p>
              <p style={{ color: 'hsl(262, 83%, 75%)', fontWeight: 500, marginTop: '0.15rem', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email || 'admin'}
              </p>
            </div>
            <ThemeToggle style={{ flexShrink: 0 }} />
          </div>
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
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

export default MasterLayout;
