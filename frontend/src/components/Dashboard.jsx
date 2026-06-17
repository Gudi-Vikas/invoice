import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import {
  TrendingUp, ArrowUpRight, DollarSign, Clock, ShieldAlert,
  FilePlus, UserPlus, Zap
} from 'lucide-react';

/**
 * Main Administrative Dashboard.
 * Displays aggregate performance indicators, recent documents, and quick actions.
 * Fetches live data from the backend documents endpoint.
 */
export const Dashboard = () => {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState({
    totalInvoiced: 0, outstanding: 0, collected: 0, overdue: 0
  });
  const [recentDocs, setRecentDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const docsRes = await api.getDocuments({ limit: 50 });
      const documents = docsRes.documents || [];
      setRecentDocs(documents.slice(0, 6));

      let invoiced = 0, paid = 0, unpaid = 0, overdue = 0;
      documents.forEach(d => {
        if (d.type === 'invoice') {
          invoiced += parseFloat(d.total_due || 0);
          if (d.status === 'paid') paid += parseFloat(d.total_due || 0);
          else if (d.status === 'overdue') overdue += parseFloat(d.total_due || 0);
          else unpaid += parseFloat(d.total_due || 0);
        }
      });

      setMetrics({ totalInvoiced: invoiced, collected: paid, outstanding: unpaid, overdue });
    } catch (err) {
      console.error('Error loading dashboard stats:', err);
      showToast('Failed to load dashboard data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const currencySymbol = settings?.tax_config?.currencySymbol || '₹';

  // Revenue sparkline from recent docs
  const sparkValues = recentDocs.map(d => parseFloat(d.total_due || 0));
  const sparkMax = Math.max(...sparkValues, 1);
  const sparkHeight = 40;
  const sparkWidth = 120;
  const sparkPoints = sparkValues.map((v, i) => {
    const x = (i / Math.max(sparkValues.length - 1, 1)) * sparkWidth;
    const y = sparkHeight - (v / sparkMax) * sparkHeight;
    return `${x},${y}`;
  }).join(' ');

  const metricCards = [
    {
      label: 'Total Invoiced', value: metrics.totalInvoiced, icon: TrendingUp,
      color: 'var(--accent-primary)', subtext: 'All time billing'
    },
    {
      label: 'Cash Collected', value: metrics.collected, icon: DollarSign,
      color: 'var(--accent-success)', subtext: 'Settled payments'
    },
    {
      label: 'Outstanding', value: metrics.outstanding, icon: Clock,
      color: 'var(--accent-warning)', subtext: 'Awaiting payment'
    },
    {
      label: 'Overdue', value: metrics.overdue, icon: ShieldAlert,
      color: 'var(--accent-danger)', subtext: 'Past due date'
    }
  ];

  if (loading) {
    return (
      <div className="fade-in" style={{ padding: '2rem' }}>
        <div className="skeleton-block" style={{ width: '300px', height: '2rem', marginBottom: '2rem' }} />
        <div className="dashboard-grid">
          {[1,2,3,4].map(i => (
            <div key={i} className="glass-card" style={{ height: '100px' }}>
              <div className="skeleton-block" style={{ width: '60%', height: '1rem', marginBottom: '0.5rem' }} />
              <div className="skeleton-block" style={{ width: '40%', height: '1.5rem' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Financial Control Plane</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Welcome back. Here is your active financial summary.</p>
      </div>

      {/* Metric Cards Grid */}
      <div className="dashboard-grid">
        {metricCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="glass-card metric-card" style={{
              background: 'var(--bg-card)',
              borderTop: `2px solid ${card.color}22`,
              transition: 'border-color 0.3s ease, transform 0.2s ease'
            }}>
              <div className="metric-icon-wrap" style={{ color: card.color, borderColor: `${card.color}33` }}>
                <Icon size={22} />
              </div>
              <div className="metric-details">
                <h4>{card.label}</h4>
                <p style={{ color: card.color }}>
                  {currencySymbol}{card.value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.15rem' }}>
                  {card.subtext}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '2rem', alignItems: 'start' }}>

        {/* Recent Documents */}
        <div className="glass-card" style={{ padding: '1.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Recent Documents</h3>
            <button
              className="btn btn-secondary"
              onClick={() => navigate('/documents')}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            >
              View All <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="table-container" style={{ margin: 0 }}>
            {recentDocs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2.5rem' }}>
                No documents generated yet. Create your first invoice!
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Client</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDocs.map(doc => (
                    <tr key={doc.id}>
                      <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{doc.document_number}</td>
                      <td>{doc.client_name}</td>
                      <td style={{ textTransform: 'capitalize' }}>{doc.type}</td>
                      <td><span className={`badge badge-${doc.status}`}>{doc.status}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {currencySymbol}{parseFloat(doc.total_due).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Mini Revenue Sparkline */}
          {sparkValues.length > 1 && (
            <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                Recent Revenue Sparkline
              </h4>
              <svg width="100%" height={sparkHeight + 8} viewBox={`0 0 ${sparkWidth} ${sparkHeight + 4}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sparkGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polyline
                  points={sparkPoints}
                  fill="none"
                  stroke="hsl(217, 91%, 60%)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {sparkValues.map((v, i) => {
                  const x = (i / Math.max(sparkValues.length - 1, 1)) * sparkWidth;
                  const y = sparkHeight - (v / sparkMax) * sparkHeight;
                  return <circle key={i} cx={x} cy={y} r="2.5" fill="hsl(217, 91%, 60%)" />;
                })}
              </svg>
            </div>
          )}
        </div>

        {/* Right Column: Quick Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Quick Actions Card */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <Zap size={16} style={{ color: 'var(--accent-warning)' }} />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Quick Actions</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'flex-start', gap: '0.75rem' }}
                onClick={() => navigate('/documents/create')}
              >
                <FilePlus size={16} /> New Invoice
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'flex-start', gap: '0.75rem' }}
                onClick={() => navigate('/clients')}
              >
                <UserPlus size={16} /> Add Client
              </button>
              <button
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'flex-start', gap: '0.75rem' }}
                onClick={() => navigate('/documents')}
              >
                <TrendingUp size={16} /> View All Documents
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
