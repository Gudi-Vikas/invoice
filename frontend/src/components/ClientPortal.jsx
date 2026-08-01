import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { CheckCircle2, ShieldCheck, CreditCard, FileCheck, Loader, Printer, Download } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { downloadElementAsPdf } from '../utils/pdfUtils';
import DocumentTemplate from './shared/DocumentTemplate';

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Offline Payment states
  const [offlineMethod, setOfflineMethod] = useState('upi');
  const [offlineReference, setOfflineReference] = useState('');
  const [offlineNotes, setOfflineNotes] = useState('');
  const [submittingOffline, setSubmittingOffline] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (!doc) return;
    setIsDownloadingPdf(true);
    try {
      const fileName = `${doc.type}_${doc.document_number || 'download'}.pdf`;
      await downloadElementAsPdf('print-area', fileName);
      showToast?.('PDF downloaded successfully!', 'success');
    } catch (err) {
      showToast?.('Failed to download PDF: ' + err.message, 'error');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

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

  const handleDeclineQuote = async () => {
    if (!doc || doc.type !== 'quote') return;
    setIsProcessing(true);
    setError('');
    try {
      await api.declineQuote(doc.id, token);
      setError('');
      showToast?.('Quotation declined successfully.', 'success');
      await loadDocument();
    } catch (err) {
      setError('Decline failed: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePayInvoiceInit = () => {
    if (!doc || doc.type !== 'invoice') return;
    setShowRzpModal(true);
  };

  const { showToast } = useToast();

  const handleConfirmPayment = async () => {
    setIsProcessing(true);
    setError('');
    try {
      // 1. Prepare payment order in backend
      const response = await api.initializePayment(doc.id, token);
      const paymentData = response.data;

      // 2. Check if mockMode is active
      if (paymentData.mockMode) {
        showToast?.('Developer Mock Mode: Simulating Razorpay payment...', 'info');
        setTimeout(async () => {
          try {
            // Call mock verification
            const verifyPayload = {
              token,
              razorpay_order_id: paymentData.orderId,
              razorpay_payment_id: `pay_mock_${Date.now()}`,
              razorpay_signature: 'mock_sig_123'
            };
            await api.verifyPortalPayment(doc.id, verifyPayload);
            setIsProcessing(false);
            setPaymentSuccess(true);
            showToast?.('Payment successful.', 'success');
            loadDocument();
          } catch (err) {
            setIsProcessing(false);
            setError('Verification failed: ' + err.message);
          }
        }, 1500);
        return;
      }

      // 3. Live Mode: Load Razorpay SDK script dynamically
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Razorpay SDK failed to load. Are you offline?');
      }

      // 4. Open Razorpay Checkout options
      const options = {
        key: paymentData.keyId,
        amount: Math.round(parseFloat(paymentData.amount) * 100), // in paise
        currency: paymentData.currency || 'INR',
        name: businessInfo?.businessName || 'Invoice SaaS',
        description: `Payment for Invoice #${paymentData.documentNumber}`,
        order_id: paymentData.orderId,
        handler: async (rzpResponse) => {
          setIsProcessing(true);
          try {
            const verifyPayload = {
              token,
              razorpay_order_id: rzpResponse.razorpay_order_id,
              razorpay_payment_id: rzpResponse.razorpay_payment_id,
              razorpay_signature: rzpResponse.razorpay_signature
            };
            await api.verifyPortalPayment(doc.id, verifyPayload);
            setPaymentSuccess(true);
            showToast?.('Payment successful.', 'success');
            loadDocument();
          } catch (err) {
            setError('Payment verification failed: ' + err.message);
          } finally {
            setIsProcessing(false);
          }
        },
        prefill: {
          email: doc.client_email || '',
          name: doc.client_name || ''
        },
        theme: {
          color: '#3b82f6'
        },
        modal: {
          escape: false,
          backdropclose: false,
          confirm_close: true,
          ondismiss: () => {
            setIsProcessing(false);
          }
        }
      };

      const rzpInstance = new window.Razorpay(options);
      rzpInstance.open();
    } catch (err) {
      setIsProcessing(false);
      setError('Payment failed: ' + err.message);
    }
  };

  const handleSubmitOfflinePayment = async (e) => {
    e.preventDefault();
    if (!offlineReference.trim()) {
      showToast?.('Please enter a valid Transaction Reference / UTR Number.', 'error');
      return;
    }
    setSubmittingOffline(true);
    setError('');
    try {
      await api.verifyOfflinePayment(doc.id, {
        token,
        paymentMethod: offlineMethod,
        transactionReference: offlineReference,
        notes: offlineNotes
      });
      showToast?.('Payment reference submitted successfully. Awaiting verification.', 'success');
      setOfflineReference('');
      setOfflineNotes('');
      await loadDocument();
    } catch (err) {
      setError('Offline submission failed: ' + err.message);
    } finally {
      setSubmittingOffline(false);
    }
  };

  const currencySymbol = doc?.tax_config?.currencySymbol || businessInfo?.currencySymbol || '₹';
  const passGatewayFees = doc?.payments_config?.passGatewayFees === true;
  const originalTotal = parseFloat(doc?.total_due || 0);
  let surcharge = 0;
  let surchargeTax = 0;
  let finalTotal = originalTotal;

  if (passGatewayFees) {
    surcharge = originalTotal * 0.02;
    surchargeTax = surcharge * 0.18;
    finalTotal = originalTotal + surcharge + surchargeTax;
  }

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
            <DocumentTemplate
              doc={doc}
              businessInfo={businessInfo}
              currencySymbol={currencySymbol}
              finalTotal={finalTotal}
              surcharge={surcharge}
              surchargeTax={surchargeTax}
              originalTotal={originalTotal}
              passGatewayFees={passGatewayFees}
              handleSubmitOfflinePayment={handleSubmitOfflinePayment}
              offlineMethod={offlineMethod}
              setOfflineMethod={setOfflineMethod}
              offlineReference={offlineReference}
              setOfflineReference={setOfflineReference}
              offlineNotes={offlineNotes}
              setOfflineNotes={setOfflineNotes}
              submittingOffline={submittingOffline}
            />

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
                <>
                  <button className="btn btn-primary" onClick={handleAcceptQuote} style={{ width: '100%' }} disabled={isProcessing}>
                    <FileCheck size={16} /> Accept Quotation
                  </button>
                  <button className="btn btn-danger" onClick={handleDeclineQuote} style={{ width: '100%', backgroundColor: 'var(--accent-danger)', borderColor: 'var(--accent-danger)', color: '#fff' }} disabled={isProcessing}>
                    <ShieldCheck size={16} /> Decline Quotation
                  </button>
                </>
              )}

              {doc.type === 'invoice' && (doc.status === 'published' || doc.status === 'sent') && doc.payments_config?.razorpayConnected && (
                <button className="btn btn-primary" onClick={handlePayInvoiceInit} style={{ width: '100%' }}>
                  <CreditCard size={16} /> Pay Invoice Online
                </button>
              )}

              {doc.status === 'pending_verification' && (
                <div style={{ padding: '0.85rem', background: 'rgba(245, 158, 11, 0.08)', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.25)', color: 'var(--accent-warning)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={16} />
                  <span>Payment verification pending.</span>
                </div>
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

              {doc.status === 'declined' && (
                <div style={{ padding: '0.85rem', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.25)', color: 'var(--accent-danger)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={16} />
                  <span>Quote declined.</span>
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf}
                style={{ width: '100%', gap: '0.5rem' }}
              >
                {isDownloadingPdf ? (
                  <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Generating PDF...</>
                ) : (
                  <><Download size={16} /> Download PDF</>
                )}
              </button>
              <button className="btn btn-secondary" onClick={() => window.print()} style={{ width: '100%', gap: '0.5rem' }}>
                <Printer size={16} /> Print
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Razorpay Checkout Modal */}
      {showRzpModal && doc && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '460px', padding: 0, overflow: 'hidden' }}>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Invoice Total:</span>
                      <span style={{ fontSize: '1.05rem', fontWeight: 600, color: '#fff' }}>
                        {currencySymbol}{originalTotal.toFixed(2)}
                      </span>
                    </div>
                    {passGatewayFees && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--accent-warning)' }}>
                        <span style={{ fontSize: '0.9rem' }}>Payment Gateway Fee (2% + GST):</span>
                        <span style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                          {currencySymbol}{(surcharge + surchargeTax).toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)', marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>Total Payable:</span>
                      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                        {currencySymbol}{finalTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '2rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowRzpModal(false)} style={{ flex: 1 }} disabled={isProcessing}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={handleConfirmPayment} style={{ flex: 2 }} disabled={isProcessing}>
                      {isProcessing ? 'Processing...' : 'Pay Now'}
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
