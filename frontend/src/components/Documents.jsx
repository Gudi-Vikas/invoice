/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import {
  FileText, Plus, Trash2, ArrowLeft, FilePlus, Copy, Check, X,
  UserPlus, Printer, ChevronLeft, ChevronRight, Tag,
  Mail, Loader, ShieldCheck, Download
} from 'lucide-react';
import DocumentListTable from './DocumentListTable';
import { downloadElementAsPdf } from '../utils/pdfUtils';

/**
 * Documents Module (Quotes & Invoices Manager).
 * Contains list, builder form with real-time tax math, and PDF invoice visualizer.
 * Uses SettingsContext — no redundant getSettings() calls.
 */
export const Documents = ({ defaultType = 'invoice', initialView = 'list' }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [view, setView] = useState(initialView);
  const [documents, setDocuments] = useState([]);
  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [docDetails, setDocDetails] = useState(null);

  // Filtering and pagination (no longer used for list view, handled by DocumentListTable)
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Magic link copy
  const [copiedId, setCopiedId] = useState(null);

  // Quick client registration modal
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientBilling, setNewClientBilling] = useState({ street: '', city: '', state: '', zip: '' });
  const [newClientExtraInfo, setNewClientExtraInfo] = useState('');

  // Form states
  const [formType, setFormType] = useState(defaultType);
  const [formClientId, setFormClientId] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formLines, setFormLines] = useState([{ description: '', quantity: 1, unitPrice: 0, adjust: 0, vendorId: '', vendorCost: '' }]);


  // Status update tracking
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [verifyingDoc, setVerifyingDoc] = useState(null);
  const [sendingEmailId, setSendingEmailId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (!docDetails) return;
    setIsDownloadingPdf(true);
    try {
      const fileName = `${docDetails.type}_${docDetails.document_number || 'download'}.pdf`;
      await downloadElementAsPdf('print-area', fileName);
      showToast('PDF downloaded successfully!', 'success');
    } catch (err) {
      showToast('Failed to download PDF: ' + err.message, 'error');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const loadMetadata = useCallback(async () => {
    try {
      const clientData = await api.getClients();
      setClients(clientData.clients || []);
      const vendorData = await api.getVendors();
      setVendors(vendorData || []);
    } catch (err) {
      showToast('Failed to load form config values: ' + err.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  // The DocumentListTable handles list data fetching now, but we keep a dummy function
  // so the rest of the component (e.g. details view actions) can "refresh" list data if needed,
  // although switching back to view='list' will trigger a remount of DocumentListTable anyway.
  const loadDocuments = useCallback(async () => {
    // No-op or trigger a refresh if we had a ref
  }, []);

  const [clientModalError, setClientModalError] = useState('');

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!newClientName || !newClientEmail) return;
    setClientModalError('');
    try {
      const res = await api.createClient({ 
        name: newClientName, 
        email: newClientEmail,
        billingAddress: newClientBilling,
        extraInfo: newClientExtraInfo
      });
      setClients(prev => [...prev, res.data]);
      setFormClientId(res.data.id);
      setNewClientName(''); setNewClientEmail('');
      setNewClientBilling({ street: '', city: '', state: '', zip: '' });
      setNewClientExtraInfo('');
      setShowClientModal(false);
    } catch (err) {
      setClientModalError(err.message || 'Failed to register client.');
    }
  };

  const handleAddLine = () => {
    setFormLines(prev => [...prev, { description: '', quantity: 1, unitPrice: 0, adjust: 0, vendorId: '', vendorCost: '' }]);
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
      vendorId: '',
      vendorCost: ''
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
    if (isSaving) return;
    if (!formClientId) { showToast('Please select a client.', 'warning'); return; }
    const validLines = formLines.filter(l => l.description.trim() && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) { showToast('Please enter at least one valid line item.', 'warning'); return; }

    setIsSaving(true);
    try {
      await api.createDocument({
        clientId: formClientId, type: formType, status: 'published',
        dueDate: formDueDate || undefined, lines: validLines
      });
      showToast('Document created successfully!', 'success');
      setFormClientId(''); setFormLines([{ description: '', quantity: 1, unitPrice: 0, adjust: 0, vendorId: '', vendorCost: '' }]);
      setView('list'); loadDocuments();
    } catch (err) {
      showToast('Failed to generate document: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const viewDetails = useCallback(async (docId) => {
    try {
      const data = await api.getDocument(docId);
      setDocDetails(data);
      setSelectedDocId(docId);
      setView('details');
    } catch (err) {
      showToast('Failed to load document details: ' + err.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (id) {
      viewDetails(id);
    } else {
      setView(initialView);
      setSelectedDocId(null);
      setDocDetails(null);
    }
  }, [id, initialView, viewDetails]);

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

  const handleSendEmail = async () => {
    if (!docDetails) return;
    setSendingEmailId(docDetails.id);
    try {
      const res = await api.sendDocumentEmail(docDetails.id);
      showToast(res.message || 'Email sent successfully!', 'success');
      // Transition status to sent locally if draft/published
      setDocDetails(prev => ({
        ...prev,
        status: (prev.status === 'draft' || prev.status === 'published') ? 'sent' : prev.status
      }));
      loadDocuments();
    } catch (err) {
      showToast('Failed to send email: ' + err.message, 'error');
    } finally {
      setSendingEmailId(null);
    }
  };

  const handleStatusChange = async (docId, newStatus) => {
    setUpdatingStatus(docId);
    try {
      await api.updateDocumentStatus(docId, newStatus);
      showToast(`Document status updated to ${newStatus}.`, 'success');
      loadDocuments();
      if (selectedDocId === docId) {
        const data = await api.getDocument(docId);
        setDocDetails(data);
      }
    } catch (err) {
      showToast('Status update failed: ' + err.message, 'error');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handleConvertQuote = async (docId) => {
    try {
      await api.convertQuoteToInvoice(docId);
      showToast('Quotation successfully converted to Invoice!', 'success');
      loadDocuments();
    } catch (err) {
      showToast('Failed to convert quote: ' + err.message, 'error');
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
              <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>
                {defaultType === 'quote' ? 'Quotations' : 'Invoices'}
              </h1>
              <p style={{ color: 'var(--text-secondary)' }}>
                Manage your {defaultType === 'quote' ? 'quotes' : 'invoices'}.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => { setFormType(defaultType); setView('create'); }}>
              <Plus size={16} /> New {defaultType === 'quote' ? 'Quote' : 'Invoice'}
            </button>
          </div>
          
          <DocumentListTable 
            defaultType={defaultType}
            onViewDetails={viewDetails}
            onCopyLink={handleCopyMagicLink}
            onVerifyPayment={setVerifyingDoc}
            onConvertQuote={handleConvertQuote}
          />
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
                    display: 'grid',
                    gridTemplateColumns: line.vendorId ? '2.5fr 1fr 1fr 1fr 1.5fr 1.25fr auto' : '3fr 1fr 1fr 1fr 1.5fr auto',
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
                        onChange={e => {
                          const v = e.target.value;
                          setFormLines(prev => prev.map((l, i) => i === idx ? { ...l, vendorId: v, vendorCost: v ? l.vendorCost : '' } : l));
                        }}>
                        <option value="">Tenant (Internal)</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.business_name}</option>)}
                      </select>
                    </div>
                    {line.vendorId && (
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.72rem' }}>Payout Cost</label>
                        <input type="number" className="form-input" value={line.vendorCost || ''}
                          onChange={e => updateLineField(idx, 'vendorCost', e.target.value)}
                          placeholder="e.g. 800"
                          title="Optional dedicated flat cost paid to vendor instead of standard commission percentage" />
                      </div>
                    )}
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
                    <div className="form-group" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                      <label className="form-label">Due Date</label>
                      <input type="date" className="form-input" value={formDueDate} onChange={e => setFormDueDate(e.target.value)} />
                    </div>
                    <button className="btn btn-primary" onClick={handleSaveDocument} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }} disabled={isSaving}>
                      {isSaving ? (
                        <>
                          <Loader size={16} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                          Saving...
                        </>
                      ) : (
                        <>
                          <FilePlus size={16} /> Save Document
                        </>
                      )}
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
            <button className="btn btn-secondary" onClick={() => {
              if (id) {
                navigate(defaultType === 'quote' ? '/quotes' : '/invoices');
              } else {
                setView('list');
              }
            }}>
              <ArrowLeft size={16} /> Back to Grid
            </button>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'uppercase' }}>
                {docDetails.type} Preview
              </span>
              {sendingEmailId === docDetails.id ? (
                <button className="btn btn-secondary" disabled style={{ gap: '0.5rem' }}>
                  <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Sending...
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={handleSendEmail}
                  style={{ gap: '0.5rem' }}
                >
                  <Mail size={15} /> Send Email to Client
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf}
                style={{ gap: '0.5rem' }}
              >
                {isDownloadingPdf ? (
                  <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Generating PDF...</>
                ) : (
                  <><Download size={15} /> Download PDF</>
                )}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => window.print()}
                style={{ gap: '0.5rem' }}
              >
                <Printer size={15} /> Print
              </button>
            </div>
          </div>

          {docDetails.status === 'pending_verification' && (
            <div className="glass-card fade-in" style={{ border: '1px solid rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.06)', padding: '1.5rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h4 style={{ color: 'var(--accent-warning)', fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Offline Payment Awaiting Approval
                </h4>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>
                  The client has submitted payment proof: <strong>{docDetails.offline_payment_info?.reference}</strong> via <strong>{docDetails.offline_payment_info?.method === 'bank_transfer' ? 'Bank Transfer' : 'UPI'}</strong>.
                </p>
                {docDetails.offline_payment_info?.notes && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontStyle: 'italic', margin: 0 }}>
                    Notes: "{docDetails.offline_payment_info.notes}"
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button 
                  className="btn btn-primary" 
                  style={{ backgroundColor: 'var(--accent-success)', borderColor: 'var(--accent-success)', color: '#fff' }}
                  onClick={() => handleStatusChange(docDetails.id, 'paid')}
                  disabled={updatingStatus === docDetails.id}
                >
                  Approve & Mark Paid
                </button>
                <button 
                  className="btn btn-secondary" 
                  style={{ color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }}
                  onClick={() => handleStatusChange(docDetails.id, 'rejected')} 
                  disabled={updatingStatus === docDetails.id}
                >
                  Reject Payment
                </button>
              </div>
            </div>
          )}

          {/* Print-Only PDF Container */}
          <div id="print-area" className="invoice-container">
            {/* Header */}
            <div className="invoice-header">
              <div className="invoice-logo-container">
                {docDetails.business_info?.logoUrl ? (
                  <img src={docDetails.business_info.logoUrl} alt="Logo" className="invoice-logo" />
                ) : (
                  <h2 className="invoice-logo-fallback">
                    {docDetails.business_info?.businessName || settings?.business_info?.businessName || 'Ultrakey'}
                  </h2>
                )}
              </div>
              <div className="invoice-title-banner">
                {docDetails.type === 'quote' ? 'Quotation' : 'Invoice'}
              </div>
            </div>

            {/* Mid Section (From, To, Meta) */}
            <div className="invoice-mid-section">
              {/* Left Column: From and To Addresses */}
              <div className="invoice-left-col">
                {/* From Address */}
                <div className="invoice-address-block">
                  <div className="invoice-address-header">From:</div>
                  <div className="invoice-address-body">
                    <p><b>{docDetails.business_info?.businessName || settings?.business_info?.businessName || 'Ultrakey IT Solutions Private Limited'}</b></p>
                    {docDetails.business_info?.address || settings?.business_info?.address ? (
                      (docDetails.business_info?.address || settings?.business_info?.address || '').split('\n').map((line, i) => <p key={i}>{line}</p>)
                    ) : (
                      <>
                        <p>Flat No. 204, 2nd Floor, Cyber Residency,</p>
                        <p>Inidra Nagar, Gachibowli,</p>
                        <p>Hyderabad, Telangana, India-500032</p>
                      </>
                    )}
                    <p>{docDetails.business_info?.email || settings?.business_info?.email || 'support@ultrakeyit.com'}</p>
                    {docDetails.business_info?.extraInfo || settings?.business_info?.extraInfo ? (
                      <div dangerouslySetInnerHTML={{ __html: docDetails.business_info?.extraInfo || settings?.business_info?.extraInfo || '' }} />
                    ) : (
                      <p><b>GST No:</b> 36AADCU5062A1ZO</p>
                    )}
                  </div>
                </div>

                {/* To Address */}
                <div className="invoice-address-block">
                  <div className="invoice-address-header">To:</div>
                  <div className="invoice-address-body">
                    <p><b>{docDetails.client_name}</b></p>
                    {(docDetails.billing_address?.street || docDetails.billing_address?.city) && (
                      <>
                        {docDetails.billing_address.street && <p>{docDetails.billing_address.street}</p>}
                        {(docDetails.billing_address.city || docDetails.billing_address.state || docDetails.billing_address.zip) && (
                          <p>
                            {[docDetails.billing_address.city, docDetails.billing_address.state].filter(Boolean).join(', ')} {docDetails.billing_address.zip || ''}
                          </p>
                        )}
                      </>
                    )}
                    {docDetails.client_email && <p>{docDetails.client_email}</p>}
                    {docDetails.client_extra_info && (
                      <div dangerouslySetInnerHTML={{ __html: docDetails.client_extra_info }} />
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Invoice metadata and payment terms */}
              <div className="invoice-right-col">
                <div className="invoice-meta-list">
                  <span><b>Invoice Number</b></span>
                  <span>{docDetails.document_number}</span>
                  
                  <span><b>Invoice Date</b></span>
                  <span>{new Date(docDetails.created_at).toLocaleDateString()}</span>
                  
                  <span><b>Due Date</b></span>
                  <span>{new Date(docDetails.due_date).toLocaleDateString()}</span>
                </div>

                <div className="invoice-total-due-banner">
                  <span>TOTAL DUE</span>
                  <span>{currencySymbol}{parseFloat(docDetails.total_due).toFixed(2)}</span>
                </div>

                <div className="invoice-payment-terms">
                  {docDetails.type === 'quote'
                    ? (docDetails.invoice_config?.quote?.termsAndConditions || settings?.invoice_config?.quote?.termsAndConditions || 'Quotation valid for 30 days.')
                    : (docDetails.invoice_config?.invoice?.termsAndConditions || settings?.invoice_config?.invoice?.termsAndConditions || 'Payment is due within 14 days from date of invoice. Late payment is subject to fees of 5% per month.')}
                </div>

                <div className="invoice-payment-methods">
                  <h4>Payment Methods:</h4>
                  <ol>
                    <li>60% Advance Payment</li>
                    <li>Remaining 40% Final Settlement</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <table className="invoice-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>HRS/QTY</th>
                  <th style={{ textAlign: 'left' }}>SERVICE DETAILS</th>
                  <th style={{ textAlign: 'right' }}>RATE/PRICE</th>
                  <th style={{ textAlign: 'right' }}>SUB TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {docDetails.lines?.map((line, index) => (
                  <tr key={index}>
                    <td style={{ textAlign: 'left', verticalAlign: 'top' }}>{parseFloat(line.quantity)}</td>
                    <td style={{ textAlign: 'left', verticalAlign: 'top' }}>
                      <span className="invoice-item-desc">{line.description}</span>
                      <span className="invoice-item-subdesc">{line.description}</span>
                      {line.vendor_name && (
                        <span className="invoice-item-subdesc" style={{ marginTop: '0.25rem' }}>
                          Fulfilled by: {line.vendor_name}
                          {line.vendor_cost !== null && line.vendor_cost !== undefined && ` (Cost: ${currencySymbol}${parseFloat(line.vendor_cost).toFixed(2)})`}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', verticalAlign: 'top' }}>{currencySymbol}{parseFloat(line.unit_price).toFixed(2)}</td>
                    <td style={{ textAlign: 'right', verticalAlign: 'top', fontWeight: 600 }}>{currencySymbol}{parseFloat(line.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Bottom section: Bank details and totals */}
            <div className="invoice-bottom-section">
              {/* Left Column: Bank and payment instructions */}
              {(() => {
                const pConfig = docDetails.payments_config || settings?.payments_config || {};
                const bankDetailsText = pConfig.bankDetails;
                const bankName = pConfig.bankName;
                const bankAccountNumber = pConfig.bankAccountNumber;
                const bankAccountName = pConfig.bankAccountName;
                const bankIfsc = pConfig.bankIfsc;
                const bankBranch = pConfig.bankBranch;
                const gpayNumber = pConfig.gpayNumber;
                const upiId = pConfig.upiId;

                const hasBankDetails = !!(bankName || bankAccountNumber || bankAccountName || bankIfsc || bankBranch);
                const hasGPay = !!gpayNumber;
                const hasUpi = !!upiId;

                if (!hasBankDetails && !hasGPay && !hasUpi && !bankDetailsText) {
                  return (
                    <div className="invoice-bank-details-box">
                      <h4>Payment Instructions</h4>
                      <p style={{ color: '#64748b', margin: 0 }}>No payment instructions configured.</p>
                    </div>
                  );
                }

                return (
                  <div className="invoice-bank-details-box">
                    <h4>Pay Invoice amount via one of the options mentioned below</h4>
                    
                    {hasGPay && (
                      <div className="invoice-bank-option" style={{ marginBottom: '1rem' }}>
                        <div className="invoice-bank-option-title">Option 1: Gpay (or) Phonepe Number:</div>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{gpayNumber}</div>
                      </div>
                    )}

                    {hasBankDetails && (
                      <div className="invoice-bank-option" style={{ marginBottom: '1rem' }}>
                        <div className="invoice-bank-option-title">Option 2: Direct To Organization Current A/C</div>
                        <div className="invoice-bank-details-grid">
                          {bankAccountNumber && (
                            <>
                              <span style={{ color: '#475569', fontWeight: 500 }}>Account Number:</span>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{bankAccountNumber}</span>
                            </>
                          )}
                          {bankAccountName && (
                            <>
                              <span style={{ color: '#475569', fontWeight: 500 }}>Name:</span>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{bankAccountName}</span>
                            </>
                          )}
                          {bankName && (
                            <>
                              <span style={{ color: '#475569', fontWeight: 500 }}>Bank Name:</span>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{bankName}</span>
                            </>
                          )}
                          {bankIfsc && (
                            <>
                              <span style={{ color: '#475569', fontWeight: 500 }}>IFSC:</span>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{bankIfsc}</span>
                            </>
                          )}
                          {bankBranch && (
                            <>
                              <span style={{ color: '#475569', fontWeight: 500 }}>Branch:</span>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{bankBranch}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {hasUpi && (
                      <div className="invoice-bank-option" style={{ marginBottom: '1rem' }}>
                        <div className="invoice-bank-option-title">Option 3: Pay via UPI ID</div>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{upiId}</div>
                      </div>
                    )}

                    {bankDetailsText && (
                      <div className="invoice-bank-option" style={{ borderTop: '1px solid #cbd5e1', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
                        <div className="invoice-bank-option-title" style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#475569', marginBottom: '0.25rem' }}>Additional Notes:</div>
                        <div style={{ whiteSpace: 'pre-wrap', color: '#475569' }}>{bankDetailsText}</div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Right Column: Summary totals */}
              {(() => {
                const subTotal = parseFloat(docDetails.sub_total);
                const discount = parseFloat(docDetails.discount_amount || 0);
                const tax = parseFloat(docDetails.tax_amount);
                const convenienceFeeEnabled = docDetails.convenience_fee_enabled === true;
                const surcharge = parseFloat(docDetails.convenience_fee_amount || 0);
                const surchargeTax = parseFloat(docDetails.convenience_fee_tax_amount || 0);
                const originalTotal = parseFloat(docDetails.total_due);
                const finalTotal = originalTotal + surcharge + surchargeTax;

                const paidAmount = docDetails.status === 'paid' ? finalTotal : 0;
                const remainingDue = docDetails.status === 'paid' ? 0 : finalTotal;

                return (
                  <div className="invoice-totals-box">
                    <div className="invoice-totals-row">
                      <span>Sub Total</span>
                      <span>{currencySymbol}{(subTotal + discount).toFixed(2)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="invoice-totals-row discount">
                        <span>Discount</span>
                        <span>{currencySymbol}{discount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="invoice-totals-row">
                      <span>{docDetails.tax_config?.defaultTaxName || 'GST'} ({docDetails.tax_config?.defaultTaxPercentage || 18}%)</span>
                      <span>{currencySymbol}{tax.toFixed(2)}</span>
                    </div>
                    {convenienceFeeEnabled && (
                      <>
                        <div className="invoice-totals-row">
                          <span>Invoice Total</span>
                          <span>{currencySymbol}{originalTotal.toFixed(2)}</span>
                        </div>
                        <div className="invoice-totals-row" style={{ color: 'var(--accent-warning)' }}>
                          <span>Gateway Fee (2% + GST)</span>
                          <span>{currencySymbol}{(surcharge + surchargeTax).toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="invoice-totals-row bold-divider">
                      <span>Paid</span>
                      <span>{currencySymbol}{paidAmount.toFixed(2)}</span>
                    </div>
                    <div className="invoice-totals-due-banner">
                      <span>TOTAL DUE</span>
                      <span>{currencySymbol}{remainingDue.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="invoice-footer-line">
              Thanks for choosing {docDetails.business_info?.businessName || settings?.business_info?.businessName || 'Ultrakey IT Solutions Pvt. Ltd.'} | {docDetails.business_info?.email || settings?.business_info?.email || 'support@ultrakeyit.com'} | {docDetails.business_info?.website || settings?.business_info?.website || '+91 6300440316'}
            </div>
          </div>
        </div>
      )}


      {/* ==================== CLIENT QUICK-ADD MODAL ==================== */}
      {showClientModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ width: '480px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.25rem' }}>Register New Client</h3>
            <form onSubmit={handleCreateClient}>
              {clientModalError && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px', padding: '0.75rem 1rem', color: 'hsl(350, 89%, 75%)',
                  fontSize: '0.85rem', marginBottom: '1.25rem'
                }}>
                  {clientModalError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Client Name *</label>
                  <input type="text" className="form-input" value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="e.g. Vikas Sharma" required />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Email *</label>
                  <input type="email" className="form-input" value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} placeholder="name@company.com" required />
                </div>
              </div>
              
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Street Address</label>
                <input type="text" className="form-input" value={newClientBilling.street} onChange={e => setNewClientBilling(prev => ({ ...prev, street: e.target.value }))} placeholder="123 Business Rd, Suite 100" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">City</label>
                  <input type="text" className="form-input" value={newClientBilling.city} onChange={e => setNewClientBilling(prev => ({ ...prev, city: e.target.value }))} placeholder="City" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">State</label>
                  <input type="text" className="form-input" value={newClientBilling.state} onChange={e => setNewClientBilling(prev => ({ ...prev, state: e.target.value }))} placeholder="State" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">ZIP Code</label>
                  <input type="text" className="form-input" value={newClientBilling.zip} onChange={e => setNewClientBilling(prev => ({ ...prev, zip: e.target.value }))} placeholder="ZIP" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Extra Info / GSTIN</label>
                <textarea className="form-input" rows="2" value={newClientExtraInfo} onChange={e => setNewClientExtraInfo(e.target.value)} placeholder="Additional billing details, GSTIN, etc."></textarea>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowClientModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Client</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ==================== VERIFY PAYMENT MODAL ==================== */}
      {verifyingDoc && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '480px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldCheck size={20} /> Verify Offline Payment
            </h3>
            
            <div style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <p style={{ marginBottom: '0.75rem' }}>
                Client <strong>{verifyingDoc.client_name}</strong> has submitted payment proof for document <strong>{verifyingDoc.document_number}</strong>.
              </p>
              
              <div style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr' }}>
                  <span style={{ fontWeight: 600 }}>Amount Due:</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{currencySymbol}{parseFloat(verifyingDoc.total_due).toFixed(2)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr' }}>
                  <span style={{ fontWeight: 600 }}>Method:</span>
                  <span style={{ textTransform: 'uppercase' }}>{verifyingDoc.offline_payment_info?.method === 'bank_transfer' ? 'Bank Transfer' : verifyingDoc.offline_payment_info?.method || 'Unknown'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr' }}>
                  <span style={{ fontWeight: 600 }}>Reference UTR:</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '1rem', color: '#1e293b', fontWeight: 600 }}>{verifyingDoc.offline_payment_info?.reference || 'N/A'}</span>
                </div>
                {verifyingDoc.offline_payment_info?.notes && (
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr' }}>
                    <span style={{ fontWeight: 600 }}>Notes:</span>
                    <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{verifyingDoc.offline_payment_info.notes}</span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setVerifyingDoc(null)}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }} 
                onClick={() => {
                  handleStatusChange(verifyingDoc.id, 'rejected');
                  setVerifyingDoc(null);
                }}
                disabled={updatingStatus === verifyingDoc.id}
              >
                <X size={14} /> Reject
              </button>
              <button 
                type="button" 
                className="btn btn-primary" 
                style={{ backgroundColor: 'var(--accent-success)', borderColor: 'var(--accent-success)', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.25rem' }} 
                onClick={() => {
                  handleStatusChange(verifyingDoc.id, 'paid');
                  setVerifyingDoc(null);
                }}
                disabled={updatingStatus === verifyingDoc.id}
              >
                <Check size={14} /> Approve & Mark Paid
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Documents;
