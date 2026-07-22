/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  ShieldCheck, ToggleLeft, ToggleRight, UserPlus, X,
  LayoutDashboard, CreditCard, Building2, Receipt, Eye, EyeOff, Settings2
} from 'lucide-react';

/**
 * Available master-admin permission sections.
 * Each key maps to a sidebar section in the platform admin panel.
 */
const PERMISSION_SECTIONS = [
  { key: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard, color: 'hsl(262, 83%, 65%)' },
  { key: 'plans',     label: 'Plans',      icon: CreditCard,      color: 'hsl(190, 90%, 50%)' },
  { key: 'tenants',   label: 'Tenants',    icon: Building2,       color: 'hsl(142, 70%, 49%)' },
  { key: 'billing',   label: 'Billing',    icon: Receipt,         color: 'hsl(38, 92%, 55%)' },
  { key: 'admins',    label: 'Admins',     icon: ShieldCheck,     color: 'hsl(350, 89%, 60%)' }
];

// ── Permission Checkboxes Component ───────────────────────────────────────
const PermissionCheckboxes = ({ selected, onToggle, fullAccess, onFullAccessToggle }) => (
  <div style={{ marginTop: '0.75rem' }}>
    {/* Full Access Toggle */}
    <label style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      padding: '0.85rem 1rem', borderRadius: '12px', cursor: 'pointer',
      background: fullAccess
        ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(59, 130, 246, 0.1))'
        : 'var(--bg-tertiary)',
      border: fullAccess ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid var(--border-color)',
      transition: 'all 0.2s ease', marginBottom: '0.75rem'
    }}>
      <input
        type="checkbox"
        checked={fullAccess}
        onChange={(e) => onFullAccessToggle(e.target.checked)}
        style={{
          width: '18px', height: '18px', accentColor: 'hsl(262, 83%, 65%)',
          cursor: 'pointer', flexShrink: 0
        }}
      />
      <div>
        <span style={{
          fontWeight: 700, fontSize: '0.9rem',
          color: fullAccess ? 'var(--accent-secondary)' : 'var(--text-primary)'
        }}>
          Full Access
        </span>
        <p style={{
          margin: 0, fontSize: '0.75rem',
          color: 'var(--text-muted)', marginTop: '0.15rem'
        }}>
          Unrestricted access to all sections
        </p>
      </div>
    </label>

    {/* Individual Permission Toggles */}
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: '0.5rem', opacity: fullAccess ? 0.4 : 1,
      pointerEvents: fullAccess ? 'none' : 'auto',
      transition: 'opacity 0.2s ease'
    }}>
      {PERMISSION_SECTIONS.map(section => {
        const isChecked = selected.includes(section.key);
        const Icon = section.icon;
        return (
          <label key={section.key} style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.7rem 0.85rem', borderRadius: '10px', cursor: 'pointer',
            background: isChecked ? `${section.color}15` : 'var(--bg-tertiary)',
            border: isChecked ? `1px solid ${section.color}50` : '1px solid var(--border-color)',
            transition: 'all 0.2s ease'
          }}>
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggle(section.key)}
              style={{
                width: '16px', height: '16px',
                accentColor: section.color, cursor: 'pointer', flexShrink: 0
              }}
            />
            <Icon size={15} style={{ color: isChecked ? section.color : 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{
              fontSize: '0.82rem', fontWeight: isChecked ? 600 : 500,
              color: isChecked ? section.color : 'var(--text-secondary)'
            }}>
              {section.label}
            </span>
          </label>
        );
      })}
    </div>
  </div>
);

