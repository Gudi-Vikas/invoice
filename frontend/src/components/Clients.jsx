/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import {
  Users, UserPlus, FileText, Edit2, X, Check, Search, ChevronLeft, ChevronRight,
  Mail, MapPin
} from 'lucide-react';

/**
 * Clients Management Page.
 * Full CRUD for client contacts: list with search + pagination, add modal, edit panel.
 */
export const Clients = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Add client modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '', email: '', street: '', city: '', state: '', zip: '', country: 'India', extraInfo: ''
  });
  const [addError, setAddError] = useState('');

  // Edit client panel state
  const [editingClient, setEditingClient] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState('');

  // Feedback
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const [saving, setSaving] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getClients({ page, limit: 15, search: debouncedSearch });
      setClients(data.clients || []);
      setTotalPages(data.totalPages || 1);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      showToast('Failed to load clients: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, showToast]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const showFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback({ type: '', message: '' }), 4000);
  };

  // ─── ADD CLIENT ──────────────────────────────────────────────────────────────
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!addForm.name || !addForm.email || saving) return;

    setSaving(true);
    setAddError('');
    try {
      await api.createClient({
        name: addForm.name,
        email: addForm.email,
        billingAddress: { street: addForm.street, city: addForm.city, state: addForm.state, zip: addForm.zip, country: addForm.country },
        extraInfo: addForm.extraInfo || null
      });
      setShowAddModal(false);
      setAddForm({ name: '', email: '', street: '', city: '', state: '', zip: '', country: 'India', extraInfo: '' });
      showFeedback('success', 'Client registered successfully.');
      loadClients();
    } catch (err) {
      setAddError(err.message || 'Failed to register client.');
    } finally {
      setSaving(false);
    }
  };

  // ─── EDIT CLIENT ─────────────────────────────────────────────────────────────
  const openEdit = (client) => {
    setEditingClient(client);
    setEditError('');
    setEditForm({
      name: client.name,
      email: client.email,
      street: client.billing_address?.street || '',
      city: client.billing_address?.city || '',
      state: client.billing_address?.state || '',
      zip: client.billing_address?.zip || '',
      country: client.billing_address?.country || 'India',
      extraInfo: client.extra_info || ''
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingClient || saving) return;

    setSaving(true);
    setEditError('');
    try {
      await api.updateClient(editingClient.id, {
        name: editForm.name,
        email: editForm.email,
        billingAddress: { street: editForm.street, city: editForm.city, state: editForm.state, zip: editForm.zip, country: editForm.country },
        extraInfo: editForm.extraInfo || null
      });
      setEditingClient(null);
      showFeedback('success', 'Client updated successfully.');
      loadClients();
    } catch (err) {
      setEditError(err.message || 'Failed to update client.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Client Contacts</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Manage your billable clients — {totalCount} total registered contacts.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <UserPlus size={16} /> Add Client
        </button>
      </div>

      {/* Feedback */}
      {feedback.message && (
        <div className="info-alert" style={{
          backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          borderColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
          marginBottom: '1.5rem'
        }}>
          <Check size={18} style={{ color: feedback.type === 'success' ? 'var(--accent-success)' : 'var(--accent-danger)' }} />
          <span className="info-alert-text" style={{ color: feedback.type === 'success' ? 'hsl(142, 72%, 85%)' : 'hsl(350, 89%, 85%)' }}>
            {feedback.message}
          </span>
        </div>
      )}

      {/* Search + Filter Bar */}
      <div className="glass-card" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
          Page {page} of {totalPages}
        </span>
      </div>

      {/* Clients Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '3rem' }}>Loading client contacts...</p>
        ) : clients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            <Users size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
            <p style={{ fontSize: '1.1rem' }}>{debouncedSearch ? 'No clients match your search.' : 'No clients registered yet.'}</p>
            {!debouncedSearch && (
              <button className="btn btn-primary" style={{ marginTop: '1.5rem' }} onClick={() => setShowAddModal(true)}>
                <UserPlus size={16} /> Register First Client
              </button>
            )}
          </div>
        ) : (
          <div className="table-container" style={{ margin: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th>Email Address</th>
                  <th>Location</th>
                  <th>Registered</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(client => (
                  <tr key={client.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                          width: '38px', height: '38px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '1rem', fontWeight: 700, color: '#fff', flexShrink: 0
                        }}>
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span style={{ fontWeight: 600 }}>{client.name}</span>
                          {client.extra_info && (
                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {client.extra_info.replace(/<[^>]+>/g, '').substring(0, 40)}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                        <Mail size={13} />
                        {client.email}
                      </div>
                    </td>
                    <td>
                      {client.billing_address?.city ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                          <MapPin size={13} />
                          {client.billing_address.city}{client.billing_address.state ? `, ${client.billing_address.state}` : ''}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {new Date(client.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => openEdit(client)}
                          title="Edit client"
                        >
                          <Edit2 size={13} /> Edit
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => navigate(`/invoices?client=${client.id}`)}
                          title="View invoices for this client"
                        >
                          <FileText size={13} /> Invoices
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => navigate(`/quotes?client=${client.id}`)}
                          title="View quotations for this client"
                        >
                          <FileText size={13} /> Quotations
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            gap: '0.5rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)'
          }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {page} / {totalPages}
            </span>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>


      {/* ==================== ADD CLIENT MODAL ==================== */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Register New Client</h3>
              <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={() => setShowAddModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit}>
              {addError && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px', padding: '0.75rem 1rem', color: 'hsl(350, 89%, 75%)',
                  fontSize: '0.85rem', marginBottom: '1.25rem'
                }}>
                  {addError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Client / Business Name *</label>
                  <input type="text" className="form-input" value={addForm.name}
                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Acme Pvt Ltd" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address *</label>
                  <input type="email" className="form-input" value={addForm.email}
                    onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="billing@company.com" required />
                </div>
              </div>

              <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>
                Billing Address
              </h4>

              <div className="form-group">
                <label className="form-label">Street Address</label>
                <input type="text" className="form-input" value={addForm.street}
                  onChange={e => setAddForm(f => ({ ...f, street: e.target.value }))}
                  placeholder="123 MG Road" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input type="text" className="form-input" value={addForm.city}
                    onChange={e => setAddForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="Hyderabad" />
                </div>
                <div className="form-group">
                  <label className="form-label">State</label>
                  <input type="text" className="form-input" value={addForm.state}
                    onChange={e => setAddForm(f => ({ ...f, state: e.target.value }))}
                    placeholder="Telangana" />
                </div>
                <div className="form-group">
                  <label className="form-label">PIN / ZIP</label>
                  <input type="text" className="form-input" value={addForm.zip}
                    onChange={e => setAddForm(f => ({ ...f, zip: e.target.value }))}
                    placeholder="500032" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Extra Info (GST / PAN / Notes)</label>
                <textarea className="form-textarea" style={{ height: '70px' }} value={addForm.extraInfo}
                  onChange={e => setAddForm(f => ({ ...f, extraInfo: e.target.value }))}
                  placeholder="GSTIN: 36AADCU5062A1ZO" />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Appears on the invoice header. HTML tags are supported.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving} style={{ opacity: saving ? 0.7 : 1 }}>
                  <UserPlus size={16} /> {saving ? 'Creating...' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* ==================== EDIT CLIENT PANEL ==================== */}
      {editingClient && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Edit Client</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>ID: {editingClient.id}</p>
              </div>
              <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={() => setEditingClient(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              {editError && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px', padding: '0.75rem 1rem', color: 'hsl(350, 89%, 75%)',
                  fontSize: '0.85rem', marginBottom: '1.25rem'
                }}>
                  {editError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Client Name *</label>
                  <input type="text" className="form-input" value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address *</label>
                  <input type="email" className="form-input" value={editForm.email}
                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} required />
                </div>
              </div>

              <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>
                Billing Address
              </h4>

              <div className="form-group">
                <label className="form-label">Street</label>
                <input type="text" className="form-input" value={editForm.street}
                  onChange={e => setEditForm(f => ({ ...f, street: e.target.value }))} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input type="text" className="form-input" value={editForm.city}
                    onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">State</label>
                  <input type="text" className="form-input" value={editForm.state}
                    onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">PIN / ZIP</label>
                  <input type="text" className="form-input" value={editForm.zip}
                    onChange={e => setEditForm(f => ({ ...f, zip: e.target.value }))} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Extra Info</label>
                <textarea className="form-textarea" style={{ height: '70px' }} value={editForm.extraInfo}
                  onChange={e => setEditForm(f => ({ ...f, extraInfo: e.target.value }))} />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingClient(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving} style={{ opacity: saving ? 0.7 : 1 }}>
                  <Check size={16} /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Clients;
