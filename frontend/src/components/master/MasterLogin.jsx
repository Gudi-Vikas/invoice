import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Layers, LogIn, ShieldCheck } from 'lucide-react';
import ThemeToggle from '../ThemeToggle';

/**
 * MasterLogin — Separate login page for platform master admins.
 */
export const MasterLogin = () => {
  const { masterLogin } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await masterLogin(email, password);
      showToast('Master admin login successful.', 'success');
      navigate('/master/dashboard');
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-orb auth-bg-orb-1" style={{ background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)' }} />
      <div className="auth-bg-orb auth-bg-orb-2" style={{ background: 'radial-gradient(circle, rgba(239, 68, 68, 0.1) 0%, transparent 70%)' }} />

      {/* Theme Toggle Top Right */}
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', zIndex: 10 }}>
        <ThemeToggle />
      </div>

      <div className="auth-card glass-card fade-in">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '14px',
            background: 'linear-gradient(135deg, var(--accent-secondary) 0%, var(--accent-danger) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem', boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)'
          }}>
            <Layers size={28} color="#fff" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Platform Admin
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
            <ShieldCheck size={14} style={{ color: 'var(--accent-secondary)' }} />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Restricted access — Master admins only
            </p>
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px', padding: '0.75rem 1rem',
            color: 'var(--accent-danger)', fontSize: '0.85rem',
            marginBottom: '1.25rem', animation: 'shake 0.4s ease'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Admin Email</label>
            <input type="email" className="form-input" placeholder="admin@ultrakeyit.com"
              value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} required />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input type="password" className="form-input" placeholder="••••••••"
              value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}
            style={{
              width: '100%', padding: '0.85rem', marginTop: '0.5rem',
              fontSize: '1rem', opacity: submitting ? 0.7 : 1,
              background: 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))'
            }}
          >
            {submitting ? 'Authenticating...' : <><LogIn size={16} /> Sign In</>}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <button type="button" onClick={() => navigate('/login')}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>
            ← Tenant User Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default MasterLogin;
