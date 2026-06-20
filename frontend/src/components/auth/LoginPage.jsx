import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Layers, LogIn, UserPlus, ArrowRight } from 'lucide-react';

/**
 * LoginPage — Full-screen glassmorphism login/signup page.
 * Two-tab toggle: Login | Sign Up.
 * After login: auto-redirects to /dashboard (or tenant picker if multi-tenant).
 */
export const LoginPage = () => {
  const { login, signup } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [formData, setFormData] = useState({
    email: '', password: '', name: '', domain: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await login(formData.email, formData.password);
        showToast('Login successful!', 'success');
      } else {
        if (!formData.name.trim()) {
          setError('Business/Tenant name is required.');
          setSubmitting(false);
          return;
        }
        await signup(formData.name, formData.domain, formData.email, formData.password);
        showToast('Account created! Welcome aboard.', 'success');
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Background Gradient Orbs */}
      <div className="auth-bg-orb auth-bg-orb-1" />
      <div className="auth-bg-orb auth-bg-orb-2" />

      <div className="auth-card glass-card fade-in">
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '14px',
            background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem', boxShadow: 'var(--glow-shadow)'
          }}>
            <Layers size={28} color="#fff" />
          </div>
          <h1 style={{
            fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-display)',
            background: 'linear-gradient(to right, #fff, var(--text-secondary))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            UltraKey
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Invoice & Billing SaaS Platform
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{
          display: 'flex', gap: '0.25rem', padding: '0.25rem',
          background: 'rgba(255, 255, 255, 0.04)', borderRadius: '10px',
          marginBottom: '1.75rem'
        }}>
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); }}
            className="auth-tab-btn"
            style={{
              flex: 1, padding: '0.65rem',
              background: mode === 'login' ? 'var(--accent-primary)' : 'transparent',
              color: mode === 'login' ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.9rem',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
            }}
          >
            <LogIn size={15} /> Login
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(''); }}
            className="auth-tab-btn"
            style={{
              flex: 1, padding: '0.65rem',
              background: mode === 'signup' ? 'var(--accent-primary)' : 'transparent',
              color: mode === 'signup' ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.9rem',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
            }}
          >
            <UserPlus size={15} /> Sign Up
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="auth-error" style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px', padding: '0.75rem 1rem',
            color: 'hsl(350, 89%, 75%)', fontSize: '0.85rem',
            marginBottom: '1.25rem', animation: 'shake 0.4s ease'
          }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <>
              <div className="form-group">
                <label className="form-label">Business Name *</label>
                <input
                  type="text"
                  name="name"
                  className="form-input"
                  placeholder="Ultrakey IT Solutions"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  autoComplete="organization"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Domain (optional)</label>
                <input
                  type="text"
                  name="domain"
                  className="form-input"
                  placeholder="ultrakeyit.com"
                  value={formData.domain}
                  onChange={handleChange}
                  autoComplete="url"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Email Address *</label>
            <input
              type="email"
              name="email"
              className="form-input"
              placeholder="admin@yourcompany.com"
              value={formData.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password *</label>
            <input
              type="password"
              name="password"
              className="form-input"
              placeholder="••••••••"
              value={formData.password}
              onChange={handleChange}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{
              width: '100%', padding: '0.85rem', marginTop: '0.5rem',
              fontSize: '1rem', opacity: submitting ? 0.7 : 1
            }}
          >
            {submitting
              ? 'Please wait...'
              : mode === 'login'
                ? <><LogIn size={16} /> Sign In</>
                : <><UserPlus size={16} /> Create Account</>
            }
          </button>
        </form>

        {/* Footer Links */}
        <div style={{
          marginTop: '1.75rem', textAlign: 'center',
          borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem'
        }}>
          <button
            type="button"
            onClick={() => navigate('/join')}
            style={{
              background: 'none', border: 'none',
              color: 'var(--accent-primary)', cursor: 'pointer',
              fontSize: '0.85rem', fontFamily: 'var(--font-body)',
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem'
            }}
          >
            Have an invite? Join a workspace <ArrowRight size={14} />
          </button>
        </div>

        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => navigate('/master/login')}
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: '0.75rem', fontFamily: 'var(--font-body)'
            }}
          >
            Platform Admin Login →
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
