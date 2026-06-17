import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  Building2, TrendingUp, DollarSign, Users, AlertTriangle,
  ArrowUpRight, RefreshCw
} from 'lucide-react';

/**
 * MasterDashboard — Platform health snapshot.
 */
export const MasterDashboard = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    try {
      const data = await api.masterDashboard();
      setStats(data.stats);
    } catch (err) {
      showToast('Failed to load dashboard stats.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkOverdue = async () => {
    try {
      const data = await api.masterMarkOverdue();
      showToast(data.message, 'success');
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (loading || !stats) {
    return (
      <div className="fade-in">
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '1rem' }}>Platform Dashboard</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Loading platform statistics...</p>
      </div>
    );
  }

  const t = stats.tenants || {};
  const b = stats.billing || {};

  const metricCards = [
    { label: 'Total Tenants', value: t.total_tenants || 0, icon: Building2, color: 'var(--accent-primary)' },
    { label: 'Active', value: t.active_tenants || 0, icon: Users, color: 'var(--accent-success)' },
    { label: 'Suspended', value: t.suspended_tenants || 0, icon: AlertTriangle, color: 'var(--accent-danger)' },
    { label: 'Monthly MRR', value: `₹${parseFloat(stats.mrr || 0).toLocaleString('en-IN')}`, icon: DollarSign, color: 'var(--accent-warning)' },
    { label: 'New Today', value: t.new_today || 0, icon: TrendingUp, color: 'var(--accent-secondary)' },
    { label: 'New This Month', value: t.new_this_month || 0, icon: TrendingUp, color: 'hsl(180, 70%, 50%)' }
  ];

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>Platform Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)' }}>High-level health snapshot of the Ultrakey SaaS platform.</p>
        </div>
        <button className="btn btn-secondary" onClick={loadStats} style={{ gap: '0.5rem' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Metric Cards */}
      <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {metricCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="glass-card metric-card" style={{ borderTop: `2px solid ${card.color}22` }}>
              <div className="metric-icon-wrap" style={{ color: card.color, borderColor: `${card.color}33`, width: '44px', height: '44px' }}>
                <Icon size={18} />
              </div>
              <div className="metric-details">
                <h4 style={{ fontSize: '0.75rem' }}>{card.label}</h4>
                <p style={{ color: card.color, fontSize: '1.4rem' }}>
                  {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>

        {/* Recent Signups */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Recent Signups</h3>
            <button className="btn btn-secondary" onClick={() => navigate('/master/tenants')}
              style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }}>
              View All <ArrowUpRight size={12} />
            </button>
          </div>
          {(stats.recentSignups || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No recent signups.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentSignups.map(t => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/master/tenants/${t.id}`)}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{t.plan_name || '—'}</td>
                    <td><span className={`badge badge-${t.status === 'active' ? 'paid' : t.status === 'suspended' ? 'overdue' : 'draft'}`}>{t.status}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Billing Snapshot */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem' }}>Billing Snapshot</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { label: 'Pending Invoices', value: b.pending_invoices || 0, color: 'var(--accent-warning)' },
              { label: 'Overdue Invoices', value: b.overdue_invoices || 0, color: 'var(--accent-danger)' },
              { label: 'Collected This Month', value: `₹${parseFloat(b.collected_this_month || 0).toLocaleString('en-IN')}`, color: 'var(--accent-success)' }
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-color)', borderRadius: '10px'
              }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{item.label}</span>
                <span style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: item.color }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-secondary" onClick={handleMarkOverdue} style={{ flex: 1, fontSize: '0.82rem' }}>
              <AlertTriangle size={14} /> Mark Overdue
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/master/billing')} style={{ flex: 1, fontSize: '0.82rem' }}>
              <ArrowUpRight size={14} /> Billing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MasterDashboard;
