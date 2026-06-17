import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Layers, UserCheck } from 'lucide-react';

/**
 * JoinPage — Invite redemption page.
 * Accessed via /join?token=<uuid>.
 * User must provide a password (new or existing account).
 */
export const JoinPage = () => {
  const { joinWorkspace } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [inviteToken, setInviteToken] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const tokenFromUrl = searchParams.get('token');
    if (tokenFromUrl) setInviteToken(tokenFromUrl);
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!inviteToken.trim()) {
      setError('Invite token is required. Check your invite link.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await joinWorkspace(inviteToken, password);
      showToast(data.message || 'Successfully joined the workspace!', 'success');
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
            fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--font-display)',
            color: 'var(--text-primary)'
          }}>
            Join Workspace
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
            You've been invited to collaborate. Enter your password to continue.
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px', padding: '0.75rem 1rem',
            color: 'hsl(350, 89%, 75%)', fontSize: '0.85rem',
            marginBottom: '1.25rem', animation: 'shake 0.4s ease'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Invite Token</label>
            <input
              type="text"
              className="form-input"
              placeholder="Paste your invite token"
              value={inviteToken}
              onChange={(e) => { setInviteToken(e.target.value); setError(''); }}
              required
              style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password *</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
              minLength={8}
              autoComplete="current-password"
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'block' }}>
              If you already have an account, enter your existing password. New users: choose a password (min. 8 characters).
            </span>
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
            {submitting ? 'Joining...' : <><UserCheck size={16} /> Join Workspace</>}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: '0.85rem', fontFamily: 'var(--font-body)'
            }}
          >
            ← Back to Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default JoinPage;
