/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  MailPlus, Copy, Users, Calendar, Settings2, Trash2,
  LayoutDashboard, CreditCard, Building2, Receipt, Settings
} from 'lucide-react';
import api from '../api';

/**
 * Available tenant permission sections.
 */
const PERMISSION_SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'hsl(262, 83%, 65%)' },
  { key: 'clients', label: 'Clients', icon: Users, color: 'hsl(190, 90%, 50%)' },
  { key: 'invoices', label: 'Invoices', icon: Receipt, color: 'hsl(38, 92%, 55%)' },
  { key: 'quotes', label: 'Quotations', icon: Receipt, color: 'hsl(142, 70%, 49%)' },
  { key: 'team', label: 'Team Invites', icon: Users, color: 'hsl(350, 89%, 60%)' },
  { key: 'settings', label: 'Settings', icon: Settings, color: 'hsl(210, 80%, 55%)' },
  { key: 'subscription', label: 'Subscription', icon: CreditCard, color: 'hsl(320, 80%, 60%)' }
];

// ── Permission Checkboxes Component ───────────────────────────────────────
const PermissionCheckboxes = ({ selected, onToggle, fullAccess, onFullAccessToggle }) => (
  <div style={{ marginTop: '0.75rem' }}>
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
        style={{ width: '18px', height: '18px', accentColor: 'hsl(262, 83%, 65%)', cursor: 'pointer', flexShrink: 0 }}
      />
      <div>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: fullAccess ? 'hsl(262, 83%, 75%)' : 'var(--text-primary)' }}>
          Full Access
        </span>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
          Unrestricted access to all sections
        </p>
      </div>
    </label>

    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: '0.5rem', opacity: fullAccess ? 0.4 : 1, pointerEvents: fullAccess ? 'none' : 'auto',
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
              style={{ width: '16px', height: '16px', accentColor: section.color, cursor: 'pointer', flexShrink: 0 }}
            />
            <Icon size={15} style={{ color: isChecked ? section.color : 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.82rem', fontWeight: isChecked ? 600 : 500, color: isChecked ? section.color : 'var(--text-secondary)' }}>
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
      style={{ width: '100%', maxWidth: '520px', padding: '2rem', animation: 'slideUp 0.3s ease', maxHeight: '90vh', overflowY: 'auto' }}
    >
      {children}
    </div>
  </div>
);

/**
 * Team — Admin-facing workspace invite UI with RBAC support.
 */
export const Team = () => {
  const { activeTenant, invite, user: currentUser } = useAuth();
  const { showToast } = useToast();

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // Create Invite State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '', role: 'member', fullAccess: true, permissions: []
  });
  const [inviting, setInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);

  // Edit Permissions State
  const [editingUser, setEditingUser] = useState(null);
  const [editPerms, setEditPerms] = useState([]);
  const [editFullAccess, setEditFullAccess] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      const data = await api.listTeamUsers();
      setUsers(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setUsersLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchUsers();
  }, [activeTenant, fetchUsers]);

  const handleInviteSubmit = async (event) => {
    event.preventDefault();
    setInviting(true);

    try {
      // Send null permissions if fullAccess is checked
      const perms = inviteForm.fullAccess ? null : inviteForm.permissions;

      const data = await invite({
        email: inviteForm.email.trim(),
        role: inviteForm.role,
        permissions: perms
      });

      setLastInvite(data);
      setShowInviteModal(false);
      setInviteForm({ email: '', role: 'member', fullAccess: true, permissions: [] });
      showToast(data.message || 'Invite created.', 'success');
      fetchUsers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleUpdatePermissions = async () => {
    setSaving(true);
    try {
      const perms = editFullAccess ? null : editPerms;
      await api.updateTeamUserPermissions(editingUser.id, perms);
      showToast('Permissions updated successfully.', 'success');
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUser = async (user) => {
    if (user.id === currentUser.id) {
      showToast('Cannot remove yourself.', 'error');
      return;
    }
    if (!window.confirm(`Are you sure you want to remove ${user.email} from this workspace?`)) {
      return;
    }

    try {
      await api.removeTeamUser(user.id);
      showToast('User removed from workspace.', 'success');
      fetchUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const toggleInvitePerm = (key) => {
    setInviteForm(prev => {
      const p = prev.permissions;
      return { ...prev, permissions: p.includes(key) ? p.filter(k => k !== key) : [...p, key] };
    });
  };

  const toggleEditPerm = (key) => {
    setEditPerms(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const joinUrl = lastInvite ? `${window.location.origin}/join?token=${lastInvite.inviteToken}` : '';
  const copyInvite = async () => {
    if (!joinUrl) return;
    await navigator.clipboard.writeText(joinUrl);
    showToast('Invite link copied.', 'success');
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            <Users size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
            Team
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Manage team members and invite users to {activeTenant?.name || 'this workspace'}.
          </p>
        </div>
        {activeTenant?.role === 'admin' && (
          <button className="btn btn-primary" onClick={() => setShowInviteModal(true)}>
            <MailPlus size={16} /> Invite User
          </button>
        )}
      </div>

      {lastInvite && (
        <div className="info-alert" style={{ marginBottom: '2rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="info-alert-text" style={{ marginBottom: '0.5rem' }}>
              Invite link for <strong>{lastInvite.meta?.email}</strong>
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input className="form-input" value={joinUrl} readOnly style={{ flex: 1 }} />
              <button className="btn btn-secondary" type="button" onClick={copyInvite} title="Copy link">
                <Copy size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-card">
        <h3 style={{ fontSize: '1.2rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={18} style={{ color: 'var(--accent-primary)' }} />
          Active Team Members
        </h3>

        {usersLoading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Loading team members...</p>
        ) : users.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No team members found.</p>
        ) : (
          <div className="table-container" style={{ margin: 0, overflow: 'visible' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Permissions</th>
                  <th>Joined At</th>
                  {activeTenant?.role === 'admin' && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isFull = u.permissions === null;
                  const isSelf = u.id === currentUser.id;

                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            background: 'rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--accent-primary)', fontWeight: 'bold', fontSize: '0.9rem',
                            border: '1px solid rgba(255, 255, 255, 0.1)'
                          }}>
                            {u.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span style={{ fontWeight: 500 }}>{u.email}</span>
                            {isSelf && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>(You)</span>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge-paid' : u.role === 'billing' ? 'badge-accepted' : 'badge-draft'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        {u.role === 'admin' ? (
                          <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.1)', color: 'hsl(262, 83%, 75%)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                            Full Access (Admin)
                          </span>
                        ) : isFull ? (
                          <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.1)', color: 'hsl(262, 83%, 75%)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                            Full Access
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            {(u.permissions || []).map(pk => {
                              const sec = PERMISSION_SECTIONS.find(s => s.key === pk);
                              if (!sec) return null;
                              return (
                                <span key={pk} className="badge" style={{
                                  background: `${sec.color}15`, color: sec.color, border: `1px solid ${sec.color}30`, fontSize: '0.7rem'
                                }}>
                                  {sec.label}
                                </span>
                              );
                            })}
                            {(!u.permissions || u.permissions.length === 0) && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No access</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                          <Calendar size={14} />
                          {new Date(u.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      {activeTenant?.role === 'admin' && (
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.4rem' }}
                              onClick={() => {
                                setEditingUser(u);
                                setEditFullAccess(u.permissions === null);
                                setEditPerms(u.permissions || []);
                              }}
                              disabled={u.role === 'admin'}
                              title={u.role === 'admin' ? 'Admins always have full access' : 'Edit permissions'}
                            >
                              <Settings2 size={16} />
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.4rem', color: 'var(--accent-danger)' }}
                              onClick={() => handleRemoveUser(u)}
                              disabled={isSelf}
                              title={isSelf ? 'Cannot remove yourself' : 'Remove user'}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <ModalOverlay onClose={() => setShowInviteModal(false)}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MailPlus size={20} style={{ color: 'var(--accent-primary)' }} />
            Invite New User
          </h2>
          <form onSubmit={handleInviteSubmit}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                value={inviteForm.email}
                onChange={e => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="colleague@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-select"
                value={inviteForm.role}
                onChange={(e) => setInviteForm(prev => ({ ...prev, role: e.target.value }))}
              >
                <option value="member">Member</option>
                <option value="billing">Billing</option>
                <option value="admin">Admin</option>
              </select>
              {inviteForm.role === 'admin' && (
                <p style={{ fontSize: '0.75rem', color: 'var(--accent-warning)', marginTop: '0.5rem' }}>
                  Admins automatically receive full access, bypassing granular permissions.
                </p>
              )}
            </div>

            {inviteForm.role !== 'admin' && (
              <div className="form-group" style={{ marginTop: '1.5rem' }}>
                <label className="form-label">Section Permissions</label>
                <PermissionCheckboxes
                  selected={inviteForm.permissions}
                  onToggle={toggleInvitePerm}
                  fullAccess={inviteForm.fullAccess}
                  onFullAccessToggle={(val) => setInviteForm(prev => ({ ...prev, fullAccess: val }))}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowInviteModal(false)} style={{ flex: 1 }}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={inviting} style={{ flex: 1 }}>
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </form>
        </ModalOverlay>
      )}

      {/* Edit Permissions Modal */}
      {editingUser && (
        <ModalOverlay onClose={() => setEditingUser(null)}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings2 size={20} style={{ color: 'var(--accent-primary)' }} />
            Edit Permissions
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Updating access for <strong>{editingUser.email}</strong>
          </p>

          <PermissionCheckboxes
            selected={editPerms}
            onToggle={toggleEditPerm}
            fullAccess={editFullAccess}
            onFullAccessToggle={setEditFullAccess}
          />

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditingUser(null)} style={{ flex: 1 }}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleUpdatePermissions} disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving...' : 'Save Permissions'}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default Team;
