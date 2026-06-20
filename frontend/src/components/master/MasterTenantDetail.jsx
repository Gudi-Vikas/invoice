/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  ArrowLeft, CreditCard, Receipt, ShieldAlert,
  Power, PowerOff, Trash2, Save, Users
} from 'lucide-react';

/**
 * MasterTenantDetail — Full tenant profile with tabs.
 */
export const MasterTenantDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [subOverride, setSubOverride] = useState({ planId: '', status: '', currentPeriodEnd: '' });

  // Billing generation and user invitation state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateData, setGenerateData] = useState({
    billingPeriodStart: '',
    billingPeriodEnd: '',
    dueDate: '',
    amountOverride: '',
    notes: ''
  });

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLink, setInviteLink] = useState('');

  const loadPlans = useCallback(async () => {
    try {
      const planData = await api.getPlans();
      setPlans(planData || []);
    } catch {
      showToast('Failed to load subscription plans.', 'error');
    }
  }, [showToast]);

  const loadTenant = useCallback(async () => {
    try {
      const result = await api.masterGetTenant(id);
      setData(result);
    } catch {
      showToast('Failed to load tenant details.', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { loadTenant(); loadPlans(); }, [loadTenant, loadPlans]);

  const handleSuspend = async () => {
    try {
      await api.masterDisableTenant(id, 'Suspended by platform admin');
      showToast('Tenant suspended.', 'success');
      loadTenant();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleEnable = async () => {
    try {
      await api.masterEnableTenant(id);
      showToast('Tenant re-activated.', 'success');
      loadTenant();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDelete = async () => {
    try {
      await api.masterDeleteTenant(id);
      showToast('Tenant permanently deleted.', 'success');
      navigate('/master/tenants');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleSubOverride = async (e) => {
    e.preventDefault();
    const payload = {};
    if (subOverride.planId) payload.planId = subOverride.planId;
    if (subOverride.status) payload.status = subOverride.status;
    if (subOverride.currentPeriodEnd) payload.currentPeriodEnd = subOverride.currentPeriodEnd;

    try {
      await api.masterOverrideSub(id, payload);
      showToast('Subscription overridden.', 'success');
      loadTenant();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleGenerateInvoice = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        tenantId: id,
        billingPeriodStart: generateData.billingPeriodStart,
        billingPeriodEnd: generateData.billingPeriodEnd,
        dueDate: generateData.dueDate,
        notes: generateData.notes || undefined
      };
      if (generateData.amountOverride) {
        payload.amountOverride = parseFloat(generateData.amountOverride);
      }

      await api.masterGenerateBilling(payload);
      showToast('Billing invoice generated successfully.', 'success');
      setShowGenerateModal(false);
      setGenerateData({
        billingPeriodStart: '',
        billingPeriodEnd: '',
        dueDate: '',
        amountOverride: '',
        notes: ''
      });
      loadTenant();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();
    try {
      const result = await api.invite({ email: inviteEmail, role: inviteRole }, id);
      setInviteLink(result.joinUrl);
      showToast('Invitation generated successfully.', 'success');
      loadTenant();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (loading || !data) {
    return (
      <div className="fade-in">
        <button className="btn btn-secondary" onClick={() => navigate('/master/tenants')} style={{ marginBottom: '1rem' }}>
          <ArrowLeft size={15} /> Back
        </button>
        <p style={{ color: 'var(--text-secondary)' }}>Loading tenant details...</p>
      </div>
    );
  }

  const { tenant, users = [], subscriptionHistory = [], settings, recentBillingInvoices = [] } = data;
  const tabs = [
    { key: 'overview', name: 'Overview' },
    { key: 'users', name: `Users (${users.length})` },
    { key: 'subscription', name: 'Subscription' },
    { key: 'billing', name: `Billing (${recentBillingInvoices.length})` }
  ];

  return (
    <div className="fade-in">
      <button className="btn btn-secondary" onClick={() => navigate('/master/tenants')}
        style={{ marginBottom: '1.25rem', padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
        <ArrowLeft size={15} /> Back to Tenants
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>{tenant.name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {tenant.domain || 'No domain'} · ID: {tenant.id}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {tenant.status === 'active' ? (
            <button className="btn btn-secondary" onClick={handleSuspend} style={{ fontSize: '0.82rem', color: 'var(--accent-warning)' }}>
              <PowerOff size={14} /> Suspend
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleEnable} style={{ fontSize: '0.82rem' }}>
              <Power size={14} /> Enable
            </button>
          )}
          <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)} style={{ fontSize: '0.82rem' }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* Status badge */}
      <div style={{ marginBottom: '1.5rem' }}>
        <span className={`badge badge-${tenant.status === 'active' ? 'paid' : tenant.status === 'suspended' ? 'overdue' : 'draft'}`}
          style={{ fontSize: '0.8rem', padding: '0.35rem 1rem' }}>
          {tenant.status?.toUpperCase()}
        </span>
        {tenant.plan_name && (
          <span className="badge badge-published" style={{ marginLeft: '0.5rem', fontSize: '0.8rem', padding: '0.35rem 1rem' }}>
            {tenant.plan_name}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="settings-tabs-header" style={{ marginBottom: '1.5rem' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`settings-tab-btn ${activeTab === tab.key ? 'active' : ''}`}>
            {tab.name}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="glass-card">
          <h3 style={{ marginBottom: '1rem' }}>Tenant Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {[
              ['Name', tenant.name],
              ['Domain', tenant.domain || '—'],
              ['Status', tenant.status],
              ['Plan', tenant.plan_name || '—'],
              ['Plan Price', tenant.price_monthly ? `₹${tenant.price_monthly}` : '—'],
              ['Period End', tenant.current_period_end ? new Date(tenant.current_period_end).toLocaleDateString() : '—'],
              ['Created', new Date(tenant.created_at).toLocaleString()],
              ['Business', settings?.business_info?.businessName || '—']
            ].map(([label, value], i) => (
              <div key={i}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                <p style={{ fontSize: '0.95rem', fontWeight: 500, marginTop: '0.15rem' }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="glass-card" style={{ padding: '0' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3><Users size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} /> Users</h3>
            <button className="btn btn-primary" onClick={() => {
              setInviteEmail('');
              setInviteRole('member');
              setInviteLink('');
              setShowInviteModal(true);
            }} style={{ fontSize: '0.82rem' }}>
              Invite User
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Joined</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.email}</td>
                  <td><span className={`badge badge-${u.role === 'admin' ? 'published' : 'draft'}`}>{u.role}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'subscription' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Override Form */}
          <div className="glass-card">
            <h3 style={{ marginBottom: '1rem' }}><CreditCard size={16} style={{ verticalAlign: 'middle' }} /> Override Subscription</h3>
            <form onSubmit={handleSubOverride}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Plan</label>
                  <select className="form-select"
                    value={subOverride.planId} onChange={e => setSubOverride(p => ({ ...p, planId: e.target.value }))}>
                    <option value="">No change</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} - ₹{parseFloat(plan.price_monthly || 0).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Status</label>
                  <select className="form-select" value={subOverride.status}
                    onChange={e => setSubOverride(p => ({ ...p, status: e.target.value }))}>
                    <option value="">No change</option>
                    <option value="active">Active</option>
                    <option value="past_due">Past Due</option>
                    <option value="canceled">Canceled</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Period End</label>
                  <input type="date" className="form-input"
                    value={subOverride.currentPeriodEnd} onChange={e => setSubOverride(p => ({ ...p, currentPeriodEnd: e.target.value }))} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem' }}>
                <Save size={14} /> Apply Override
              </button>
            </form>
          </div>

          {/* History */}
          <div className="glass-card" style={{ padding: '0' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3>Subscription History</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Plan</th><th>Status</th><th>Price</th><th>Period End</th></tr>
              </thead>
              <tbody>
                {subscriptionHistory.map((s, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{s.plan_name}</td>
                    <td><span className={`badge badge-${s.status === 'active' ? 'paid' : 'draft'}`}>{s.status}</span></td>
                    <td>₹{parseFloat(s.price_monthly || 0).toFixed(2)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="glass-card" style={{ padding: '0' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3><Receipt size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} /> Billing Invoices</h3>
            <button className="btn btn-primary" onClick={() => setShowGenerateModal(true)} style={{ fontSize: '0.82rem' }}>
              Generate Invoice
            </button>
          </div>
          {recentBillingInvoices.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No billing invoices for this tenant.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Invoice #</th><th>Amount</th><th>Status</th><th>Due Date</th></tr>
              </thead>
              <tbody>
                {recentBillingInvoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{inv.invoice_number}</td>
                    <td>₹{parseFloat(inv.total_amount || 0).toFixed(2)}</td>
                    <td><span className={`badge badge-${inv.status === 'paid' ? 'paid' : inv.status === 'overdue' ? 'overdue' : 'draft'}`}>{inv.status}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Generate Invoice Modal */}
      {showGenerateModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '480px' }}>
            <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Receipt size={18} style={{ color: 'var(--accent-primary)' }} />
              Generate Platform Invoice
            </h3>
            <form onSubmit={handleGenerateInvoice}>
              <div className="form-group">
                <label className="form-label">Billing Period Start</label>
                <input
                  type="date"
                  className="form-input"
                  value={generateData.billingPeriodStart}
                  onChange={e => setGenerateData(prev => ({ ...prev, billingPeriodStart: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Billing Period End</label>
                <input
                  type="date"
                  className="form-input"
                  value={generateData.billingPeriodEnd}
                  onChange={e => setGenerateData(prev => ({ ...prev, billingPeriodEnd: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={generateData.dueDate}
                  onChange={e => setGenerateData(prev => ({ ...prev, dueDate: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Amount Override (INR, pre-tax, optional)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 999.00"
                  className="form-input"
                  value={generateData.amountOverride}
                  onChange={e => setGenerateData(prev => ({ ...prev, amountOverride: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <textarea
                  className="form-input"
                  placeholder="Additional invoice notes"
                  value={generateData.notes || ''}
                  onChange={e => setGenerateData(prev => ({ ...prev, notes: e.target.value }))}
                  style={{ minHeight: '60px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowGenerateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Generate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '440px' }}>
            <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={18} style={{ color: 'var(--accent-primary)' }} />
              Invite User to Tenant
            </h3>
            <form onSubmit={handleInviteUser}>
              <div className="form-group">
                <label className="form-label">User Email</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Workspace Role</label>
                <select
                  className="form-select"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                >
                  <option value="member">Member</option>
                  <option value="billing">Billing</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              
              {inviteLink && (
                <div className="info-alert" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span className="info-alert-text">Invite link generated:</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input className="form-input" value={inviteLink} readOnly style={{ margin: 0 }} />
                    <button type="button" className="btn btn-secondary" onClick={async () => {
                      await navigator.clipboard.writeText(inviteLink);
                      showToast('Invite link copied.', 'success');
                    }} style={{ padding: '0 0.75rem', height: '40px' }}>
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowInviteModal(false)}>Close</button>
                <button type="submit" className="btn btn-primary" disabled={!!inviteLink}>Invite</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '440px' }}>
            <h3 style={{ color: 'var(--accent-danger)', marginBottom: '1rem' }}>
              <ShieldAlert size={18} style={{ verticalAlign: 'middle' }} /> Permanently Delete Tenant
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              This will permanently delete <strong>{tenant.name}</strong> and all associated data. This action <strong>cannot be undone</strong>.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>
                <Trash2 size={14} /> Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterTenantDetail;
