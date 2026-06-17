import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import { Search, Building2, ArrowUpRight } from 'lucide-react';

/**
 * MasterTenants — Paginated tenant list with search and status filters.
 */
export const MasterTenants = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { loadTenants(); }, [pagination.page, statusFilter]);

  const loadTenants = async () => {
    setLoading(true);
    try {
      const params = { page: pagination.page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;

      const data = await api.masterListTenants(params);
      setTenants(data.tenants || []);
      setPagination(prev => ({ ...prev, totalPages: data.pagination?.totalPages || 1, total: data.pagination?.total || 0 }));
    } catch (err) {
      showToast('Failed to load tenants.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
    loadTenants();
  };

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          <Building2 size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
          Tenant Management
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          {pagination.total} total tenants on the platform.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', flex: 1, minWidth: '300px' }}>
          <input
            type="text" className="form-input" placeholder="Search by name or domain..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>
            <Search size={16} />
          </button>
        </form>

        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
          style={{ width: '180px' }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="trial">Trial</option>
        </select>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: '0' }}>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>Loading tenants...</p>
        ) : tenants.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>No tenants found.</p>
        ) : (
          <div className="table-container" style={{ margin: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Domain</th>
                  <th>Plan</th>
                  <th>Users</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/master/tenants/${t.id}`)}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{t.domain || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{t.plan_name || '—'}</td>
                    <td>{t.user_count || 0}</td>
                    <td>
                      <span className={`badge badge-${t.status === 'active' ? 'paid' : t.status === 'suspended' ? 'overdue' : 'draft'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <ArrowUpRight size={14} style={{ color: 'var(--text-muted)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button className="btn btn-secondary" disabled={pagination.page <= 1}
            onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            Previous
          </button>
          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0 1rem' }}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button className="btn btn-secondary" disabled={pagination.page >= pagination.totalPages}
            onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default MasterTenants;
