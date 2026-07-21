/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import {
  TrendingUp, ArrowUpRight, DollarSign, Clock, ShieldAlert,
  FilePlus, UserPlus, Zap, FileText, Crown, AlertTriangle,
  PlusCircle, Eye
} from 'lucide-react';

/**
 * Dashboard — Upgraded Financial Control Plane.
 *
 * New features:
 *  - Monthly Revenue Bar Chart (SVG, last 6 months)
 *  - Document Status Donut Chart (SVG)
 *  - Subscription Countdown Widget
 *  - Top Clients by Revenue
 *  - Expanded Quick Actions
 */
export const Dashboard = () => {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const barsAnimated = useRef(false);

  const [metrics, setMetrics] = useState({ totalInvoiced: 0, outstanding: 0, collected: 0, overdue: 0 });
  const [recentDocs, setRecentDocs] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const [statusBreakdown, setStatusBreakdown] = useState({});
  const [topClients, setTopClients] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [barHeights, setBarHeights] = useState([]);

  const loadDashboardData = useCallback(async () => {
    try {
      const [docsRes, subRes] = await Promise.all([
        api.getDocuments({ limit: 200 }),
        api.getSubscriptionStatus().catch(() => null)
      ]);

      const documents = docsRes.documents || [];
      setRecentDocs(documents.slice(0, 6));

      // ── Metrics ──────────────────────────────────────────────
      let invoiced = 0, paid = 0, unpaid = 0, overdue = 0;
      documents.forEach(d => {
        if (d.type === 'invoice') {
          invoiced += parseFloat(d.total_due || 0);
          if (d.status === 'paid')    paid    += parseFloat(d.total_due || 0);
          else if (d.status === 'overdue') overdue += parseFloat(d.total_due || 0);
          else unpaid += parseFloat(d.total_due || 0);
        }
      });
      setMetrics({ totalInvoiced: invoiced, collected: paid, outstanding: unpaid, overdue });

      // ── Monthly revenue — last 6 months ──────────────────────
      const now = new Date();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          label: d.toLocaleString('default', { month: 'short' }),
          year: d.getFullYear(),
          month: d.getMonth(),
          total: 0
        });
      }
      documents.forEach(d => {
        if (d.type !== 'invoice' || d.status === 'voided') return;
        const created = new Date(d.created_at);
        const m = months.find(m => m.year === created.getFullYear() && m.month === created.getMonth());
        if (m) m.total += parseFloat(d.total_due || 0);
      });
      setMonthlyData(months);

      // ── Status breakdown ──────────────────────────────────────
      const breakdown = {};
      documents.forEach(d => {
        breakdown[d.status] = (breakdown[d.status] || 0) + 1;
      });
      setStatusBreakdown(breakdown);

      // ── Top clients by total invoiced ─────────────────────────
      const clientMap = {};
      documents.forEach(d => {
        if (d.type !== 'invoice' || !d.client_name) return;
        if (!clientMap[d.client_name]) clientMap[d.client_name] = 0;
        clientMap[d.client_name] += parseFloat(d.total_due || 0);
      });
      const sorted = Object.entries(clientMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, total]) => ({ name, total }));
      setTopClients(sorted);

      // ── Subscription ──────────────────────────────────────────
      if (subRes?.subscription) setSubscription(subRes.subscription);

    } catch (err) {
      console.error('Dashboard load error:', err);
      showToast('Failed to load dashboard data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  // Animate bar chart heights on mount
  useEffect(() => {
    if (monthlyData.length && !barsAnimated.current) {
      barsAnimated.current = true;
      setTimeout(() => setBarHeights(monthlyData.map(m => m.total)), 80);
    }
  }, [monthlyData]);

  const currencySymbol = settings?.tax_config?.currencySymbol || '₹';

  // ── Bar chart helpers ─────────────────────────────────────────────
  const barMax = Math.max(...monthlyData.map(m => m.total), 1);

  // ── Donut chart helpers ───────────────────────────────────────────
  const donutData = [
    { label: 'Paid',      key: 'paid',      color: 'var(--accent-success)' },
    { label: 'Sent',      key: 'sent',      color: 'var(--accent-primary)' },
    { label: 'Accepted',  key: 'accepted',  color: 'hsl(262, 83%, 65%)' },
    { label: 'Overdue',   key: 'overdue',   color: 'var(--accent-danger)' },
    { label: 'Draft',     key: 'draft',     color: 'var(--text-muted)' },
    { label: 'Voided',    key: 'voided',    color: 'rgba(255,255,255,0.15)' },
  ].map(s => ({ ...s, count: statusBreakdown[s.key] || 0 })).filter(s => s.count > 0);
  const donutTotal = donutData.reduce((a, b) => a + b.count, 0);

  // SVG donut arc generator
  const buildDonutArcs = (data, total, r = 36, cx = 50, cy = 50, stroke = 10) => {
    if (total === 0) return [];
    let startAngle = -Math.PI / 2;
    return data.map(seg => {
      const frac = seg.count / total;
      const angle = frac * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = angle > Math.PI ? 1 : 0;
      const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
      const result = { ...seg, d, startAngle };
      startAngle = endAngle;
      return result;
    });
  };
  const donutArcs = buildDonutArcs(donutData, donutTotal);

  // ── Subscription widget ───────────────────────────────────────────
  const subDays = subscription?.current_period_end
    ? Math.max(0, Math.ceil((new Date(subscription.current_period_end) - Date.now()) / 86400000))
    : null;
  const subTotal = 30;
  const subFrac = subDays !== null ? Math.min(subDays / subTotal, 1) : 1;
  const subColor = subDays === null ? 'var(--accent-muted)'
    : subDays <= 3   ? 'var(--accent-danger)'
    : subDays <= 7   ? 'var(--accent-warning)'
    : 'var(--accent-success)';

  // SVG ring for subscription countdown
  const RING_R = 30, RING_CX = 40, RING_CY = 40, RING_STROKE = 6;
  const circumference = 2 * Math.PI * RING_R;
  const dashoffset = circumference * (1 - subFrac);

  const metricCards = [
    { label: 'Total Invoiced', value: metrics.totalInvoiced, icon: TrendingUp,  color: 'var(--accent-primary)',  subtext: 'All time' },
    { label: 'Cash Collected', value: metrics.collected,     icon: DollarSign,  color: 'var(--accent-success)', subtext: 'Settled' },
    { label: 'Outstanding',    value: metrics.outstanding,   icon: Clock,       color: 'var(--accent-warning)', subtext: 'Awaiting' },
    { label: 'Overdue',        value: metrics.overdue,       icon: ShieldAlert, color: 'var(--accent-danger)',  subtext: 'Past due' }
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
      {/* ── Page Header ───────────────────────────────────────── */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Financial Control Plane</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Welcome back. Here is your live financial summary.</p>
      </div>

      {/* ── Metric Cards ──────────────────────────────────────── */}
      <div className="dashboard-grid" style={{ marginBottom: '2rem' }}>
        {metricCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="glass-card metric-card" style={{
              borderTop: `2px solid ${card.color}33`,
              transition: 'border-color 0.3s ease, transform 0.2s ease'
            }}>
              <div className="metric-icon-wrap" style={{ color: card.color, borderColor: `${card.color}33` }}>
                <Icon size={22} />
              </div>
              <div className="metric-details">
                <h4>{card.label}</h4>
                <p style={{ color: card.color, fontSize: '1.5rem' }}>
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

      {/* ── Main Grid: Charts + Sidebar widgets ───────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.75rem', marginBottom: '1.75rem' }}>

        {/* Monthly Revenue Bar Chart */}
        <div className="glass-card" style={{ padding: '1.75rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={16} style={{ color: 'var(--accent-primary)' }} />
            Monthly Revenue
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.4rem' }}>last 6 months</span>
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', height: '120px' }}>
            {monthlyData.map((m, i) => {
              const pct = barHeights[i] !== undefined ? (barHeights[i] / barMax) : 0;
              const heightPx = Math.max(pct * 100, barHeights[i] > 0 ? 4 : 0);
              const isCurrentMonth = i === monthlyData.length - 1;
              return (
                <div key={m.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', height: '100%', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {m.total > 0 ? `${currencySymbol}${Math.round(m.total / 1000)}k` : ''}
                  </span>
                  <div
                    title={`${m.label}: ${currencySymbol}${m.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                    style={{
                      width: '100%',
                      height: `${heightPx}px`,
                      borderRadius: '6px 6px 0 0',
                      background: isCurrentMonth
                        ? 'linear-gradient(to top, var(--accent-primary), hsl(217, 91%, 75%))'
                        : 'linear-gradient(to top, rgba(59,130,246,0.35), rgba(59,130,246,0.15))',
                      transition: 'height 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
                      cursor: 'default',
                      boxShadow: isCurrentMonth ? '0 0 10px rgba(59,130,246,0.3)' : 'none',
                      minHeight: '2px'
                    }}
                  />
                  <span style={{ fontSize: '0.68rem', color: isCurrentMonth ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: isCurrentMonth ? 700 : 400 }}>
                    {m.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right sidebar widgets column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Subscription Countdown Widget */}
          <div className="glass-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Crown size={14} style={{ color: 'var(--accent-secondary)' }} />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Subscription</h3>
            </div>
            {subscription ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx={RING_CX} cy={RING_CY} r={RING_R} fill="none" stroke="var(--border-color)" strokeWidth={RING_STROKE} />
                  <circle
                    cx={RING_CX} cy={RING_CY} r={RING_R}
                    fill="none"
                    stroke={subColor}
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashoffset}
                    transform={`rotate(-90 ${RING_CX} ${RING_CY})`}
                    style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.5s ease', filter: `drop-shadow(0 0 4px ${subColor})` }}
                  />
                  <text x={RING_CX} y={RING_CY} textAnchor="middle" dominantBaseline="middle" fill={subColor} fontSize="11" fontWeight="700" fontFamily="Outfit, sans-serif">
                    {subDays !== null ? `${subDays}d` : '∞'}
                  </text>
                </svg>
                <div>
                  <p style={{ fontWeight: 600, color: subColor, marginBottom: '0.2rem' }}>
                    {subDays === null ? 'Active' : subDays <= 3 ? 'Expiring Soon!' : subDays <= 7 ? 'Renew Soon' : 'Active'}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    {subscription.plan_name || 'Starter'}
                  </p>
                  {subDays !== null && subDays <= 14 && (
                    <button
                      className="btn btn-primary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                      onClick={() => navigate('/subscription')}
                    >
                      Renew Now
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <AlertTriangle size={28} style={{ color: 'var(--accent-warning)', marginBottom: '0.5rem' }} />
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>No active plan</p>
                <button className="btn btn-primary" style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem' }} onClick={() => navigate('/subscription')}>
                  Activate
                </button>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="glass-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Zap size={14} style={{ color: 'var(--accent-warning)' }} />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Quick Actions</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {[
                { label: 'New Invoice',    icon: FilePlus,   color: 'var(--accent-primary)',   action: () => navigate('/invoices/create') },
                { label: 'New Quotation',  icon: FileText,   color: 'var(--accent-secondary)', action: () => navigate('/quotes/create') },
                { label: 'Add Client',     icon: UserPlus,   color: 'var(--accent-success)',   action: () => navigate('/clients') },
                { label: 'View Documents', icon: Eye,        color: 'var(--text-muted)',        action: () => navigate('/invoices') },
              ].map(({ label, icon: Icon, color, action }) => (
                <button
                  key={label}
                  className="btn"
                  onClick={action}
                  style={{
                    width: '100%', justifyContent: 'flex-start', gap: '0.6rem',
                    padding: '0.6rem 0.85rem', background: 'var(--bg-active)',
                    border: '1px solid var(--border-color)', color: 'var(--text-primary)',
                    fontSize: '0.82rem', fontWeight: 500, borderRadius: '8px'
                  }}
                >
                  <Icon size={14} style={{ color }} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Grid: Recent Docs + Status Chart + Top Clients ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: '1.75rem' }}>

        {/* Recent Documents */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Recent Documents</h3>
            <button className="btn btn-secondary" onClick={() => navigate('/invoices')} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}>
              View All <ArrowUpRight size={13} />
            </button>
          </div>
          {recentDocs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <PlusCircle size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No documents yet. Create your first invoice!</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {recentDocs.map(doc => (
                  <tr key={doc.id} style={{ cursor: 'pointer' }} onClick={() => navigate(doc.type === 'invoice' ? '/invoices' : '/quotes')}>
                    <td style={{ fontWeight: 600, color: 'var(--accent-primary)', fontSize: '0.82rem' }}>{doc.document_number}</td>
                    <td style={{ fontSize: '0.82rem', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.client_name}</td>
                    <td><span className={`badge badge-${doc.status}`} style={{ fontSize: '0.65rem' }}>{doc.status}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.82rem' }}>
                      {currencySymbol}{parseFloat(doc.total_due).toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Document Status Donut */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1.25rem' }}>Status Breakdown</h3>
          {donutTotal === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>No data yet</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                <svg width="100" height="100" viewBox="0 0 100 100">
                  {donutArcs.map((arc, i) => (
                    <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth="10"
                      strokeLinecap="butt" />
                  ))}
                  <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fill="var(--text-primary)" fontSize="14" fontWeight="700" fontFamily="Outfit, sans-serif">
                    {donutTotal}
                  </text>
                  <text x="50" y="62" textAnchor="middle" dominantBaseline="middle" fill="var(--text-muted)" fontSize="7" fontFamily="Inter, sans-serif">
                    total
                  </text>
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {donutData.map(seg => (
                  <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: seg.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', flex: 1 }}>{seg.label}</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>{seg.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Top Clients */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1.25rem' }}>Top Clients</h3>
          {topClients.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>No invoices yet</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {topClients.map((client, i) => {
                const maxTotal = topClients[0].total;
                const pct = (client.total / maxTotal) * 100;
                const rankColors = ['var(--accent-warning)', 'var(--text-secondary)', 'var(--text-muted)'];
                const rankColor = rankColors[i] || 'var(--text-muted)';
                return (
                  <div key={client.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 800, color: rankColor, width: '14px', flexShrink: 0 }}>
                          #{i + 1}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {client.name}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', flexShrink: 0, marginLeft: '0.5rem' }}>
                        {currencySymbol}{Math.round(client.total / 1000)}k
                      </span>
                    </div>
                    <div style={{ height: '4px', borderRadius: '2px', background: 'var(--bg-active)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        borderRadius: '2px',
                        background: i === 0
                          ? 'linear-gradient(to right, var(--accent-primary), var(--accent-secondary))'
                          : 'var(--accent-primary)',
                        opacity: 0.6 + (i === 0 ? 0.4 : 0),
                        transition: 'width 0.8s ease'
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
