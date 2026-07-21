import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ChevronDown, Plus, Building2, Check } from 'lucide-react';

/**
 * TenantSwitcher — Dropdown component for the Sidebar footer.
 * Shows active tenant name, allows switching between tenants,
 * and creating new workspaces.
 */
export const TenantSwitcher = () => {
  const { activeTenant, allTenants, switchTenant, createTenant } = useAuth();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantDomain, setNewTenantDomain] = useState('');
  const [newTenantEmail, setNewTenantEmail] = useState('');
  const [newTenantAddress, setNewTenantAddress] = useState('');
  const [newTenantWebsite, setNewTenantWebsite] = useState('');
  const [newTenantExtraInfo, setNewTenantExtraInfo] = useState('');
  const [switching, setSwitching] = useState(false);

  const handleSwitch = async (tenantId) => {
    if (tenantId === activeTenant?.id) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await switchTenant(tenantId);
      showToast('Workspace switched successfully.', 'success');
      setOpen(false);
      // Force reload to refresh all data contexts
      window.location.reload();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSwitching(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTenantName.trim()) return;

    try {
      await createTenant(newTenantName, newTenantDomain, {
        businessEmail: newTenantEmail,
        address: newTenantAddress,
        website: newTenantWebsite,
        extraInfo: newTenantExtraInfo
      });
      showToast('Workspace created! Switching context...', 'success');
      setShowCreateModal(false);
      setNewTenantName('');
      setNewTenantDomain('');
      setNewTenantEmail('');
      setNewTenantAddress('');
      setNewTenantWebsite('');
      setNewTenantExtraInfo('');
      window.location.reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  if (!activeTenant) return null;

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem',
          padding: '0.65rem 0.75rem', background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid var(--border-color)', borderRadius: '10px',
          cursor: 'pointer', color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)', fontSize: '0.82rem',
          transition: 'all 0.2s ease'
        }}
      >
        <Building2 size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeTenant.name}
        </span>
        <ChevronDown
          size={14}
          style={{
            color: 'var(--text-muted)', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, right: 0,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: '12px', boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden', zIndex: 200, animation: 'fadeIn 0.15s ease'
        }}>
          <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              Workspaces
            </span>
          </div>

          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {allTenants.map(t => (
              <button
                key={t.id}
                onClick={() => handleSwitch(t.id)}
                disabled={switching}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.65rem 0.75rem', background: 'none', border: 'none',
                  cursor: switching ? 'wait' : 'pointer',
                  color: t.id === activeTenant.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-body)', fontSize: '0.82rem',
                  textAlign: 'left', transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </span>
                {t.id === activeTenant.id && <Check size={14} style={{ color: 'var(--accent-success)' }} />}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.35rem' }}>
            <button
              onClick={() => { setShowCreateModal(true); setOpen(false); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.55rem 0.65rem', background: 'none', border: 'none',
                cursor: 'pointer', color: 'var(--accent-primary)',
                fontFamily: 'var(--font-body)', fontSize: '0.82rem',
                borderRadius: '8px', transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59,130,246,0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              <Plus size={14} /> Create New Workspace
            </button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '550px' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              Create New Workspace
            </h3>
            <form onSubmit={handleCreate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Workspace Name *</label>
                  <input
                    type="text" className="form-input"
                    placeholder="My New Business"
                    value={newTenantName}
                    onChange={(e) => setNewTenantName(e.target.value)}
                    required autoFocus
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Custom Domain</label>
                  <input
                    type="text" className="form-input"
                    placeholder="mybusiness.com (optional)"
                    value={newTenantDomain}
                    onChange={(e) => setNewTenantDomain(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Business Email</label>
                  <input
                    type="email" className="form-input"
                    placeholder="billing@mybusiness.com"
                    value={newTenantEmail}
                    onChange={(e) => setNewTenantEmail(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Website</label>
                  <input
                    type="text" className="form-input"
                    placeholder="https://..."
                    value={newTenantWebsite}
                    onChange={(e) => setNewTenantWebsite(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Business Address</label>
                <textarea
                  className="form-input" rows="2"
                  placeholder="Street, City, State, ZIP"
                  value={newTenantAddress}
                  onChange={(e) => setNewTenantAddress(e.target.value)}
                ></textarea>
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Tax ID / Extra Info</label>
                <input
                  type="text" className="form-input"
                  placeholder="GSTIN, Company Reg No, etc."
                  value={newTenantExtraInfo}
                  onChange={(e) => setNewTenantExtraInfo(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={15} /> Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantSwitcher;
