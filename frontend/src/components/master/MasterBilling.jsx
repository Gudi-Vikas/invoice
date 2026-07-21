/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import { useToast } from '../../context/ToastContext';
import {
  Receipt, Plus, DollarSign, XCircle, CheckCircle, Eye, ArrowLeft
} from 'lucide-react';
import PlatformInvoiceVisualizer from '../shared/PlatformInvoiceVisualizer';

/**
 * MasterBilling — Platform billing invoice management.
 * Generate, list, mark-paid, void billing invoices.
 */
export const MasterBilling = () => {
  const { showToast } = useToast();

  const [view, setView] = useState('list'); // list | create | details
  
  const [invoices, setInvoices] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  
  const [statusFilter, setStatusFilter] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(null);

  // Modals
  const [showVoidModal, setShowVoidModal] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  
  const [showMarkPaidModal, setShowMarkPaidModal] = useState(null);
  const [markPaidRef, setMarkPaidRef] = useState('');

  // Generate form state
  const [genForm, setGenForm] = useState({
    tenantId: '', billingPeriodStart: '', billingPeriodEnd: '',
    dueDate: '', amountOverride: '', notes: '', applyGst: true
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
    if (generating) return;
    setGenerating(true);
    try {
      const payload = { ...genForm };
      if (payload.amountOverride === '') delete payload.amountOverride;
      else payload.amountOverride = parseFloat(payload.amountOverride);

      payload.taxPercentage = payload.applyGst ? 18 : 0;
      delete payload.applyGst;

      const data = await api.masterGenerateBilling(payload);
      showToast(data.message, 'success');
      setView('list');
      setGenForm({ tenantId: '', billingPeriodStart: '', billingPeriodEnd: '', dueDate: '', amountOverride: '', notes: '', applyGst: true });
      loadInvoices();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const confirmMarkPaid = async (e) => {
    e.preventDefault();
    if (actionInProgress) return;
    const id = showMarkPaidModal.id;
    setActionInProgress(id);
    try {
      const data = await api.masterMarkPaid(id, { razorpayPaymentId: markPaidRef || undefined });
      showToast(data.message, 'success');
      setShowMarkPaidModal(null);
      setMarkPaidRef('');
      loadInvoices();
    } catch (err) { 
      showToast(err.message, 'error'); 
    } finally { 
      setActionInProgress(null); 
    }
  };

  const confirmVoid = async (e) => {
    e.preventDefault();
    if (actionInProgress) return;
    const id = showVoidModal.id;
    setActionInProgress(id);
    try {
      const data = await api.masterVoidInvoice(id, voidReason || '');
      showToast(data.message, 'success');
      setShowVoidModal(null);
      setVoidReason('');
      loadInvoices();
    } catch (err) { 
      showToast(err.message, 'error'); 
    } finally { 
      setActionInProgress(null); 
    }
  };

  const viewDetail = async (inv) => {
    try {
      const data = await api.masterGetBilling(inv.id);
      setSelectedInvoice(data.invoice);
      setView('details');
    } catch (err) { 
      showToast(err.message, 'error'); 
    }
  };

  return (
    <div className="fade-in">
      {/* ----------------- LIST VIEW ----------------- */}
      {view === 'list' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                <Receipt size={28} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--accent-primary)' }} />
                Platform Billing
              </h1>
              <p style={{ color: 'var(--text-secondary)' }}>Generate and manage billing invoices for tenants.</p>
            </div>
            <button className="btn btn-primary" onClick={() => setView('create')}>
              <Plus size={16} /> Generate Invoice
            </button>
          </div>

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
                            <button title="View" onClick={() => viewDetail(inv)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '0.25rem' }}>
                              <Eye size={15} />
                            </button>
                            {inv.status === 'pending' || inv.status === 'overdue' ? (
                              <>
                                <button title="Mark Paid" onClick={() => setShowMarkPaidModal(inv)}
                                  disabled={actionInProgress === inv.id}
                                  style={{ background: 'none', border: 'none', color: 'var(--accent-success)', cursor: 'pointer', padding: '0.25rem' }}>
                                  <CheckCircle size={15} />
                                </button>
                                <button title="Void" onClick={() => setShowVoidModal(inv)}
                                  disabled={actionInProgress === inv.id}
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

          {nextCursor && (
            <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
              <button className="btn btn-secondary" onClick={() => loadInvoices(nextCursor)}>
                Load More
              </button>
            </div>
          )}
        </>
      )}

      {/* ----------------- CREATE VIEW ----------------- */}
      {view === 'create' && (
        <div className="fade-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
            <button className="btn btn-secondary" onClick={() => setView('list')}><ArrowLeft size={16} /> Back</button>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Generate Billing Invoice</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Create a new platform subscription invoice for a tenant.</p>
            </div>
          </div>

          <div className="glass-card" style={{ maxWidth: '700px' }}>
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
                <label className="form-label">Amount Override (pre-tax, optional)</label>
                <input type="number" className="form-input" placeholder="Auto from active plan if left blank"
                  value={genForm.amountOverride} onChange={e => setGenForm(p => ({ ...p, amountOverride: e.target.value }))} step="0.01" />
              </div>
              
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <input 
                  type="checkbox" 
                  id="applyGst" 
                  checked={genForm.applyGst} 
                  onChange={e => setGenForm(p => ({ ...p, applyGst: e.target.checked }))} 
                  style={{ width: '1.1rem', height: '1.1rem', accentColor: 'var(--accent-primary)', cursor: 'pointer', margin: 0 }}
                />
                <label htmlFor="applyGst" style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>Apply 18% GST to this invoice</label>
              </div>

              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <textarea className="form-textarea" rows={3} placeholder="Additional details or terms to show on the invoice"
                  value={genForm.notes} onChange={e => setGenForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setView('list')}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={generating} style={{ opacity: generating ? 0.7 : 1 }}>
                  {generating ? 'Generating...' : <><DollarSign size={14} /> Generate Invoice</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------- DETAILS VIEW (PDF) ----------------- */}
      {view === 'details' && selectedInvoice && (
        <PlatformInvoiceVisualizer 
          invoice={selectedInvoice} 
          tenantName={selectedInvoice.tenant_name || selectedInvoice.tenant_domain} 
          onClose={() => setView('list')}
        />
      )}

      {/* ----------------- MODALS ----------------- */}
      {showMarkPaidModal && (
        <div className="modal-overlay">
          <div className="billing-card modal-card" style={{ '--modal-width': '480px' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle size={20} /> Mark Invoice as Paid
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Are you sure you want to mark invoice <strong>{showMarkPaidModal.invoice_number}</strong> for <strong>{showMarkPaidModal.tenant_name}</strong> as paid?
            </p>
            <form onSubmit={confirmMarkPaid}>
              <div className="form-group">
                <label className="form-label">Payment Reference / Razorpay ID (Optional)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. pay_XXXXX or Bank Ref"
                  value={markPaidRef} 
                  onChange={e => setMarkPaidRef(e.target.value)} 
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowMarkPaidModal(null); setMarkPaidRef(''); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={actionInProgress === showMarkPaidModal.id} style={{ backgroundColor: 'var(--accent-success)', borderColor: 'var(--accent-success)' }}>
                  {actionInProgress === showMarkPaidModal.id ? 'Saving...' : 'Confirm Paid'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVoidModal && (
        <div className="modal-overlay">
          <div className="billing-card modal-card" style={{ '--modal-width': '480px' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <XCircle size={20} /> Void Invoice
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Voiding invoice <strong>{showVoidModal.invoice_number}</strong> will cancel it permanently.
            </p>
            <form onSubmit={confirmVoid}>
              <div className="form-group">
                <label className="form-label">Reason for Voiding (Optional)</label>
                <textarea 
                  className="form-textarea" 
                  placeholder="Explain why this invoice is being voided..."
                  rows={2}
                  value={voidReason} 
                  onChange={e => setVoidReason(e.target.value)} 
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowVoidModal(null); setVoidReason(''); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={actionInProgress === showVoidModal.id} style={{ backgroundColor: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }}>
                  {actionInProgress === showVoidModal.id ? 'Voiding...' : 'Confirm Void'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterBilling;
