/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  CreditCard, Plus, Edit3, Archive, RotateCcw, Check,
  X, Infinity, Users, FileText, Crown, RefreshCw, Zap
} from 'lucide-react';

const FEATURE_KEYS = [
  { key: 'max_clients',            label: 'Clients',                icon: Users },
  { key: 'max_invoices_per_month', label: 'Invoices / Month',       icon: FileText },
  { key: 'max_quotes_per_month',   label: 'Quotes / Month',         icon: FileText },
  { key: 'max_team_members',       label: 'Team Members',           icon: Users },
  { key: 'custom_branding',        label: 'Custom Branding',        icon: Crown }
];

const emptyPlan = {
  name: '',
  description: '',
  priceMonthly: '',
  priceAnnually: '',
  displayOrder: 0,
  isFeatured: false,
  badgeText: '',
  features: FEATURE_KEYS.map(fk => ({ key: fk.key, limit: 0, unlimited: false }))
};

/**
 * MasterPlans — Admin panel for creating and managing SaaS subscription plans.
 */
export const MasterPlans = () => {
  const { showToast } = useToast();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null); // null = create, object = edit
  const [form, setForm] = useState({ ...emptyPlan });
  const [saving, setSaving] = useState(false);

  const loadPlans = useCallback(async () => {
    try {
      const data = await api.masterListPlans({ includeArchived: 'true' });
      setPlans(data.plans || []);
    } catch {
      showToast('Failed to load plans.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyPlan, features: FEATURE_KEYS.map(fk => ({ key: fk.key, limit: 0, unlimited: false })) });
    setShowModal(true);
  };

  const openEdit = (plan) => {
    setEditing(plan);
    const features = FEATURE_KEYS.map(fk => {
      const existing = plan.features?.find(f => f.key === fk.key);
      if (existing) {
        return {
          key: fk.key,
          limit: existing.limit === -1 ? 0 : existing.limit,
          unlimited: existing.limit === -1
        };
      }
      return { key: fk.key, limit: 0, unlimited: false };
    });

    setForm({
      name: plan.name || '',
      description: plan.description || '',
      priceMonthly: plan.price_monthly?.toString() || '',
      priceAnnually: plan.price_annually?.toString() || '',
      displayOrder: plan.display_order || 0,
      isFeatured: plan.is_featured || false,
      badgeText: plan.badge_text || '',
      features
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.priceMonthly) {
      showToast('Plan name and monthly price are required.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        priceMonthly: parseFloat(form.priceMonthly),
        priceAnnually: form.priceAnnually ? parseFloat(form.priceAnnually) : null,
        displayOrder: parseInt(form.displayOrder) || 0,
        isFeatured: form.isFeatured,
        badgeText: form.badgeText.trim() || null,
        features: form.features.map(f => ({
          key: f.key,
          limit: f.unlimited ? -1 : parseInt(f.limit) || 0
        }))
      };

      if (editing) {
        const result = await api.masterUpdatePlan(editing.id, payload);
        showToast(result.message || 'Plan updated.', 'success');
      } else {
        const result = await api.masterCreatePlan(payload);
        showToast(result.message || 'Plan created.', 'success');
      }

      setShowModal(false);
      loadPlans();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (plan) => {
    if (!confirm(`Archive "${plan.name}"? It will be hidden from tenants but existing subscribers will keep their plan.`)) return;
    try {
      const result = await api.masterArchivePlan(plan.id);
      showToast(result.message, 'success');
      loadPlans();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRestore = async (plan) => {
    try {
      const result = await api.masterRestorePlan(plan.id);
      showToast(result.message, 'success');
      loadPlans();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const updateFeature = (idx, field, value) => {
    setForm(prev => {
      const features = [...prev.features];
      features[idx] = { ...features[idx], [field]: value };
      return { ...prev, features };
    });
  };

  if (loading) {
    return (
      <div className="fade-in">
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '1rem' }}>Subscription Plans</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Loading plans...</p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            <CreditCard size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-secondary)' }} />
            Subscription Plans
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Create and manage SaaS plans with usage limits. Plans auto-sync to Razorpay.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={loadPlans} style={{ gap: '0.5rem' }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={openCreate} style={{ gap: '0.5rem' }}>
            <Plus size={16} /> Create Plan
          </button>
        </div>
      </div>

      {/* Plans Grid */}
      {plans.length === 0 ? (
        <div className="plan-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <CreditCard size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>No Plans Created Yet</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Create your first SaaS subscription plan to get started.
          </p>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> Create Your First Plan
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.5rem' }}>
          {plans.map(plan => {
            const isArchived = !plan.is_active;
            const features = plan.features?.filter(f => f.key) || [];
            const subscriberCount = parseInt(plan.active_subscribers) || 0;

            return (
              <div
                key={plan.id}
                className="plan-card"
                style={{
                  padding: '1.75rem',
                  opacity: isArchived ? 0.55 : 1,
                  border: plan.is_featured
                    ? '2px solid var(--accent-secondary)'
                    : '1px solid var(--border-color)',
                  position: 'relative',
                  transition: 'all 0.3s ease'
                }}
              >
                {/* Status Badge */}
                <div style={{
                  position: 'absolute', top: '-1px', right: '1.5rem',
                  background: isArchived ? 'var(--accent-danger)' : plan.is_featured ? 'var(--accent-secondary)' : 'var(--accent-success)',
                  color: '#fff',
                  padding: '0.2rem 0.65rem', borderRadius: '0 0 8px 8px',
                  fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  {isArchived ? 'Archived' : plan.badge_text || (plan.is_featured ? '★ Featured' : 'Active')}
                </div>

                {/* Plan Name */}
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.35rem', marginTop: '0.5rem' }}>
                  {plan.name}
                </h3>
                {plan.description && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: '1.4' }}>
                    {plan.description}
                  </p>
                )}

                {/* Price */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <span style={{
                    fontSize: '2.2rem', fontWeight: 800, fontFamily: 'var(--font-display)',
                    color: plan.is_featured ? 'var(--accent-secondary)' : 'var(--accent-primary)'
                  }}>
                    ₹{parseFloat(plan.price_monthly || 0).toLocaleString('en-IN')}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}> / month</span>
                  {plan.price_annually && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.2rem' }}>
                      or ₹{parseFloat(plan.price_annually).toLocaleString('en-IN')} / year
                    </div>
                  )}
                </div>

                {/* Features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1.25rem' }}>
                  {features.map((f, fi) => {
                    const fk = FEATURE_KEYS.find(k => k.key === f.key);
                    const Icon = fk?.icon || Check;
                    return (
                      <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Icon size={13} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {f.limit === -1
                            ? <><Infinity size={12} style={{ verticalAlign: 'middle' }} /> Unlimited {fk?.label || f.key}</>
                            : f.key === 'custom_branding'
                              ? (f.limit >= 1 ? 'Custom Branding' : 'No Custom Branding')
                              : `${f.limit} ${fk?.label || f.key}`
                          }
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Subscribers + Razorpay */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.65rem 0', borderTop: '1px solid var(--border-color)',
                  marginBottom: '1rem'
                }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <Users size={12} style={{ verticalAlign: 'middle' }} /> {subscriberCount} active subscriber{subscriberCount !== 1 ? 's' : ''}
                  </span>
                  {plan.external_product_id && (
                    <span style={{
                      fontSize: '0.65rem', color: 'var(--accent-success)', fontWeight: 600,
                      padding: '0.15rem 0.5rem', background: 'rgba(16, 185, 129, 0.1)',
                      borderRadius: '4px'
                    }}>
                      <Zap size={10} style={{ verticalAlign: 'middle' }} /> Razorpay Synced
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, fontSize: '0.82rem', padding: '0.5rem' }}
                    onClick={() => openEdit(plan)}
                  >
                    <Edit3 size={13} /> Edit
                  </button>
                  {isArchived ? (
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1, fontSize: '0.82rem', padding: '0.5rem' }}
                      onClick={() => handleRestore(plan)}
                    >
                      <RotateCcw size={13} /> Restore
                    </button>
                  ) : (
                    <button
                      className="btn btn-danger"
                      style={{ flex: 1, fontSize: '0.82rem', padding: '0.5rem' }}
                      onClick={() => handleArchive(plan)}
                    >
                      <Archive size={13} /> Archive
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="plan-card modal-card"
            style={{ '--modal-width': '620px', padding: '2rem', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.75rem' }}>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 700 }}>
                {editing ? `Edit Plan — ${editing.name}` : 'Create New Plan'}
              </h2>
              <button
                className="btn"
                onClick={() => setShowModal(false)}
                style={{ background: 'none', color: 'var(--text-muted)', padding: '0.5rem' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Basic Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">Plan Name *</label>
                <input
                  className="form-input"
                  placeholder="e.g. Professional Plan"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Monthly Price (₹) *</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="999"
                  min="0"
                  step="0.01"
                  value={form.priceMonthly}
                  onChange={(e) => setForm(prev => ({ ...prev, priceMonthly: e.target.value }))}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Annual Price (₹)</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="9990 (optional)"
                  min="0"
                  step="0.01"
                  value={form.priceAnnually}
                  onChange={(e) => setForm(prev => ({ ...prev, priceAnnually: e.target.value }))}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  placeholder="Short description of what this plan offers..."
                  rows={2}
                  style={{ minHeight: '60px' }}
                  value={form.description}
                  onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            {/* Feature Limits */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--accent-secondary)' }}>
                Feature Limits
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {form.features.map((feat, idx) => {
                  const fk = FEATURE_KEYS.find(k => k.key === feat.key);
                  const isBooleanFeature = feat.key === 'custom_branding';

                  return (
                    <div
                      key={feat.key}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '1rem',
                        padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--border-color)', borderRadius: '10px'
                      }}
                    >
                      <span style={{ flex: 1, fontSize: '0.88rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        {fk?.label || feat.key}
                      </span>

                      {isBooleanFeature ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={feat.limit > 0 || feat.unlimited}
                            onChange={(e) => updateFeature(idx, 'limit', e.target.checked ? 1 : 0)}
                            style={{ width: '18px', height: '18px', accentColor: 'var(--accent-secondary)' }}
                          />
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Enabled</span>
                        </label>
                      ) : (
                        <>
                          <input
                            type="number"
                            className="form-input"
                            placeholder="0"
                            min="0"
                            value={feat.unlimited ? '' : feat.limit}
                            disabled={feat.unlimited}
                            onChange={(e) => updateFeature(idx, 'limit', parseInt(e.target.value) || 0)}
                            style={{
                              width: '90px', padding: '0.4rem 0.6rem', fontSize: '0.88rem',
                              textAlign: 'center', opacity: feat.unlimited ? 0.3 : 1
                            }}
                          />
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={feat.unlimited}
                              onChange={(e) => updateFeature(idx, 'unlimited', e.target.checked)}
                              style={{ width: '16px', height: '16px', accentColor: 'var(--accent-secondary)' }}
                            />
                            <Infinity size={14} style={{ color: feat.unlimited ? 'var(--accent-success)' : 'var(--text-muted)' }} />
                            <span style={{ fontSize: '0.78rem', color: feat.unlimited ? 'var(--accent-success)' : 'var(--text-muted)' }}>
                              Unlimited
                            </span>
                          </label>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Display Settings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Display Order</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={form.displayOrder}
                  onChange={(e) => setForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Badge Text</label>
                <input
                  className="form-input"
                  placeholder="e.g. Most Popular"
                  value={form.badgeText}
                  onChange={(e) => setForm(prev => ({ ...prev, badgeText: e.target.value }))}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.isFeatured}
                    onChange={(e) => setForm(prev => ({ ...prev, isFeatured: e.target.checked }))}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-secondary)' }}
                  />
                  <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                    ★ Featured Plan <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(highlighted to tenants)</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: '140px' }}>
                {saving
                  ? 'Saving...'
                  : editing
                    ? 'Update Plan'
                    : <><Plus size={14} /> Create Plan</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterPlans;
