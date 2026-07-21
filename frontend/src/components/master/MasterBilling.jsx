/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  Receipt, Plus, DollarSign, XCircle, CheckCircle, Eye
} from 'lucide-react';

/**
 * MasterBilling — Platform billing invoice management.
 * Generate, list, mark-paid, void billing invoices.
 */
export const MasterBilling = () => {
  const { showToast } = useToast();

  const [invoices, setInvoices] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [nextCursor, setNextCursor] = useState(null);

  // Generate form state
  const [genForm, setGenForm] = useState({
    tenantId: '', billingPeriodStart: '', billingPeriodEnd: '',
    dueDate: '', amountOverride: '', notes: ''
  });

  const loadTenants = useCallback(async () => {
    try {
      const data = await api.masterListTenants({ limit: 100 });
      setTenants(data.tenants || []);
    } catch {
      showToast('Failed to load tenant choices.', 'error');
    }
  }, [showToast]);

  const loadInvoices = useCallback(async (cursor) => {
    setLoading(true);
    try {
      const params = { limit: 20 };
      if (statusFilter) params.status = statusFilter;
      if (cursor) params.cursor = cursor;

      const data = await api.masterListBilling(params);
      if (cursor) {
        setInvoices(prev => [...prev, ...(data.invoices || [])]);
      } else {
        setInvoices(data.invoices || []);
      }
      setNextCursor(data.pagination?.nextCursor || null);
    } catch {
      showToast('Failed to load billing invoices.', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);
  useEffect(() => { loadTenants(); }, [loadTenants]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...genForm };
      if (payload.amountOverride === '') delete payload.amountOverride;
      else payload.amountOverride = parseFloat(payload.amountOverride);

      const data = await api.masterGenerateBilling(payload);
      showToast(data.message, 'success');
      setShowGenerate(false);
      setGenForm({ tenantId: '', billingPeriodStart: '', billingPeriodEnd: '', dueDate: '', amountOverride: '', notes: '' });
      loadInvoices();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleMarkPaid = async (id) => {
    try {
      const data = await api.masterMarkPaid(id);
      showToast(data.message, 'success');
      loadInvoices();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleVoid = async (id) => {
    const reason = prompt('Reason for voiding this invoice (optional):');
    try {
      const data = await api.masterVoidInvoice(id, reason || '');
      showToast(data.message, 'success');
      loadInvoices();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const viewDetail = async (id) => {
    try {
      const data = await api.masterGetBilling(id);
      setShowDetail(data.invoice);
    } catch (err) { showToast(err.message, 'error'); }
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            <Receipt size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
            Platform Billing
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Generate and manage billing invoices for tenants.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>
          <Plus size={16} /> Generate Invoice
        </button>
      </div>

      {/* Status Filter */}
      <div style={{ marginBottom: '1.25rem' }}>
        <select className="form-select" value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setNextCursor(null); }}
          style={{ width: '200px' }}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="void">Void</option>
        </select>
      </div>

      {/* Invoice Table */}
      <div className="billing-card" style={{ padding: 0 }}>
        {loading && invoices.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>Loading...</p>
        ) : invoices.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>No billing invoices found.</p>
        ) : (
          <div className="table-container" style={{ margin: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Tenant</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Tax</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{inv.invoice_number}</td>
                    <td>{inv.tenant_name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{inv.plan_name || '—'}</td>
                    <td>₹{parseFloat(inv.amount || 0).toFixed(2)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>₹{parseFloat(inv.tax_amount || 0).toFixed(2)}</td>
                    <td style={{ fontWeight: 600 }}>₹{parseFloat(inv.total_amount || 0).toFixed(2)}</td>
                    <td>
                      <span className={`badge badge-${inv.status === 'paid' ? 'paid' : inv.status === 'overdue' ? 'overdue' : inv.status === 'void' ? 'voided' : 'draft'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                        <button title="View" onClick={() => viewDetail(inv.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '0.25rem' }}>
                          <Eye size={15} />
                        </button>
                        {inv.status === 'pending' || inv.status === 'overdue' ? (
                          <>
                            <button title="Mark Paid" onClick={() => handleMarkPaid(inv.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent-success)', cursor: 'pointer', padding: '0.25rem' }}>
                              <CheckCircle size={15} />
                            </button>
                            <button title="Void" onClick={() => handleVoid(inv.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', padding: '0.25rem' }}>
                              <XCircle size={15} />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Load More */}
      {nextCursor && (
        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <button className="btn btn-secondary" onClick={() => loadInvoices(nextCursor)}>
            Load More
          </button>
        </div>
      )}

      {/* Generate Modal */}
      {showGenerate && (
        <div className="modal-overlay">
          <div className="billing-card modal-card" style={{ '--modal-width': '520px' }}>
            <h3 style={{ marginBottom: '1.25rem' }}><Plus size={16} style={{ verticalAlign: 'middle' }} /> Generate Billing Invoice</h3>
            <form onSubmit={handleGenerate}>
              <div className="form-group">
                <label className="form-label">Tenant *</label>
                <select className="form-select" required
                  value={genForm.tenantId} onChange={e => setGenForm(p => ({ ...p, tenantId: e.target.value }))}>
                  <option value="">Select tenant</option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}{tenant.domain ? ` (${tenant.domain})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Period Start *</label>
                  <input type="date" className="form-input" required
                    value={genForm.billingPeriodStart} onChange={e => setGenForm(p => ({ ...p, billingPeriodStart: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Period End *</label>
                  <input type="date" className="form-input" required
                    value={genForm.billingPeriodEnd} onChange={e => setGenForm(p => ({ ...p, billingPeriodEnd: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Due Date *</label>
                <input type="date" className="form-input" required
                  value={genForm.dueDate} onChange={e => setGenForm(p => ({ ...p, dueDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Amount Override (optional)</label>
                <input type="number" className="form-input" placeholder="Auto from plan if blank"
                  value={genForm.amountOverride} onChange={e => setGenForm(p => ({ ...p, amountOverride: e.target.value }))} step="0.01" />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" rows={2} placeholder="Optional notes"
                  value={genForm.notes} onChange={e => setGenForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowGenerate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary"><DollarSign size={14} /> Generate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <div className="modal-overlay">
          <div className="billing-card modal-card" style={{ '--modal-width': '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3>{showDetail.invoice_number}</h3>
              <button onClick={() => setShowDetail(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <XCircle size={18} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {[
                ['Tenant', showDetail.tenant_name],
                ['Plan', showDetail.plan_name || '—'],
                ['Amount', `₹${parseFloat(showDetail.amount || 0).toFixed(2)}`],
                ['Tax', `₹${parseFloat(showDetail.tax_amount || 0).toFixed(2)} (${showDetail.tax_percentage}%)`],
                ['Total', `₹${parseFloat(showDetail.total_amount || 0).toFixed(2)}`],
                ['Status', showDetail.status],
                ['Due', showDetail.due_date ? new Date(showDetail.due_date).toLocaleDateString() : '—'],
                ['Paid', showDetail.paid_at ? new Date(showDetail.paid_at).toLocaleString() : '—'],
                ['Created', new Date(showDetail.created_at).toLocaleString()],
                ['Created By', showDetail.created_by_email || '—']
              ].map(([label, value], i) => (
                <div key={i}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                  <p style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.1rem' }}>{value}</p>
                </div>
              ))}
            </div>
            {showDetail.notes && (
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Notes</span>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{showDetail.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterBilling;
