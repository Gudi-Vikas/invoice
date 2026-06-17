import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';

/**
 * MasterAdmins — Co-admin management panel.
 * List, enable/disable master admin accounts.
 */
export const MasterAdmins = () => {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAdmins(); }, []);

  const loadAdmins = async () => {
    try {
      const data = await api.masterListAdmins();
      setAdmins(data.admins || []);
    } catch (err) {
      showToast('Failed to load admins.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      const data = await api.masterToggleAdmin(id);
      showToast(data.message, 'success');
      loadAdmins();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          <ShieldCheck size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-secondary)' }} />
          Platform Admins
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Manage master admin accounts. Toggle active/inactive status.
        </p>
      </div>

      <div className="glass-card" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>Loading...</p>
        ) : admins.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>No admin accounts found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
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
                    <td>
                      <span className={`badge ${admin.is_active ? 'badge-paid' : 'badge-overdue'}`}>
                        {admin.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {admin.last_login ? new Date(admin.last_login).toLocaleString() : 'Never'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {new Date(admin.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => handleToggle(admin.id)}
                        disabled={isSelf}
                        title={isSelf ? 'Cannot toggle your own account' : admin.is_active ? 'Disable' : 'Enable'}
                        style={{
                          background: 'none', border: 'none', cursor: isSelf ? 'not-allowed' : 'pointer',
                          color: isSelf ? 'var(--text-muted)' : admin.is_active ? 'var(--accent-success)' : 'var(--accent-danger)',
                          opacity: isSelf ? 0.4 : 1, padding: '0.25rem'
                        }}
                      >
                        {admin.is_active
                          ? <ToggleRight size={22} />
                          : <ToggleLeft size={22} />
                        }
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default MasterAdmins;
