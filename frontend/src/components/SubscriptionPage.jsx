/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { CreditCard, Check, Zap, ArrowRight } from 'lucide-react';

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

/**
 * SubscriptionPage — Starter-only paid activation flow.
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

  const [isActive, setIsActive] = useState(false);
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
      setIsActive(!!data?.isActive);
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
        showToast('Starter subscription activated in mock payment mode.', 'success');
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
        description: `${details.planName} subscription`,
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
          showToast('Starter subscription activated.', 'success');
          loadPlans();
          loadSubscriptionStatus();
        },
        modal: {
          ondismiss: () => showToast('Payment was cancelled.', 'error')
        },
        theme: { color: '#3b82f6' }
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
        theme: { color: '#3b82f6' }
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

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          <CreditCard size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
          Subscription
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Starter is the only active plan right now. Payment is required before using the app.
        </p>
      </div>

      {plans.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>Starter plan is not configured yet.</p>
        </div>
      ) : (
        <div style={{ maxWidth: '420px' }}>
          {plans.map((plan) => {
            const features = plan.features?.filter(f => f.key) || [];

            return (
              <div
                key={plan.id}
                className="glass-card"
                style={{
                  padding: '2rem',
                  border: isActive ? '2px solid var(--accent-success)' : '2px solid var(--accent-primary)',
                  position: 'relative'
                }}
              >
                {isActive ? (
                  <div style={{
                    position: 'absolute', top: '-1px', right: '1.5rem',
                    background: 'var(--accent-success)', color: '#fff',
                    padding: '0.25rem 0.75rem', borderRadius: '0 0 8px 8px',
                    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    <Zap size={10} style={{ verticalAlign: 'middle' }} /> Subscribed
                  </div>
                ) : (
                  <div style={{
                    position: 'absolute', top: '-1px', right: '1.5rem',
                    background: 'var(--text-muted)', color: '#fff',
                    padding: '0.25rem 0.75rem', borderRadius: '0 0 8px 8px',
                    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Available
                  </div>
                )}

                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  {plan.name}
                </h3>
                <div style={{ marginBottom: '1.5rem' }}>
                  <span style={{
                    fontSize: '2.5rem', fontWeight: 800, fontFamily: 'var(--font-display)',
                    color: isActive ? 'var(--accent-success)' : 'var(--accent-primary)'
                  }}>
                    ₹{parseFloat(plan.price_monthly || 0).toLocaleString('en-IN')}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> / month</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.75rem' }}>
                  {features.map((f, fi) => (
                    <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Check size={14} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {f.key.replace(/_/g, ' ')} - {f.limit === -1 ? 'Unlimited' : f.limit}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    backgroundColor: isActive ? 'var(--accent-success)' : undefined,
                    borderColor: isActive ? 'var(--accent-success)' : undefined,
                    color: isActive ? '#fff' : undefined,
                    cursor: isActive ? 'default' : undefined
                  }}
                  onClick={() => handleCheckout(plan.id)}
                  disabled={checkingOut === plan.id || isActive}
                >
                  {checkingOut === plan.id
                    ? 'Processing...'
                    : isActive
                      ? 'Subscribed & Active'
                      : <><ArrowRight size={15} /> Pay & Activate Starter</>
                  }
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Platform Invoices History */}
      <div style={{ marginTop: '3rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>SaaS Billing History</h2>
        
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
                          {(inv.status === 'pending' || inv.status === 'overdue') && (
                            <button
                              className="btn btn-primary"
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                              onClick={() => handlePayInvoice(inv)}
                              disabled={payingInvoice === inv.id || isActive}
                              title={isActive ? 'Workspace already has an active subscription' : undefined}
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
