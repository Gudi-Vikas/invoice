import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TenantSwitcher from './TenantSwitcher';
import ThemeToggle from './ThemeToggle';
import {
  LayoutDashboard,
  FileText,
  PlusCircle,
  Users,
  Store,
  Settings,
  CreditCard,
  LogOut,
  Layers,
  UserPlus
} from 'lucide-react';

/**
 * Sidebar Navigation Panel Component.
 * Uses React Router for navigation. Displays user email and tenant switcher.
 */
export const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const menuItems = [
    { path: '/dashboard',        name: 'Dashboard',        icon: LayoutDashboard },
    { path: '/clients',          name: 'Clients',          icon: Users },
    { path: '/invoices',         name: 'Invoices',         icon: FileText },
    { path: '/quotes',           name: 'Quotations',       icon: FileText },
    { path: '/vendors',          name: 'Vendors Hub',      icon: Store },
    { path: '/team',             name: 'Team Invites',     icon: UserPlus },
    { path: '/settings',         name: 'Settings',         icon: Settings },
    { path: '/subscription',     name: 'Subscription',     icon: CreditCard }
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'var(--glow-shadow)'
        }}>
          <Layers size={22} color="#fff" />
        </div>
        <div>
          <h2 style={{
            fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-display)',
            background: 'linear-gradient(to right, var(--text-primary), var(--text-secondary))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            UltraKey
          </h2>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
            Billing SaaS
          </span>
        </div>
      </div>

      {/* Tenant Switcher */}
      <div style={{ marginBottom: '1.5rem' }}>
        <TenantSwitcher />
      </div>

      {/* Navigation Menu Links */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
        {menuItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <button
              key={item.path}
              id={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}
              onClick={() => navigate(item.path)}
              className="btn"
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
                gap: '0.75rem'
              }}
            >
              <Icon size={17} style={{ opacity: isActive ? 1 : 0.65, flexShrink: 0 }} />
              <span style={{ fontSize: '0.9rem' }}>{item.name}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer: User Info + Theme Toggle + Logout */}
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem' }}>
          <div style={{ overflow: 'hidden' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Logged in as:</p>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 500, marginTop: '0.15rem', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || 'Unknown'}
            </p>
          </div>
          <ThemeToggle style={{ flexShrink: 0 }} />
        </div>
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
      </div>
    </aside>
  );
};

export default Sidebar;
