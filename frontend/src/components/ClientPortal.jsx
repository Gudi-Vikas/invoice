import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { CheckCircle2, ShieldCheck, CreditCard, ArrowRightLeft, FileCheck, Landmark, Loader } from 'lucide-react';

/**
 * Client-Facing Portal.
 * Accessed via /portal/documents/:token (magic link JWT).
 * Renders the document, allows quote acceptance and invoice payment.
 */
export const ClientPortal = () => {
  const { token } = useParams();

  const [doc, setDoc] = useState(null);
  const [businessInfo, setBusinessInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Checkout Modal
  const [showRzpModal, setShowRzpModal] = useState(false);
  const [splits, setSplits] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const loadDocument = useCallback(async () => {
    try {
      const data = await api.getPortalDocument(token);
      setDoc(data.document ? { ...data.document, lines: data.lines } : data);
      setBusinessInfo(data.document?.business_info || data.business_info || data.businessInfo || null);
      setError('');
    } catch (err) {
      setError(err.message || 'Invalid or expired link.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      Promise.resolve().then(loadDocument);
    }
  }, [token, loadDocument]);

  const handleAcceptQuote = async () => {
    if (!doc || doc.type !== 'quote') return;
    try {
      await api.acceptQuote(doc.id, token);
      setError('');
      await loadDocument();
    } catch (err) {
      setError('Accept failed: ' + err.message);
    }
  };

  const handlePayInvoiceInit = () => {
    if (!doc || doc.type !== 'invoice') return;

    const parsedSplits = [];
    (doc.lines || []).forEach(line => {
      if (line.vendor_id) {
        const amt = parseFloat(line.amount);
        const percent = 5.00;
        const fee = amt * (percent / 100);
        const share = amt - fee;
        parsedSplits.push({
          vendorName: line.vendor_name || 'Marketplace Seller',
          amount: share,
          platformFee: fee
        });
      }
    });

    setSplits(parsedSplits);
    setShowRzpModal(true);
  };

  const handleConfirmPayment = async () => {
    setIsProcessing(true);
    try {
      await api.initializePayment(doc.id, token);
      setTimeout(() => {
        setIsProcessing(false);
        setPaymentSuccess(true);
        setError('');
        loadDocument();
      }, 1500);
    } catch (err) {
      setIsProcessing(false);
      setError('Payment failed: ' + err.message);
    }
  };

  const currencySymbol = doc?.tax_config?.currencySymbol || businessInfo?.currencySymbol || '₹';

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
        <Loader size={24} style={{ animation: 'spin 1s linear infinite', marginRight: '0.75rem' }} />
        Loading document...
      </div>
    );
  }

  if (error && !doc) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: 'var(--font-body)' }}>
        <div className="glass-card" style={{ textAlign: 'center', maxWidth: '480px', padding: '3rem' }}>
          <ShieldCheck size={48} style={{ color: 'var(--accent-danger)', marginBottom: '1rem' }} />
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Link Invalid or Expired</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '2rem' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }} className="fade-in">

        {/* Error Banner */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px', padding: '0.75rem 1rem', color: 'hsl(350, 89%, 75%)',
            fontSize: '0.85rem', marginBottom: '1.5rem'
          }}>
            {error}
          </div>
        )}

        {doc && (
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '2rem', alignItems: 'start' }}>

            {/* Document Preview */}
            <div style={{
              backgroundColor: '#fff', color: '#1a1b24', padding: '3rem',
              borderRadius: '8px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              fontFamily: '"Inter", sans-serif'
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #eaeaea', paddingBottom: '2rem', marginBottom: '2.5rem' }}>
                <div>
                  {businessInfo?.logoUrl && (
                    <img src={businessInfo.logoUrl} alt="Logo" style={{ maxHeight: '45px', marginBottom: '1rem' }} />
                  )}
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#111', margin: 0 }}>
                    {businessInfo?.businessName || 'Business'}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: '#666', maxWidth: '300px', margin: 0 }}>
                    {businessInfo?.address || ''}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <h1 style={{ fontSize: '2.25rem', fontWeight: 800, textTransform: 'uppercase', color: '#111', margin: 0 }}>
                    {doc.type}
                  </h1>
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: '#444' }}>#{doc.document_number}</p>
                  <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#666' }}>
                    <p><b>Issue Date:</b> {new Date(doc.created_at).toLocaleDateString()}</p>
                    <p><b>Due Date:</b> {new Date(doc.due_date).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {/* Billed To */}
              <div style={{ marginBottom: '2rem' }}>
                <h4 style={{ textTransform: 'uppercase', fontSize: '0.75rem', color: '#999', marginBottom: '0.25rem' }}>Billed To:</h4>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#111' }}>{doc.client_name}</h3>
                <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>{doc.client_email}</p>
              </div>

              {/* Lines Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2.5rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #222' }}>
                    <th style={{ padding: '0.5rem 0', textAlign: 'left', fontSize: '0.8rem', color: '#222' }}>Description</th>
                    <th style={{ padding: '0.5rem 0', textAlign: 'center', fontSize: '0.8rem', color: '#222', width: '60px' }}>Qty</th>
                    <th style={{ padding: '0.5rem 0', textAlign: 'right', fontSize: '0.8rem', color: '#222', width: '100px' }}>Rate</th>
                    <th style={{ padding: '0.5rem 0', textAlign: 'right', fontSize: '0.8rem', color: '#222', width: '100px' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines?.map((line, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #eaeaea' }}>
                      <td style={{ padding: '0.85rem 0' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#111', display: 'block' }}>{line.description}</span>
                        {line.vendor_name && <span style={{ fontSize: '0.75rem', color: '#888' }}>Provided by: {line.vendor_name}</span>}
                      </td>
                      <td style={{ padding: '0.85rem 0', textAlign: 'center', fontSize: '0.9rem', color: '#444' }}>{line.quantity}</td>
                      <td style={{ padding: '0.85rem 0', textAlign: 'right', fontSize: '0.9rem', color: '#444' }}>{currencySymbol}{parseFloat(line.unit_price).toFixed(2)}</td>
                      <td style={{ padding: '0.85rem 0', textAlign: 'right', fontSize: '0.9rem', fontWeight: 600, color: '#111' }}>{currencySymbol}{parseFloat(line.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ width: '250px', fontSize: '0.85rem', color: '#444' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0' }}>
                    <span>Subtotal:</span>
                    <span>{currencySymbol}{parseFloat(doc.sub_total).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #eaeaea' }}>
                    <span>Tax ({doc.tax_config?.defaultTaxPercentage || 18}%):</span>
                    <span>{currencySymbol}{parseFloat(doc.tax_amount).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', fontSize: '1.1rem', fontWeight: 800, color: '#111' }}>
                    <span>Total Due:</span>
                    <span>{currencySymbol}{parseFloat(doc.total_due).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Sidebar */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Actions</h3>

              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <p style={{ marginBottom: '0.5rem' }}><b>Status:</b></p>
                <span className={`badge badge-${doc.status}`} style={{ fontSize: '0.85rem', padding: '0.35rem 0.85rem' }}>
                  {doc.status}
                </span>
              </div>

              {doc.type === 'quote' && (doc.status === 'published' || doc.status === 'sent') && (
                <button className="btn btn-primary" onClick={handleAcceptQuote} style={{ width: '100%' }}>
                  <FileCheck size={16} /> Accept Quotation
                </button>
              )}

              {doc.type === 'invoice' && (doc.status === 'published' || doc.status === 'sent') && (
                <button className="btn btn-primary" onClick={handlePayInvoiceInit} style={{ width: '100%' }}>
                  <CreditCard size={16} /> Pay Invoice Online
                </button>
              )}

              {doc.status === 'paid' && (
                <div style={{ padding: '0.85rem', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.25)', color: 'var(--accent-success)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={16} />
                  <span>Invoice fully settled.</span>
                </div>
              )}

              {doc.status === 'accepted' && (
                <div style={{ padding: '0.85rem', background: 'rgba(139, 92, 246, 0.08)', borderRadius: '10px', border: '1px solid rgba(139, 92, 246, 0.25)', color: 'hsl(262, 83%, 75%)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={16} />
                  <span>Quote accepted. An invoice will follow.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Razorpay Checkout Modal */}
      {showRzpModal && doc && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ width: '460px', background: '#0d101d', borderRadius: '16px', border: '2px solid var(--accent-primary)', overflow: 'hidden', boxShadow: 'var(--glow-shadow)', fontFamily: '"Outfit", sans-serif' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)', padding: '1.5rem', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Razorpay Checkout</h3>
                <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>Order: {doc.document_number}</span>
              </div>
              <ShieldCheck size={28} />
            </div>

            <div style={{ padding: '1.75rem' }}>
              {paymentSuccess ? (
                <div style={{ textAlign: 'center', padding: '1.5rem' }} className="fade-in">
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-success)', border: '2px solid var(--accent-success)', marginBottom: '1rem' }}>
                    <CheckCircle2 size={36} />
                  </div>
                  <h4 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: '0.25rem' }}>Payment Successful!</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Splits reconciled and ledger updated.</p>
                  <button className="btn btn-secondary" style={{ marginTop: '1.5rem', width: '100%' }} onClick={() => setShowRzpModal(false)}>
                    Close
                  </button>
                </div>
              ) : (
                <div className="fade-in">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Payable Amount:</span>
                    <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                      {currencySymbol}{parseFloat(doc.total_due).toFixed(2)}
                    </span>
                  </div>

                  <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <ArrowRightLeft size={14} /> Payout Splits (Razorpay Route)
                  </h4>

                  {splits.length === 0 ? (
                    <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Landmark size={14} /> Primary Bank</span>
                        <span>100% ({currencySymbol}{parseFloat(doc.total_due).toFixed(2)})</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                      {(() => {
                        const totalVendorShare = splits.reduce((acc, s) => acc + s.amount, 0);
                        const tenantShare = parseFloat(doc.total_due) - totalVendorShare;
                        return (
                          <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 600 }}>Tenant Account</span>
                            <span style={{ color: 'var(--accent-secondary)', fontWeight: 700 }}>{currencySymbol}{tenantShare.toFixed(2)}</span>
                          </div>
                        );
                      })()}
                      {splits.map((split, index) => (
                        <div key={index} style={{ padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span style={{ display: 'block', fontWeight: 600 }}>{split.vendorName}</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Platform fee: {currencySymbol}{split.platformFee.toFixed(2)}</span>
                          </div>
                          <span style={{ color: 'var(--accent-success)', fontWeight: 700 }}>{currencySymbol}{split.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '2rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowRzpModal(false)} style={{ flex: 1 }} disabled={isProcessing}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={handleConfirmPayment} style={{ flex: 2 }} disabled={isProcessing}>
                      {isProcessing ? 'Processing...' : 'Pay with Splits'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientPortal;
