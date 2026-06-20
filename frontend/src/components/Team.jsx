/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { MailPlus, Copy, Users, Calendar } from 'lucide-react';
import api from '../api';

/**
 * Team — Admin-facing workspace invite UI.
 */
export const Team = () => {
  const { activeTenant, invite } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [loading, setLoading] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);

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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      const data = await invite(email.trim(), role);
      setLastInvite(data);
      setEmail('');
      setRole('member');
      showToast(data.message || 'Invite created.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = async () => {
    if (!lastInvite?.joinUrl) return;
    await navigator.clipboard.writeText(lastInvite.joinUrl);
    showToast('Invite link copied.', 'success');
  };

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          <Users size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
          Team
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Manage team members and invite users to {activeTenant?.name || 'this workspace'}.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: activeTenant?.role === 'admin' ? 'minmax(300px, 1fr) 2fr' : '1fr', gap: '2rem', alignItems: 'start' }}>
        {/* Left Column: Invite User Form */}
        {activeTenant?.role === 'admin' && (
          <div className="glass-card">
            <h3 style={{ fontSize: '1.2rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MailPlus size={18} style={{ color: 'var(--accent-primary)' }} />
              Invite User
            </h3>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="teammate@company.com"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-select" value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="member">Member</option>
                  <option value="billing">Billing</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: '0.5rem' }}>
                <MailPlus size={16} /> {loading ? 'Creating...' : 'Create Invite'}
              </button>
            </form>

            {lastInvite?.joinUrl && (
              <div className="info-alert" style={{ marginTop: '1.5rem', marginBottom: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="info-alert-text" style={{ marginBottom: '0.5rem' }}>
                    Invite link for {lastInvite.meta?.email}
                  </p>
                  <input className="form-input" value={lastInvite.joinUrl} readOnly />
                </div>
                <button className="btn btn-secondary" type="button" onClick={copyInvite} title="Copy invite link" style={{ padding: '0 0.75rem', height: '40px', marginTop: '1.75rem' }}>
                  <Copy size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Right Column: Active Team Members */}
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
            <div className="table-container" style={{ margin: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Joined At</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: 'rgba(255, 255, 255, 0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--accent-primary)',
                            fontWeight: 'bold',
                            fontSize: '0.9rem',
                            border: '1px solid rgba(255, 255, 255, 0.1)'
                          }}>
                            {u.email.charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 500 }}>{u.email}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge-paid' : u.role === 'billing' ? 'badge-accepted' : 'badge-draft'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                          <Calendar size={14} />
                          {new Date(u.created_at).toLocaleDateString()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Team;
