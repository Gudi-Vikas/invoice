import React, { useState, useEffect } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { CreditCard, Check, Zap, ArrowRight } from 'lucide-react';

/**
 * SubscriptionPage — Shows available SaaS plans and handles checkout flow.
 */
export const SubscriptionPage = () => {
  const { showToast } = useToast();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(null);

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    try {
      const data = await api.getPlans();
      setPlans(data || []);
    } catch (err) {
      showToast('Failed to load subscription plans.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async (planId) => {
    setCheckingOut(planId);
    try {
      const data = await api.checkout(planId);
      showToast(`Subscription activated: ${data.data?.planName || 'Plan'}`, 'success');
      loadPlans();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCheckingOut(null);
    }
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
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          <CreditCard size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
          Subscription Plans
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Choose a plan that fits your business needs. Upgrade or downgrade anytime.
        </p>
      </div>

      {plans.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>No subscription plans configured yet.</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1.5rem'
        }}>
          {plans.map((plan, idx) => {
            const features = plan.features?.filter(f => f.key) || [];
            const isPopular = idx === 1;

            return (
              <div
                key={plan.id}
                className="glass-card"
                style={{
                  padding: '2rem',
                  border: isPopular ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  position: 'relative',
                  transition: 'transform 0.2s ease, border-color 0.2s ease'
                }}
              >
                {isPopular && (
                  <div style={{
                    position: 'absolute', top: '-1px', right: '1.5rem',
                    background: 'var(--accent-primary)', color: '#fff',
                    padding: '0.25rem 0.75rem', borderRadius: '0 0 8px 8px',
                    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    <Zap size={10} style={{ verticalAlign: 'middle' }} /> Popular
                  </div>
                )}

                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  {plan.name}
                </h3>
                <div style={{ marginBottom: '1.5rem' }}>
                  <span style={{
                    fontSize: '2.5rem', fontWeight: 800, fontFamily: 'var(--font-display)',
                    color: isPopular ? 'var(--accent-primary)' : 'var(--text-primary)'
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
                        {f.key.replace(/_/g, ' ')} — {f.limit === -1 ? 'Unlimited' : f.limit}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  className={isPopular ? 'btn btn-primary' : 'btn btn-secondary'}
                  style={{ width: '100%' }}
                  onClick={() => handleCheckout(plan.id)}
                  disabled={checkingOut === plan.id}
                >
                  {checkingOut === plan.id
                    ? 'Processing...'
                    : <><ArrowRight size={15} /> Choose Plan</>
                  }
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SubscriptionPage;
