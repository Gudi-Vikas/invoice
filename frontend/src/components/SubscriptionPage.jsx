/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  CreditCard, Check, X, Zap, ArrowRight,
  Users, FileText, Crown, Clock, TrendingUp, Eye
} from 'lucide-react';
import PlatformInvoiceVisualizer from './shared/PlatformInvoiceVisualizer';

const loadRazorpayScript = () => new Promise((resolve) => {
  if (window.Razorpay) {
    resolve(true);
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.onload = () => resolve(true);
  script.onerror = () => resolve(false);
  document.body.appendChild(script);
});

const FEATURE_META = {
  max_clients:            { label: 'Clients',           icon: Users },
  max_invoices_per_month: { label: 'Invoices / Month',  icon: FileText },
  max_quotes_per_month:   { label: 'Quotes / Month',    icon: FileText },
  max_team_members:       { label: 'Team Members',      icon: Users },
  custom_branding:        { label: 'Custom Branding',   icon: Crown }
};

/**
 * SubscriptionPage — Multi-plan pricing page with Razorpay checkout.
 */
export const SubscriptionPage = () => {
  const { showToast } = useToast();
  const { user, activeTenant } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(null);
  
  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [viewingInvoice, setViewingInvoice] = useState(null);

  const [subscription, setSubscription] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(true);

  const loadPlans = useCallback(async () => {
    try {
      const data = await api.getPlans();
      setPlans(data || []);
    } catch {
      showToast('Failed to load subscription plans.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadInvoices = useCallback(async () => {
    try {
      const data = await api.getPlatformInvoices();
      setInvoices(data || []);
    } catch {
      showToast('Failed to load billing invoices.', 'error');
    } finally {
      setLoadingInvoices(false);
    }
  }, [showToast]);

  const loadSubscriptionStatus = useCallback(async () => {
    try {
      const data = await api.getSubscriptionStatus();
      setSubscription(data?.subscription || null);
    } catch {
      showToast('Failed to load subscription status.', 'error');
    } finally {
      setLoadingSubscription(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadPlans();
    loadInvoices();
    loadSubscriptionStatus();
  }, [loadPlans, loadInvoices, loadSubscriptionStatus]);

  const isActive = subscription?.status === 'active';
  const currentPlanId = subscription?.plan_id;

  const handleCheckout = async (planId) => {
    setCheckingOut(planId);
    try {
      const checkout = await api.checkout(planId);
      const details = checkout.data;

      if (details?.mockMode) {
        await api.verifyCheckout({
          razorpay_order_id: details.order.id,
          razorpay_payment_id: `pay_mock_${details.order.id}`,
          razorpay_signature: 'mock_signature'
        });
        showToast('Subscription activated (mock mode).', 'success');
        loadPlans();
        loadSubscriptionStatus();
        return;
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Unable to load Razorpay Checkout. Please check your network and try again.');
      }

      const razorpay = new window.Razorpay({
        key: details.keyId,
        amount: details.order.amount,
        currency: details.order.currency || 'INR',
        name: 'Ultrakey IT Solutions',
        description: `${details.planName} Subscription`,
        order_id: details.order.id,
        prefill: {
          email: user?.email || details.adminEmail || ''
        },
        notes: {
          tenant_id: activeTenant?.id || '',
          plan_id: planId
        },
        handler: async (response) => {
          await api.verifyCheckout(response);
          showToast('Subscription activated successfully!', 'success');
          loadPlans();
          loadSubscriptionStatus();
        },
        modal: {
          ondismiss: () => showToast('Payment was cancelled.', 'error')
        },
        theme: { color: '#7c3aed' }
      });

      razorpay.open();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCheckingOut(null);
    }
  };

  const handlePayInvoice = async (invoice) => {
    setPayingInvoice(invoice.id);
    try {
      const checkout = await api.payPlatformInvoice(invoice.id);
      const details = checkout.data;

      if (details?.mockMode) {
        await api.verifyPlatformInvoicePayment({
          razorpay_order_id: details.order.id,
          razorpay_payment_id: `pay_mock_${details.order.id}`,
          razorpay_signature: 'mock_signature'
        });
        showToast('Platform bill paid successfully (Mock Mode).', 'success');
        loadInvoices();
        loadSubscriptionStatus();
        return;
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Unable to load Razorpay Checkout. Please check your network and try again.');
      }

      const razorpay = new window.Razorpay({
        key: details.keyId,
        amount: Math.round(parseFloat(details.amount) * 100),
        currency: 'INR',
        name: 'Ultrakey IT Solutions',
        description: `Platform Invoice #${details.invoiceNumber}`,
        order_id: details.order.id,
        prefill: {
          email: user?.email || details.adminEmail || ''
        },
        notes: {
          tenant_id: activeTenant?.id || '',
          invoice_id: invoice.id
        },
        handler: async (response) => {
          await api.verifyPlatformInvoicePayment(response);
          showToast('Platform bill paid successfully.', 'success');
          loadInvoices();
          loadSubscriptionStatus();
        },
        modal: {
          ondismiss: () => showToast('Payment was cancelled.', 'error')
        },
        theme: { color: '#7c3aed' }
      });

      razorpay.open();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setPayingInvoice(null);
    }
  };

  if (loading || loadingSubscription) {
    return (
      <div className="fade-in">
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '1rem' }}>Subscription</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Loading subscription details...</p>
      </div>
    );
  }

  if (viewingInvoice) {
    return (
      <div className="fade-in">
        <PlatformInvoiceVisualizer
          invoice={viewingInvoice}
          tenantName={activeTenant?.name || activeTenant?.domain || 'Tenant'}
          onClose={() => setViewingInvoice(null)}
          onPay={() => handlePayInvoice(viewingInvoice)}
          isPaying={payingInvoice === viewingInvoice.id}
          showPayButton={true}
        />
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          <CreditCard size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-secondary)' }} />
          Subscription Plans
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          {isActive
            ? 'You have an active subscription. View your plan details and billing history below.'
            : 'Choose a plan to activate your workspace and unlock all features.'}
        </p>
      </div>

      {/* Current Plan Status Bar */}
      {isActive && subscription && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '1.5rem',
            padding: '1rem 1.5rem', marginBottom: '2rem',
            background: 'rgba(16, 185, 129, 0.06)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            borderRadius: '12px'
          }}
        >
          <Zap size={20} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, color: 'var(--accent-success)' }}>Active — </span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{subscription.plan_name}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
              ₹{parseFloat(subscription.price_monthly || 0).toLocaleString('en-IN')}/mo
            </span>
          </div>
          {subscription.current_period_end && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <Clock size={14} />
              Renews {new Date(subscription.current_period_end).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {/* Pricing Grid */}
      {plans.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>No subscription plans are available yet. Contact your administrator.</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)`,
          gap: '1.5rem',
          maxWidth: plans.length === 1 ? '420px' : plans.length === 2 ? '780px' : '100%',
          marginBottom: '3rem'
        }}>
          {plans.map((plan) => {
            const features = plan.features?.filter(f => f.key) || [];
            const isCurrent = currentPlanId === plan.id && isActive;
            const isFeatured = plan.is_featured;

            return (
              <div
                key={plan.id}
                className="glass-card"
                style={{
                  padding: '2rem',
                  position: 'relative',
                  border: isCurrent
                    ? '2px solid var(--accent-success)'
                    : isFeatured
                      ? '2px solid var(--accent-secondary)'
                      : '1px solid var(--border-color)',
                  transform: isFeatured && !isCurrent ? 'scale(1.02)' : 'none',
                  boxShadow: isFeatured
                    ? '0 0 30px rgba(139, 92, 246, 0.15)'
                    : 'var(--box-shadow)',
                  transition: 'all 0.3s ease'
                }}
              >
                {/* Badge */}
                {(isCurrent || plan.badge_text || isFeatured) && (
                  <div style={{
                    position: 'absolute', top: '-1px', right: '1.5rem',
                    background: isCurrent
                      ? 'var(--accent-success)'
                      : 'var(--accent-secondary)',
                    color: '#fff',
                    padding: '0.25rem 0.75rem', borderRadius: '0 0 8px 8px',
                    fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    {isCurrent
                      ? <><Zap size={10} style={{ verticalAlign: 'middle' }} /> Current Plan</>
                      : plan.badge_text || '★ Popular'}
                  </div>
                )}

                {/* Plan Name + Description */}
                <h3 style={{
                  fontSize: '1.25rem', fontWeight: 700,
                  marginBottom: '0.35rem', marginTop: isCurrent || plan.badge_text || isFeatured ? '0.5rem' : 0
                }}>
                  {plan.name}
                </h3>
                {plan.description && (
                  <p style={{
                    color: 'var(--text-muted)', fontSize: '0.82rem',
                    marginBottom: '1.25rem', lineHeight: '1.4'
                  }}>
                    {plan.description}
                  </p>
                )}

                {/* Price */}
                <div style={{ marginBottom: '1.75rem' }}>
                  <span style={{
                    fontSize: '2.5rem', fontWeight: 800, fontFamily: 'var(--font-display)',
                    color: isCurrent
                      ? 'var(--accent-success)'
                      : isFeatured
                        ? 'var(--accent-secondary)'
                        : 'var(--accent-primary)'
                  }}>
                    ₹{parseFloat(plan.price_monthly || 0).toLocaleString('en-IN')}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> / month</span>
                  {plan.price_annually && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.25rem' }}>
                      or ₹{parseFloat(plan.price_annually).toLocaleString('en-IN')} / year
                      {plan.price_monthly && plan.price_annually && (
                        <span style={{ color: 'var(--accent-success)', marginLeft: '0.35rem', fontWeight: 600 }}>
                          Save {Math.round((1 - parseFloat(plan.price_annually) / (parseFloat(plan.price_monthly) * 12)) * 100)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Features List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '2rem' }}>
                  {features.map((f, fi) => {
                    const meta = FEATURE_META[f.key] || { label: f.key.replace(/_/g, ' '), icon: Check };
                    const Icon = meta.icon;
                    const isEnabled = f.key === 'custom_branding' ? f.limit >= 1 : true;

                    return (
                      <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        {isEnabled ? (
                          <Check size={14} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
                        ) : (
                          <X size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.5 }} />
                        )}
                        <Icon size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.6 }} />
                        <span style={{
                          fontSize: '0.85rem',
                          color: isEnabled ? 'var(--text-secondary)' : 'var(--text-muted)',
                          opacity: isEnabled ? 1 : 0.6
                        }}>
                          {f.key === 'custom_branding'
                            ? 'Custom Branding'
                            : f.limit === -1
                              ? <><strong>Unlimited</strong> {meta.label}</>
                              : <><strong>{f.limit}</strong> {meta.label}</>
                          }
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* CTA Button */}
                <button
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '0.85rem',
                    fontSize: '0.95rem',
                    backgroundColor: isCurrent
                      ? 'var(--accent-success)'
                      : isFeatured
                        ? 'var(--accent-secondary)'
                        : undefined,
                    borderColor: isCurrent
                      ? 'var(--accent-success)'
                      : isFeatured
                        ? 'var(--accent-secondary)'
                        : undefined,
                    boxShadow: isFeatured && !isCurrent
                      ? '0 0 20px rgba(139, 92, 246, 0.3)'
                      : undefined,
                    cursor: isCurrent ? 'default' : undefined
                  }}
                  onClick={() => handleCheckout(plan.id)}
                  disabled={checkingOut === plan.id || isCurrent}
                >
                  {checkingOut === plan.id
                    ? 'Processing...'
                    : isCurrent
                      ? <><Zap size={15} /> Active & Subscribed</>
                      : isActive
                        ? <><TrendingUp size={15} /> Switch Plan</>
                        : <><ArrowRight size={15} /> Subscribe Now</>
                  }
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Billing History */}
      <div style={{ marginTop: '1rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>Billing History</h2>
        
        {loadingInvoices ? (
          <p style={{ color: 'var(--text-secondary)' }}>Loading billing invoices...</p>
        ) : invoices.length === 0 ? (
          <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)' }}>No billing invoices recorded yet.</p>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-container" style={{ margin: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice Number</th>
                    <th>Plan</th>
                    <th>Billing Period</th>
                    <th>Due Date</th>
                    <th style={{ textAlign: 'right' }}>Tax (18%)</th>
                    <th style={{ textAlign: 'right' }}>Total Amount</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    let badgeColor = 'rgba(255,255,255,0.06)';
                    let textClr = 'var(--text-muted)';
                    if (inv.status === 'paid') {
                      badgeColor = 'rgba(16, 185, 129, 0.1)';
                      textClr = 'var(--accent-success)';
                    } else if (inv.status === 'pending') {
                      badgeColor = 'rgba(245, 158, 11, 0.1)';
                      textClr = 'var(--accent-warning)';
                    } else if (inv.status === 'overdue') {
                      badgeColor = 'rgba(239, 68, 68, 0.1)';
                      textClr = 'var(--accent-danger)';
                    } else if (inv.status === 'void') {
                      badgeColor = 'rgba(255, 255, 255, 0.05)';
                      textClr = 'var(--text-muted)';
                    }

                    return (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{inv.invoice_number}</td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{inv.plan_name || '—'}</td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {new Date(inv.billing_period_start).toLocaleDateString()} - {new Date(inv.billing_period_end).toLocaleDateString()}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {new Date(inv.due_date).toLocaleDateString()}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                          ₹{parseFloat(inv.tax_amount).toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#fff' }}>
                          ₹{parseFloat(inv.total_amount).toFixed(2)}
                        </td>
                        <td>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '4px', background: badgeColor, color: textClr, textTransform: 'uppercase' }}>
                            {inv.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', marginRight: '0.3rem', color: 'var(--accent-primary)' }}
                            onClick={() => setViewingInvoice(inv)}
                            title="View Bill"
                          >
                            <Eye size={15} />
                          </button>
                          {(inv.status === 'pending' || inv.status === 'overdue') && (
                            <button
                              className="btn btn-primary"
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                              onClick={() => handlePayInvoice(inv)}
                              disabled={payingInvoice === inv.id}
                            >
                              {payingInvoice === inv.id ? 'Paying...' : 'Pay Online'}
                            </button>
                          )}
                          {inv.status === 'paid' && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Paid on {inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : 'N/A'}
                            </span>
                          )}
                          {inv.status === 'void' && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Voided</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SubscriptionPage;
