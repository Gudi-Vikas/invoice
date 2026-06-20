import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { CheckCircle2, ShieldCheck, CreditCard, FileCheck, Loader, Printer } from 'lucide-react';
import { useToast } from '../context/ToastContext';

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
            <div id="print-area" className="invoice-container">
              {/* Header */}
              <div className="invoice-header">
                <div className="invoice-logo-container">
                  {businessInfo?.logoUrl ? (
                    <img src={businessInfo.logoUrl} alt="Logo" className="invoice-logo" />
                  ) : (
                    <h2 className="invoice-logo-fallback">
                      {businessInfo?.businessName || 'Ultrakey'}
                    </h2>
                  )}
                </div>
                <div className="invoice-title-banner">
                  {doc.type === 'quote' ? 'Quotation' : 'Invoice'}
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
                      <p><b>{businessInfo?.businessName || 'Ultrakey IT Solutions Private Limited'}</b></p>
                      {businessInfo?.address ? (
                        businessInfo.address.split('\n').map((line, i) => <p key={i}>{line}</p>)
                      ) : (
                        <>
                          <p>Flat No. 204, 2nd Floor, Cyber Residency,</p>
                          <p>Inidra Nagar, Gachibowli,</p>
                          <p>Hyderabad, Telangana, India-500032</p>
                        </>
                      )}
                      <p>{businessInfo?.email || 'support@ultrakeyit.com'}</p>
                      {businessInfo?.extraInfo ? (
                        <div dangerouslySetInnerHTML={{ __html: businessInfo?.extraInfo || '' }} />
                      ) : (
                        <p><b>GST No:</b> 36AADCU5062A1ZO</p>
                      )}
                    </div>
                  </div>

                  {/* To Address */}
                  <div className="invoice-address-block">
                    <div className="invoice-address-header">To:</div>
                    <div className="invoice-address-body">
                      <p><b>{doc.client_name}</b></p>
                      {doc.billing_address?.street ? (
                        <>
                          <p>{doc.billing_address.street}</p>
                          <p>{doc.billing_address.city}, {doc.billing_address.state} {doc.billing_address.zip}</p>
                        </>
                      ) : (
                        <>
                          <p>Flat No. 204, 2nd Floor, Cyber Residency,</p>
                          <p>Inidra Nagar, Gachibowli,</p>
                          <p>Hyderabad, Telangana, India-500032</p>
                        </>
                      )}
                      <p>{doc.client_email}</p>
                      {doc.client_extra_info ? (
                        <div dangerouslySetInnerHTML={{ __html: doc.client_extra_info }} />
                      ) : (
                        <p><b>GST No:</b> 36AADCU5062A1ZO</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Invoice metadata and payment terms */}
                <div className="invoice-right-col">
                  <div className="invoice-meta-list">
                    <span><b>Invoice Number</b></span>
                    <span>{doc.document_number}</span>
                    
                    <span><b>Invoice Date</b></span>
                    <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                    
                    <span><b>Due Date</b></span>
                    <span>{new Date(doc.due_date).toLocaleDateString()}</span>
                  </div>

                  <div className="invoice-total-due-banner">
                    <span>TOTAL DUE</span>
                    <span>{currencySymbol}{parseFloat(doc.total_due).toFixed(2)}</span>
                  </div>

                  <div className="invoice-payment-terms">
                    {doc.type === 'quote'
                      ? (doc.invoice_config?.quote?.termsAndConditions || 'Quotation valid for 30 days.')
                      : (doc.invoice_config?.invoice?.termsAndConditions || 'Payment is due within 14 days from date of invoice. Late payment is subject to fees of 5% per month.')}
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
                  {doc.lines?.map((line, index) => (
                    <tr key={index}>
                      <td style={{ textAlign: 'left', verticalAlign: 'top' }}>{parseFloat(line.quantity)}</td>
                      <td style={{ textAlign: 'left', verticalAlign: 'top' }}>
                        <span className="invoice-item-desc">{line.description}</span>
                        <span className="invoice-item-subdesc">{line.description}</span>
                        {line.vendor_name && (
                          <span className="invoice-item-subdesc" style={{ marginTop: '0.25rem' }}>
                            Fulfilled by: {line.vendor_name}
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
                 {doc.type !== 'quote' ? (() => {
                  const pConfig = doc.payments_config || {};
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

                  const upiUrl = upiId ? `upi://pay?pa=${upiId}&pn=${encodeURIComponent(businessInfo?.businessName || 'Merchant')}&am=${finalTotal.toFixed(2)}&cu=INR&tr=${doc.document_number}` : '';
                  const upiQrImageUrl = upiUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiUrl)}` : '';
                  
                  const isPendingVerification = doc.status === 'pending_verification';

                  return (
                    <div className="invoice-bank-details-box" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      {hasGPay && (
                        <div className="invoice-bank-option" style={{ paddingBottom: '1rem', borderBottom: (hasBankDetails || hasUpi || bankDetailsText) ? '1px solid var(--border-color)' : 'none' }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem', color: '#234a75' }}>Option 1: GPay / PhonePe</h4>
                          <p style={{ color: '#475569', fontSize: '0.85rem', margin: 0 }}>
                            Number: <strong style={{ color: '#1e293b' }}>{gpayNumber}</strong>
                          </p>
                        </div>
                      )}

                      {hasBankDetails && (
                        <div className="invoice-bank-option" style={{ paddingBottom: '1rem', borderBottom: (hasUpi || bankDetailsText) ? '1px solid var(--border-color)' : 'none' }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem', color: '#234a75' }}>Option 2: Direct Bank Transfer</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.3rem 0.5rem', fontSize: '0.85rem', color: '#475569' }}>
                            {bankAccountNumber && (
                              <><span>Account Number:</span><strong style={{ color: '#1e293b' }}>{bankAccountNumber}</strong></>
                            )}
                            {bankAccountName && (
                              <><span>Account Name:</span><strong style={{ color: '#1e293b' }}>{bankAccountName}</strong></>
                            )}
                            {bankName && (
                              <><span>Bank Name:</span><strong style={{ color: '#1e293b' }}>{bankName}</strong></>
                            )}
                            {bankIfsc && (
                              <><span>IFSC Code:</span><strong style={{ color: '#1e293b' }}>{bankIfsc}</strong></>
                            )}
                            {bankBranch && (
                              <><span>Branch:</span><strong style={{ color: '#1e293b' }}>{bankBranch}</strong></>
                            )}
                          </div>
                        </div>
                      )}

                      {hasUpi && (
                        <div className="invoice-bank-option" style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', paddingBottom: bankDetailsText ? '1rem' : '0', borderBottom: bankDetailsText ? '1px solid var(--border-color)' : 'none' }}>
                          <div style={{ flex: 1 }}>
                            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem', color: '#234a75' }}>Option 3: Pay via UPI QR Code</h4>
                            <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.5rem', margin: 0 }}>UPI ID: <strong style={{ color: '#1e293b' }}>{upiId}</strong></p>
                            <p style={{ color: '#475569', fontSize: '0.8rem', lineHeight: '1.4', margin: '0.5rem 0 0 0' }}>
                              Scan the QR code with any UPI app (GPay, PhonePe, Paytm) to make an instant direct transfer.
                            </p>
                          </div>
                          {upiQrImageUrl && (
                            <div style={{ background: '#fff', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'inline-block' }}>
                              <img src={upiQrImageUrl} alt="UPI QR Code" style={{ width: '120px', height: '120px', display: 'block' }} />
                            </div>
                          )}
                        </div>
                      )}

                      {bankDetailsText && (
                        <div className="invoice-bank-option">
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem', color: '#234a75' }}>Additional Payment Instructions</h4>
                          <div style={{ whiteSpace: 'pre-wrap', color: '#475569', fontSize: '0.85rem' }}>{bankDetailsText}</div>
                        </div>
                      )}

                      {!hasBankDetails && !hasGPay && !hasUpi && !bankDetailsText && (
                        <div className="invoice-bank-option">
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem', color: '#234a75' }}>Payment Instructions</h4>
                          <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No offline payment instructions configured by merchant.</p>
                        </div>
                      )}

                      {doc.status !== 'paid' && (
                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
                          {isPendingVerification ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: '10px', padding: '1rem' }}>
                              <h5 style={{ color: 'var(--accent-warning)', fontSize: '0.9rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                                <ShieldCheck size={16} /> Awaiting Verification
                              </h5>
                              <p style={{ color: '#475569', fontSize: '0.8rem', margin: 0 }}>
                                You submitted payment proof (Ref: <strong>{doc.offline_payment_info?.reference}</strong> via {doc.offline_payment_info?.method === 'bank_transfer' ? 'Bank Transfer' : 'UPI'}). The merchant is reviewing your payment.
                              </p>
                            </div>
                          ) : (
                            <form onSubmit={handleSubmitOfflinePayment} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              <h5 style={{ color: '#234a75', fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Confirm Offline Payment</h5>
                              <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>
                                Transferred funds via Bank or UPI? Submit the reference UTR number below to notify the merchant.
                              </p>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <select 
                                  className="form-select" 
                                  value={offlineMethod} 
                                  onChange={e => setOfflineMethod(e.target.value)}
                                  style={{ width: '130px', padding: '0.4rem 0.5rem', fontSize: '0.85rem', color: 'inherit', backgroundColor: '#fff', border: '1px solid #cbd5e1' }}
                                >
                                  <option value="upi">UPI Transfer</option>
                                  <option value="bank_transfer">Bank Transfer</option>
                                </select>
                                <input 
                                  type="text" 
                                  className="form-input" 
                                  placeholder="UTR / Transaction Ref Number" 
                                  value={offlineReference}
                                  onChange={e => setOfflineReference(e.target.value)}
                                  required
                                  style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: 'inherit', backgroundColor: '#fff', border: '1px solid #cbd5e1' }}
                                />
                              </div>
                              <textarea 
                                className="form-textarea"
                                placeholder="Additional notes for the merchant (optional)..."
                                value={offlineNotes}
                                onChange={e => setOfflineNotes(e.target.value)}
                                style={{ height: '45px', padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: 'inherit', backgroundColor: '#fff', border: '1px solid #cbd5e1' }}
                              />
                              <button 
                                type="submit" 
                                className="btn btn-secondary" 
                                disabled={submittingOffline}
                                style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', width: '100%', justifySelf: 'flex-end', color: '#1e293b', backgroundColor: '#e2e8f0', borderColor: '#cbd5e1' }}
                              >
                                {submittingOffline ? 'Submitting Reference...' : 'Submit Payment Reference'}
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })() : <div></div>}

                {/* Right Column: Summary totals */}
                {(() => {
                  const subTotal = parseFloat(doc.sub_total);
                  const discount = parseFloat(doc.discount_amount || 0);
                  const tax = parseFloat(doc.tax_amount);
                  
                  const paidAmount = doc.status === 'paid' ? finalTotal : 0;
                  const remainingDue = doc.status === 'paid' ? 0 : finalTotal;

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
                        <span>Tax ({doc.tax_config?.defaultTaxPercentage || 18}%)</span>
                        <span>{currencySymbol}{tax.toFixed(2)}</span>
                      </div>
                      {passGatewayFees && (
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
                Thanks for choosing {businessInfo?.businessName || 'Ultrakey IT Solutions Pvt. Ltd.'} | {businessInfo?.email || 'support@ultrakeyit.com'} | {businessInfo?.website || '+91 6300440316'}
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

              <button className="btn btn-secondary" onClick={() => window.print()} style={{ width: '100%', gap: '0.5rem' }}>
                <Printer size={16} /> Print / Download PDF
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