// ── Modal Overlay Component ───────────────────────────────────────────────
const ModalOverlay = ({ children, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem', animation: 'fadeIn 0.2s ease'
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      className="admin-card"
      style={{
        width: '100%', maxWidth: '520px', padding: '2rem',
        animation: 'slideUp 0.3s ease', maxHeight: '90vh', overflowY: 'auto'
      }}
    >
      {children}
    </div>
  </div>
);

/**
 * MasterAdmins — Full RBAC admin management panel.
 * Create admins with granular permissions, toggle active/inactive, edit permissions.
 */
export const MasterAdmins = () => {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Create Admin Modal State ──────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: '', password: '', fullAccess: true, permissions: []
  });
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // ── Edit Permissions Modal State ──────────────────────────────────────────
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [editPerms, setEditPerms] = useState([]);
  const [editFullAccess, setEditFullAccess] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editPermsError, setEditPermsError] = useState('');

  const loadAdmins = useCallback(async () => {
    try {
      const data = await api.masterListAdmins();
      setAdmins(data.admins || []);
    } catch {
      showToast('Failed to load admins.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadAdmins(); }, [loadAdmins]);

  // ── Toggle Active/Inactive ────────────────────────────────────────────────
  const handleToggle = async (id) => {
    try {
      const data = await api.masterToggleAdmin(id);
      showToast(data.message, 'success');
      loadAdmins();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Create Admin ──────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const payload = {
        email: createForm.email,
        password: createForm.password,
        permissions: createForm.fullAccess ? null : createForm.permissions
      };
      const data = await api.masterCreateAdmin(payload);
      showToast(data.message, 'success');
      setShowCreateModal(false);
      setCreateForm({ email: '', password: '', fullAccess: true, permissions: [] });
      loadAdmins();
    } catch (err) {
      setCreateError(err.message || 'Failed to create admin.');
    } finally {
      setCreating(false);
    }
  };

  const toggleCreatePermission = (key) => {
    setCreateForm(prev => {
      const has = prev.permissions.includes(key);
      return {
        ...prev,
        permissions: has
          ? prev.permissions.filter(p => p !== key)
          : [...prev.permissions, key]
      };
    });
  };

  // ── Edit Permissions ──────────────────────────────────────────────────────
  const openEditPerms = (admin) => {
    setEditingAdmin(admin);
    setEditPermsError('');
    const isFullAccess = admin.permissions === null || admin.permissions === undefined;
    setEditFullAccess(isFullAccess);
    setEditPerms(isFullAccess ? [] : (admin.permissions || []));
  };

  const toggleEditPermission = (key) => {
    setEditPerms(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    );
  };

  const handleSavePerms = async () => {
    if (!editingAdmin) return;
    setSaving(true);
    setEditPermsError('');
    try {
      const perms = editFullAccess ? null : editPerms;
      const data = await api.masterUpdateAdminPermissions(editingAdmin.id, perms);
      showToast(data.message, 'success');
      setEditingAdmin(null);
      loadAdmins();
    } catch (err) {
      setEditPermsError(err.message || 'Failed to update permissions.');
    } finally {
      setSaving(false);
    }
  };

  // ── Permission Badges ─────────────────────────────────────────────────────
  const renderPermissionBadges = (permissions) => {
    if (permissions === null || permissions === undefined) {
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          padding: '0.25rem 0.7rem', borderRadius: '20px', fontSize: '0.72rem',
          fontWeight: 600, letterSpacing: '0.03em',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.2))',
          color: 'var(--accent-secondary)', border: '1px solid rgba(139, 92, 246, 0.3)'
        }}>
          <ShieldCheck size={12} /> Full Access
        </span>
      );
    }

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
        {PERMISSION_SECTIONS.filter(s => permissions.includes(s.key)).map(section => (
          <span key={section.key} style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
            padding: '0.2rem 0.55rem', borderRadius: '14px', fontSize: '0.68rem',
            fontWeight: 600,
            background: `${section.color}20`,
            color: section.color,
            border: `1px solid ${section.color}40`
          }}>
            <section.icon size={10} />
            {section.label}
          </span>
        ))}
        {permissions.length === 0 && (
          <span style={{
            fontSize: '0.72rem', color: 'var(--accent-danger)', fontWeight: 500, fontStyle: 'italic'
          }}>
            No permissions
          </span>
        )}
      </div>
    );
  };


  return (
    <div className="fade-in">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem'
      }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            <ShieldCheck size={28} style={{
              verticalAlign: 'middle', marginRight: '0.5rem',
              color: 'var(--accent-secondary)'
            }} />
            Platform Admins
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Manage master admin accounts, permissions, and access control.
          </p>
        </div>
        <button
          id="btn-create-admin"
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.7rem 1.25rem', borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))',
            fontWeight: 600, fontSize: '0.88rem'
          }}
        >
          <UserPlus size={16} /> Add Admin
        </button>
      </div>

      {/* ── Admins Table ────────────────────────────────────────────────── */}
      <div className="admin-card" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>Loading...</p>
        ) : admins.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>No admin accounts found.</p>
        ) : (
          <table className="data-table" id="admins-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Permissions</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map(admin => {
                const isSelf = admin.id === user?.id;
                return (
                  <tr key={admin.id}>
                    <td style={{ fontWeight: 500 }}>
                      {admin.email}
                      {isSelf && (
                        <span style={{
                          marginLeft: '0.5rem', fontSize: '0.68rem',
                          color: 'var(--accent-primary)', fontWeight: 600,
                          textTransform: 'uppercase'
                        }}>
                          (you)
                        </span>
                      )}
                    </td>
                    <td>{renderPermissionBadges(admin.permissions)}</td>
                    <td>
                      <span className={`badge ${admin.is_active ? 'badge-paid' : 'badge-overdue'}`}>
                        {admin.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {admin.last_login_at ? new Date(admin.last_login_at).toLocaleString() : 'Never'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {new Date(admin.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
                        {/* Edit Permissions */}
                        <button
                          onClick={() => openEditPerms(admin)}
                          disabled={isSelf}
                          title={isSelf ? 'Cannot edit your own permissions' : 'Edit permissions'}
                          style={{
                            background: 'none', border: 'none', padding: '0.3rem',
                            cursor: isSelf ? 'not-allowed' : 'pointer',
                            color: isSelf ? 'var(--text-muted)' : 'var(--accent-secondary)',
                            opacity: isSelf ? 0.4 : 1, transition: 'opacity 0.2s'
                          }}
                        >
                          <Settings2 size={18} />
                        </button>
                        {/* Toggle Active */}
                        <button
                          onClick={() => handleToggle(admin.id)}
                          disabled={isSelf}
                          title={isSelf ? 'Cannot toggle your own account' : admin.is_active ? 'Disable' : 'Enable'}
                          style={{
                            background: 'none', border: 'none', padding: '0.3rem',
                            cursor: isSelf ? 'not-allowed' : 'pointer',
                            color: isSelf ? 'var(--text-muted)' : admin.is_active ? 'var(--accent-success)' : 'var(--accent-danger)',
                            opacity: isSelf ? 0.4 : 1
                          }}
                        >
                          {admin.is_active
                            ? <ToggleRight size={22} />
                            : <ToggleLeft size={22} />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create Admin Modal ──────────────────────────────────────────── */}
      {showCreateModal && (
        <ModalOverlay onClose={() => setShowCreateModal(false)}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '1.5rem'
          }}>
            <div>
              <h2 style={{
                fontSize: '1.35rem', fontWeight: 800,
                fontFamily: 'var(--font-display)'
              }}>
                <UserPlus size={20} style={{
                  verticalAlign: 'middle', marginRight: '0.5rem',
                  color: 'var(--accent-secondary)'
                }} />
                Add Platform Admin
              </h2>
              <p style={{
                color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.35rem'
              }}>
                Create a new master admin with optional access restrictions.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(false)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: '0.25rem', flexShrink: 0
              }}
            >
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleCreate}>
            {createError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px', padding: '0.75rem 1rem', color: 'hsl(350, 89%, 75%)',
                fontSize: '0.85rem', marginBottom: '1.25rem'
              }}>
                {createError}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                id="create-admin-email"
                type="email"
                className="form-input"
                placeholder="admin@ultrakeyit.com"
                value={createForm.email}
                onChange={e => setCreateForm(prev => ({ ...prev, email: e.target.value }))}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="create-admin-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Minimum 6 characters"
                  value={createForm.password}
                  onChange={e => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
                  required
                  minLength={6}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  style={{
                    position: 'absolute', right: '0.75rem', top: '50%',
                    transform: 'translateY(-50%)', background: 'none',
                    border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                    padding: '0.2rem'
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Access Permissions
              </label>
              <PermissionCheckboxes
                selected={createForm.permissions}
                onToggle={toggleCreatePermission}
                fullAccess={createForm.fullAccess}
                onFullAccessToggle={(checked) => setCreateForm(prev => ({
                  ...prev, fullAccess: checked,
                  permissions: checked ? [] : prev.permissions
                }))}
              />
            </div>

            <button
              id="btn-submit-create-admin"
              type="submit"
              className="btn btn-primary"
              disabled={creating}
              style={{
                width: '100%', padding: '0.85rem', marginTop: '0.5rem',
                fontSize: '1rem', fontWeight: 600,
                background: 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))',
                opacity: creating ? 0.7 : 1
              }}
            >
              {creating ? 'Creating...' : 'Create Admin'}
            </button>
          </form>
        </ModalOverlay>
      )}

      {/* ── Edit Permissions Modal ──────────────────────────────────────── */}
      {editingAdmin && (
        <ModalOverlay onClose={() => setEditingAdmin(null)}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '1.5rem'
          }}>
            <div>
              <h2 style={{
                fontSize: '1.35rem', fontWeight: 800,
                fontFamily: 'var(--font-display)'
              }}>
                <Settings2 size={20} style={{
                  verticalAlign: 'middle', marginRight: '0.5rem',
                  color: 'var(--accent-secondary)'
                }} />
                Edit Permissions
              </h2>
              <p style={{
                color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.35rem'
              }}>
                {editingAdmin.email}
              </p>
            </div>
            <button
              onClick={() => setEditingAdmin(null)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: '0.25rem', flexShrink: 0
              }}
            >
              <X size={20} />
            </button>
          </div>

          {editPermsError && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px', padding: '0.75rem 1rem', color: 'hsl(350, 89%, 75%)',
              fontSize: '0.85rem', marginBottom: '1.25rem'
            }}>
              {editPermsError}
            </div>
          )}

          <PermissionCheckboxes
            selected={editPerms}
            onToggle={toggleEditPermission}
            fullAccess={editFullAccess}
            onFullAccessToggle={(checked) => {
              setEditFullAccess(checked);
              if (checked) setEditPerms([]);
            }}
          />

          <button
            id="btn-save-permissions"
            className="btn btn-primary"
            onClick={handleSavePerms}
            disabled={saving || (!editFullAccess && editPerms.length === 0)}
            style={{
              width: '100%', padding: '0.85rem', marginTop: '1.25rem',
              fontSize: '1rem', fontWeight: 600,
              background: 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))',
              opacity: (saving || (!editFullAccess && editPerms.length === 0)) ? 0.7 : 1
            }}
          >
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>

          {!editFullAccess && editPerms.length === 0 && (
            <p style={{
              color: 'var(--accent-danger)', fontSize: '0.78rem',
              textAlign: 'center', marginTop: '0.5rem'
            }}>
              Select at least one permission, or enable Full Access.
            </p>
          )}
        </ModalOverlay>
      )}
    </div>
  );
};

export default MasterAdmins;
