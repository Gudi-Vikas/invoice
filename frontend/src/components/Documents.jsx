import React, { useState, useEffect } from 'react';
import api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import {
  FileText, Plus, Trash2, ArrowLeft, FilePlus, Copy, Check,
  UserPlus, Printer, ChevronLeft, ChevronRight, Minus, Tag
} from 'lucide-react';

/**
 * Documents Module (Quotes & Invoices Manager).
 * Contains list, builder form with real-time tax math, and PDF invoice visualizer.
 * Uses SettingsContext — no redundant getSettings() calls.
 */
export const Documents = ({ initialView = 'list' }) => {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [view, setView] = useState(initialView);
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [docDetails, setDocDetails] = useState(null);

  // Filtering and pagination
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Magic link copy
  const [copiedId, setCopiedId] = useState(null);

  // Quick client registration modal
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');

  // Form states
  const [formType, setFormType] = useState('invoice');
  const [formClientId, setFormClientId] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formLines, setFormLines] = useState([{ description: '', quantity: 1, unitPrice: 0, adjust: 0, vendorId: '' }]);
  const [formStatus, setFormStatus] = useState('draft');

  // Status update tracking
  const [updatingStatus, setUpdatingStatus] = useState(null);

  useEffect(() => {
    loadMetadata();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filterType, filterStatus]);

  useEffect(() => {
    loadDocuments();
  }, [filterType, filterStatus, page]);

  const loadMetadata = async () => {
    try {
      const clientData = await api.getClients();
      setClients(clientData.clients || []);
      const vendorData = await api.getVendors();
      setVendors(vendorData || []);
    } catch (err) {
      showToast('Failed to load form config values: ' + err.message, 'error');
    }
  };

  const loadDocuments = async () => {
    try {
      const params = { page, limit: 10 };
      if (filterType !== 'all') params.type = filterType;
      if (filterStatus !== 'all') params.status = filterStatus;
      const data = await api.getDocuments(params);
      setDocuments(data.documents || []);
      setTotalPages(data.totalPages || 1);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      showToast('Failed to load documents: ' + err.message, 'error');
    }
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!newClientName || !newClientEmail) return;
    try {
      const res = await api.createClient({ name: newClientName, email: newClientEmail });
      setClients(prev => [...prev, res.data]);
      setFormClientId(res.data.id);
      setNewClientName(''); setNewClientEmail('');
      setShowClientModal(false);
    } catch (err) {
      showToast('Failed to register client: ' + err.message, 'error');
    }
  };

  const handleAddLine = () => {
    setFormLines(prev => [...prev, { description: '', quantity: 1, unitPrice: 0, adjust: 0, vendorId: '' }]);
  };

  const handleRemoveLine = (idx) => {
    if (formLines.length === 1) return;
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLineField = (idx, field, value) => {
    setFormLines(prev => prev.map((line, i) => i === idx ? { ...line, [field]: value } : line));
  };

  // Insert a predefined line item from settings
  const insertPredefined = (item) => {
    setFormLines(prev => [...prev, {
      description: item.title,
      quantity: item.qty || 1,
      unitPrice: item.price || 0,
      adjust: 0,
      vendorId: ''
    }]);
  };

  // Real-Time Calculations (inclusive/exclusive tax)
  const calculateTotals = () => {
    const linesTotal = formLines.reduce((acc, line) => {
      const qty = parseFloat(line.quantity) || 0;
      const rate = parseFloat(line.unitPrice) || 0;
      const adj = parseFloat(line.adjust) || 0;
      return acc + (qty * rate) + adj;
    }, 0);

    const taxRate = parseFloat(settings?.tax_config?.defaultTaxPercentage || 18.00);
    const isInclusive = settings?.tax_config?.pricesInclusiveOfTax === true;

    let subtotal, tax, total;
    if (isInclusive) {
      subtotal = linesTotal / (1 + taxRate / 100);
      tax = linesTotal - subtotal;
      total = linesTotal;
    } else {
      subtotal = linesTotal;
      tax = linesTotal * (taxRate / 100);
      total = linesTotal + tax;
    }

    return { subtotal, tax, total };
  };

  const handleSaveDocument = async () => {
    if (!formClientId) { showToast('Please select a client.', 'warning'); return; }
    const validLines = formLines.filter(l => l.description.trim() && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) { showToast('Please enter at least one valid line item.', 'warning'); return; }

    try {
      await api.createDocument({
        clientId: formClientId, type: formType, status: formStatus,
        dueDate: formDueDate || undefined, lines: validLines
      });
      showToast('Document created successfully!', 'success');
      setFormClientId(''); setFormLines([{ description: '', quantity: 1, unitPrice: 0, adjust: 0, vendorId: '' }]);
      setView('list'); loadDocuments();
    } catch (err) {
      showToast('Failed to generate document: ' + err.message, 'error');
    }
  };

  const viewDetails = async (docId) => {
    try {
      const data = await api.getDocument(docId);
      setDocDetails(data);
      setSelectedDocId(docId);
      setView('details');
    } catch (err) {
      showToast('Failed to load document details: ' + err.message, 'error');
    }
  };

  const handleCopyMagicLink = async (doc) => {
    try {
      const res = await api.getMagicToken(doc.id);
      const url = res.data?.portalUrl || `http://localhost:5173/portal/documents/${doc.id}`;
      navigator.clipboard.writeText(url);
    } catch {
      // Fallback simulated token
      const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ documentId: doc.id }))}.sig`;
      navigator.clipboard.writeText(`http://localhost:5173/portal/documents/${token}`);
    }
    setCopiedId(doc.id);
    setTimeout(() => setCopiedId(null), 3000);
  };

  const handleStatusChange = async (docId, newStatus) => {
    setUpdatingStatus(docId);
    try {
      await api.updateDocumentStatus(docId, newStatus);
      loadDocuments();
    } catch (err) {
      showToast('Status update failed: ' + err.message, 'error');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const currencySymbol = settings?.tax_config?.currencySymbol || '₹';
  const predefinedItems = settings?.general_config?.predefinedLineItems || [];

  return (
    <div className="fade-in">

      {/* ==================== 1. DOCUMENT LIST VIEW ==================== */}
      {view === 'list' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Invoice & Quote Grid</h1>
              <p style={{ color: 'var(--text-secondary)' }}>
                {totalCount} documents · Page {page} of {totalPages}
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setView('create')}>
              <Plus size={16} /> New Document
            </button>
          </div>

          {/* Filters Bar */}
          <div className="glass-card" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <div>
              <span className="form-label" style={{ marginBottom: 0, marginRight: '0.5rem', display: 'inline-block' }}>Type:</span>
              <select className="form-select" style={{ width: 'auto', display: 'inline-block', padding: '0.4rem 1.5rem 0.4rem 0.75rem' }}
                value={filterType} onChange={e => setFilterType(e.target.value)}>
                <option value="all">All</option>
                <option value="quote">Quotation</option>
                <option value="invoice">Invoice</option>
              </select>
            </div>
            <div>
              <span className="form-label" style={{ marginBottom: 0, marginRight: '0.5rem', display: 'inline-block' }}>Status:</span>
              <select className="form-select" style={{ width: 'auto', display: 'inline-block', padding: '0.4rem 1.5rem 0.4rem 0.75rem' }}
                value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="voided">Voided</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="glass-card" style={{ padding: 0 }}>
            <div className="table-container" style={{ margin: 0 }}>
              {documents.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>No documents matching filters found.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Doc Number</th>
                      <th>Client</th>
                      <th>Created</th>
                      <th>Due Date</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map(doc => (
                      <tr key={doc.id}>
                        <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{doc.document_number}</td>
                        <td>{doc.client_name}</td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{new Date(doc.created_at).toLocaleDateString()}</td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{new Date(doc.due_date).toLocaleDateString()}</td>
                        <td style={{ textTransform: 'capitalize' }}>{doc.type}</td>
                        <td>
                          <select
                            className="form-select"
                            style={{ padding: '0.25rem 1.5rem 0.25rem 0.5rem', width: 'auto', fontSize: '0.8rem', cursor: 'pointer' }}
                            value={doc.status}
                            onChange={e => handleStatusChange(doc.id, e.target.value)}
                            disabled={updatingStatus === doc.id || doc.status === 'paid' || doc.status === 'voided'}
                          >
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                            <option value="sent">Sent</option>
                            <option value="accepted">Accepted</option>
                            <option value="paid">Paid</option>
                            <option value="overdue">Overdue</option>
                            <option value="voided">Voided</option>
                          </select>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {currencySymbol}{parseFloat(doc.total_due).toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => viewDetails(doc.id)}>
                              View
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', color: copiedId === doc.id ? 'var(--accent-success)' : 'inherit' }}
                              onClick={() => handleCopyMagicLink(doc)}
                              title="Copy Magic Link"
                            >
                              {copiedId === doc.id ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                gap: '0.5rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)'
              }}>
                <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                  onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft size={14} /> Prev
                </button>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{page} / {totalPages}</span>
                <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}


      {/* ==================== 2. DOCUMENT CREATOR FORM ==================== */}
      {view === 'create' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
            <button className="btn btn-secondary" onClick={() => setView('list')}><ArrowLeft size={16} /> Back</button>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Create Financial Document</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Draft a new quote or publish a line-itemized invoice.</p>
            </div>
          </div>

          <div className="glass-card" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', alignItems: 'start' }}>
            {/* Main Fields Form */}
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Client</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <select className="form-select" value={formClientId} onChange={e => setFormClientId(e.target.value)}>
                      <option value="">Select client...</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={() => setShowClientModal(true)} type="button">
                      <UserPlus size={16} />
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Document Type</label>
                  <select className="form-select" value={formType} onChange={e => setFormType(e.target.value)}>
                    <option value="invoice">Billing Invoice</option>
                    <option value="quote">Quotation</option>
                  </select>
                </div>
              </div>

              {/* Pre-Defined Line Item Quick-Insert */}
              {predefinedItems.length > 0 && (
                <div style={{ marginBottom: '1.5rem', padding: '0.85rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Tag size={13} /> Quick Insert Pre-Defined Items
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {predefinedItems.map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                        onClick={() => insertPredefined(item)}
                      >
                        + {item.title} ({currencySymbol}{parseFloat(item.price || 0).toFixed(0)})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Dynamic Line-items editor */}
              <div style={{ marginBottom: '2rem' }}>
                <h4 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                  Line Items Builder
                </h4>

                {formLines.map((line, idx) => (
                  <div key={idx} style={{
                    display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1.5fr auto',
                    gap: '0.65rem', alignItems: 'end', marginBottom: '0.85rem',
                    padding: '0.85rem', background: 'rgba(255,255,255,0.01)',
                    border: '1px solid var(--border-color)', borderRadius: '10px'
                  }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Description</label>
                      <input type="text" className="form-input" value={line.description}
                        onChange={e => updateLineField(idx, 'description', e.target.value)}
                        placeholder="Service or product name" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Qty</label>
                      <input type="number" className="form-input" value={line.quantity}
                        onChange={e => updateLineField(idx, 'quantity', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Rate ({currencySymbol})</label>
                      <input type="number" className="form-input" value={line.unitPrice}
                        onChange={e => updateLineField(idx, 'unitPrice', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Adjust</label>
                      <input type="number" className="form-input" value={line.adjust}
                        onChange={e => updateLineField(idx, 'adjust', parseFloat(e.target.value) || 0)}
                        title="Per-line discount (negative) or markup (positive)" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Vendor</label>
                      <select className="form-select" value={line.vendorId}
                        onChange={e => updateLineField(idx, 'vendorId', e.target.value)}>
                        <option value="">Tenant (Internal)</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.business_name}</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-secondary"
                      onClick={() => handleRemoveLine(idx)}
                      style={{ padding: '0.75rem', color: 'var(--accent-danger)' }}
                      disabled={formLines.length === 1}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}

                <button className="btn btn-secondary" onClick={handleAddLine} style={{ marginTop: '0.25rem' }}>
                  <Plus size={14} /> Add Line Item
                </button>
              </div>
            </div>

            {/* Calculations Summary Card */}
            <div className="glass-card" style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', border: '1px solid var(--border-color)' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} /> Financial Summary
              </h4>
              {(() => {
                const { subtotal, tax, total } = calculateTotals();
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Pre-Tax Subtotal:</span>
                      <span style={{ fontWeight: 600 }}>{currencySymbol}{subtotal.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {settings?.tax_config?.defaultTaxName || 'GST'} ({settings?.tax_config?.defaultTaxPercentage || 18}%):
                      </span>
                      <span style={{ fontWeight: 600 }}>{currencySymbol}{tax.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', fontSize: '1.1rem' }}>
                      <span style={{ fontWeight: 700 }}>Total Due:</span>
                      <span style={{ fontWeight: 800, color: 'var(--accent-primary)' }}>{currencySymbol}{total.toFixed(2)}</span>
                    </div>
                    <div className="form-group" style={{ marginTop: '1rem', marginBottom: 0 }}>
                      <label className="form-label">Due Date</label>
                      <input type="date" className="form-input" value={formDueDate} onChange={e => setFormDueDate(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                      <label className="form-label">Document Status</label>
                      <select className="form-select" value={formStatus} onChange={e => setFormStatus(e.target.value)}>
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                        <option value="sent">Sent</option>
                      </select>
                    </div>
                    <button className="btn btn-primary" onClick={handleSaveDocument} style={{ width: '100%' }}>
                      <FilePlus size={16} /> Save Document
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}


      {/* ==================== 3. PDF DETAILS VISUALIZER / PRINT PREVIEW ==================== */}
      {view === 'details' && docDetails && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <button className="btn btn-secondary" onClick={() => setView('list')}>
              <ArrowLeft size={16} /> Back to Grid
            </button>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'uppercase' }}>
                {docDetails.type} Preview
              </span>
              <button
                className="btn btn-primary"
                onClick={() => window.print()}
                style={{ gap: '0.5rem' }}
              >
                <Printer size={15} /> Print / Download PDF
              </button>
            </div>
          </div>

          {/* Print-Only PDF Container */}
          <div
            id="print-area"
            className="glass-card"
            style={{
              backgroundColor: '#fff', color: '#1a1b24', padding: '3rem',
              borderRadius: '8px', maxWidth: '850px', margin: '0 auto',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)', fontFamily: '"Inter", sans-serif'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #eaeaea', paddingBottom: '2rem', marginBottom: '2.5rem' }}>
              <div>
                {docDetails.business_info?.logoUrl ? (
                  <img src={docDetails.business_info.logoUrl} alt="Logo" style={{ maxHeight: '50px', marginBottom: '1rem', display: 'block' }} />
                ) : (
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'uppercase', color: '#111', marginBottom: '0.5rem' }}>
                    {docDetails.business_info?.businessName || settings?.business_info?.businessName || 'Business Owner'}
                  </h2>
                )}
                <p style={{ fontSize: '0.85rem', color: '#555', maxWidth: '300px', lineHeight: '1.4' }}>
                  {docDetails.business_info?.address || settings?.business_info?.address}
                </p>
                <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.5rem' }}
                  dangerouslySetInnerHTML={{ __html: docDetails.business_info?.extraInfo || settings?.business_info?.extraInfo || '' }} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, textTransform: 'uppercase', color: '#111', margin: 0, lineHeight: 1 }}>
                  {docDetails.type === 'quote' ? 'Quotation' : 'Invoice'}
                </h1>
                <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#444', marginTop: '0.5rem' }}>
                  #{docDetails.document_number}
                </p>
                <div style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: '#555', display: 'inline-grid', gridTemplateColumns: 'auto auto', gap: '0.5rem 1.5rem', textAlign: 'left' }}>
                  <span><b>Date Issued:</b></span><span>{new Date(docDetails.created_at).toLocaleDateString()}</span>
                  <span><b>Due Date:</b></span><span>{new Date(docDetails.due_date).toLocaleDateString()}</span>
                </div>
              </div>
            </div>

            {/* Billed To */}
            <div style={{ marginBottom: '2.5rem' }}>
              <h4 style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', color: '#888', marginBottom: '0.5rem' }}>Billed To:</h4>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111', marginBottom: '0.25rem' }}>{docDetails.client_name}</h3>
              <p style={{ fontSize: '0.85rem', color: '#555', margin: 0 }}>{docDetails.client_email}</p>
              {docDetails.billing_address?.street && (
                <p style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem' }}>
                  {docDetails.billing_address.street}, {docDetails.billing_address.city}, {docDetails.billing_address.state} {docDetails.billing_address.zip}
                </p>
              )}
              {docDetails.client_extra_info && (
                <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem' }}
                  dangerouslySetInnerHTML={{ __html: docDetails.client_extra_info }} />
              )}
            </div>

            {/* Line Items Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2.5rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #222' }}>
                  <th style={{ padding: '0.75rem 0', textAlign: 'left', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: '#222' }}>Description</th>
                  <th style={{ padding: '0.75rem 0', textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: '#222', width: '80px' }}>Qty</th>
                  <th style={{ padding: '0.75rem 0', textAlign: 'right', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: '#222', width: '120px' }}>Rate</th>
                  {docDetails.lines?.some(l => parseFloat(l.adjust) !== 0) && (
                    <th style={{ padding: '0.75rem 0', textAlign: 'right', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: '#222', width: '90px' }}>Adj.</th>
                  )}
                  <th style={{ padding: '0.75rem 0', textAlign: 'right', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: '#222', width: '120px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {docDetails.lines?.map((line, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #eaeaea' }}>
                    <td style={{ padding: '1rem 0' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#111', display: 'block' }}>{line.description}</span>
                      {line.vendor_name && <span style={{ fontSize: '0.75rem', color: '#777' }}>Fulfilled by: {line.vendor_name}</span>}
                    </td>
                    <td style={{ padding: '1rem 0', textAlign: 'center', fontSize: '0.95rem', color: '#333' }}>{line.quantity}</td>
                    <td style={{ padding: '1rem 0', textAlign: 'right', fontSize: '0.95rem', color: '#333' }}>{currencySymbol}{parseFloat(line.unit_price).toFixed(2)}</td>
                    {docDetails.lines?.some(l => parseFloat(l.adjust) !== 0) && (
                      <td style={{ padding: '1rem 0', textAlign: 'right', fontSize: '0.85rem', color: parseFloat(line.adjust) < 0 ? '#e74c3c' : '#27ae60' }}>
                        {parseFloat(line.adjust) !== 0 ? `${parseFloat(line.adjust) > 0 ? '+' : ''}${currencySymbol}${parseFloat(line.adjust).toFixed(2)}` : '—'}
                      </td>
                    )}
                    <td style={{ padding: '1rem 0', textAlign: 'right', fontSize: '0.95rem', fontWeight: 600, color: '#111' }}>{currencySymbol}{parseFloat(line.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals Summary */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '3rem' }}>
              <div style={{ width: '280px', fontSize: '0.9rem', color: '#333' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                  <span>Subtotal:</span>
                  <span>{currencySymbol}{parseFloat(docDetails.sub_total).toFixed(2)}</span>
                </div>
                {parseFloat(docDetails.discount_amount || 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', color: '#e74c3c' }}>
                    <span>Discount:</span>
                    <span>−{currencySymbol}{parseFloat(docDetails.discount_amount).toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #eaeaea' }}>
                  <span>{docDetails.tax_config?.defaultTaxName || 'GST'} ({docDetails.tax_config?.defaultTaxPercentage || 18}%):</span>
                  <span>{currencySymbol}{parseFloat(docDetails.tax_amount).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', fontSize: '1.15rem', fontWeight: 800, color: '#111' }}>
                  <span>Total Due:</span>
                  <span>{currencySymbol}{parseFloat(docDetails.total_due).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Footer and Terms */}
            <div style={{ borderTop: '2px solid #eaeaea', paddingTop: '1.5rem', fontSize: '0.75rem', color: '#666', lineHeight: '1.5' }}>
              <h5 style={{ fontWeight: 700, textTransform: 'uppercase', color: '#222', marginBottom: '0.4rem' }}>Terms & Conditions:</h5>
              <div dangerouslySetInnerHTML={{
                __html: docDetails.type === 'quote'
                  ? (docDetails.invoice_config?.quote?.termsAndConditions || settings?.invoice_config?.quote?.termsAndConditions || '')
                  : (docDetails.invoice_config?.invoice?.termsAndConditions || settings?.invoice_config?.invoice?.termsAndConditions || '')
              }} />
              <div style={{ marginTop: '1.5rem', textAlign: 'center', color: '#888' }}>
                <div dangerouslySetInnerHTML={{
                  __html: docDetails.type === 'quote'
                    ? (docDetails.invoice_config?.quote?.footerNotes || settings?.invoice_config?.quote?.footerNotes || '')
                    : (docDetails.invoice_config?.invoice?.footerNotes || settings?.invoice_config?.invoice?.footerNotes || '')
                }} />
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ==================== CLIENT QUICK-ADD MODAL ==================== */}
      {showClientModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass-card" style={{ width: '400px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.25rem' }}>Register New Client</h3>
            <form onSubmit={handleCreateClient}>
              <div className="form-group">
                <label className="form-label">Client Name</label>
                <input type="text" className="form-input" value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="e.g. Vikas Sharma" required />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input type="email" className="form-input" value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} placeholder="name@company.com" required />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowClientModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Client</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Documents;
