import { ShieldCheck } from 'lucide-react';
import { getContrastColor } from '../../utils/colorUtils';

export const DocumentTemplate = ({
  doc,
  businessInfo,
  currencySymbol = '₹',
  finalTotal = 0,
  surcharge = 0,
  surchargeTax = 0,
  originalTotal = 0,
  passGatewayFees = false,
  
  // Offline Payment Props (used in ClientPortal)
  handleSubmitOfflinePayment,
  offlineMethod,
  setOfflineMethod,
  offlineReference,
  setOfflineReference,
  offlineNotes,
  setOfflineNotes,
  submittingOffline,

  // Theme & Color overrides (for live preview)
  previewTheme,
  previewColor
}) => {
  if (!doc) return null;

  // Resolve design choices
  const configKey = doc.type === 'quote' ? 'quote' : 'invoice';
  const config = doc.invoice_config?.[configKey] || {};
  
  const theme = previewTheme || config.templateDesign || 'default';
  const color = previewColor || config.templateColor || '#234a75';
  const contrastColor = getContrastColor(color);

  return (
    <div id="print-area" className={`invoice-container theme-${theme}`} style={{ '--doc-accent': color, '--doc-contrast': contrastColor }}>
      {/* Header */}
      <div className="invoice-header">
        <div className="invoice-logo-container">
          {businessInfo?.logoUrl && (
            <img src={businessInfo.logoUrl} alt="Logo" className="invoice-logo" />
          )}
          <h2 className="invoice-logo-fallback">
            {businessInfo?.businessName || 'Ultrakey'}
          </h2>
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
              {(doc.billing_address?.street || doc.billing_address?.city) && (
                <>
                  {doc.billing_address.street && <p>{doc.billing_address.street}</p>}
                  {(doc.billing_address.city || doc.billing_address.state || doc.billing_address.zip) && (
                    <p>
                      {[doc.billing_address.city, doc.billing_address.state].filter(Boolean).join(', ')} {doc.billing_address.zip || ''}
                    </p>
                  )}
                </>
              )}
              {doc.client_email && <p>{doc.client_email}</p>}
              {doc.client_extra_info && (
                <div dangerouslySetInnerHTML={{ __html: doc.client_extra_info }} />
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Invoice metadata and payment terms */}
        <div className="invoice-right-col">
          <div className="invoice-meta-list">
            <span><b>{doc.type === 'quote' ? 'Quote Number' : 'Invoice Number'}</b></span>
            <span>{doc.document_number}</span>
            
            <span><b>{doc.type === 'quote' ? 'Quote Date' : 'Invoice Date'}</b></span>
            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
            
            <span><b>{doc.type === 'quote' ? 'Valid Until' : 'Due Date'}</b></span>
            <span>{new Date(doc.due_date).toLocaleDateString()}</span>
          </div>

          <div className="invoice-total-due-banner">
            <span>TOTAL DUE</span>
            <span>{currencySymbol}{(doc.status === 'paid' ? 0 : finalTotal || parseFloat(doc.total_due || 0)).toFixed(2)}</span>
          </div>

          <div className="invoice-payment-terms">
            {doc.status === 'paid' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--accent-success)', fontWeight: 700, fontSize: '1.1rem' }}>
                  PAID
                </span>
                {doc.offline_payment_info?.reference && (
                  <div style={{ 
                    backgroundColor: '#ffffff', 
                    color: '#000000', 
                    padding: '0.4rem 0.75rem', 
                    borderRadius: '6px', 
                    border: '1px solid #cbd5e1',
                    fontSize: '1rem',
                    fontWeight: 500
                  }}>
                    Ref/UTR: <strong style={{ color: '#000000', fontWeight: 800 }}>{doc.offline_payment_info.reference}</strong>
                  </div>
                )}
                {doc.razorpay_payment_id && !doc.offline_payment_info?.reference && (
                  <div style={{ 
                    backgroundColor: '#ffffff', 
                    color: '#000000', 
                    padding: '0.4rem 0.75rem', 
                    borderRadius: '6px', 
                    border: '1px solid #cbd5e1',
                    fontSize: '1rem',
                    fontWeight: 500
                  }}>
                    Ref: <strong style={{ color: '#000000', fontWeight: 800 }}>{doc.razorpay_payment_id}</strong>
                  </div>
                )}
              </div>
            ) : (
              config.termsAndConditions || (doc.type === 'quote' ? 'Quotation valid for 30 days.' : 'Payment is due within 14 days from date of invoice. Late payment is subject to fees of 5% per month.')
            )}
          </div>

          {doc.type === 'invoice' && (
            <div className="invoice-payment-methods">
              <h4>Payment Methods:</h4>
              <ol>
                <li>60% Advance Payment</li>
                <li>Remaining 40% Final Settlement</li>
              </ol>
            </div>
          )}
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
                <span className="invoice-item-desc">{line.title || line.description}</span>
                {line.title && line.description && (
                  <span className="invoice-item-subdesc">{line.description}</span>
                )}
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

          const computedFinalTotal = finalTotal || parseFloat(doc.total_due || 0);
          const upiUrl = upiId ? `upi://pay?pa=${upiId}&pn=${encodeURIComponent(businessInfo?.businessName || 'Merchant')}&am=${computedFinalTotal.toFixed(2)}&cu=INR&tr=${doc.document_number}` : '';
          const upiQrImageUrl = upiUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiUrl)}` : '';
          
          const isPendingVerification = doc.status === 'pending_verification';

          return (
            <div className="invoice-bank-details-box" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {hasGPay && (
                <div className="invoice-bank-option" style={{ paddingBottom: '1rem', borderBottom: (hasBankDetails || hasUpi || bankDetailsText) ? '1px solid var(--border-color)' : 'none' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--doc-accent)' }}>Option 1: GPay / PhonePe</h4>
                  <p style={{ color: '#334155', fontSize: '0.85rem', margin: 0 }}>
                    Number: <strong style={{ color: '#1e293b' }}>{gpayNumber}</strong>
                  </p>
                </div>
              )}

              {hasBankDetails && (
                <div className="invoice-bank-option" style={{ paddingBottom: '1rem', borderBottom: (hasUpi || bankDetailsText) ? '1px solid var(--border-color)' : 'none' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--doc-accent)' }}>Option 2: Direct Bank Transfer</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.3rem 0.5rem', fontSize: '0.85rem', color: '#334155' }}>
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
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--doc-accent)' }}>Option 3: Pay via UPI QR Code</h4>
                    <p style={{ color: '#334155', fontSize: '0.8rem', marginBottom: '0.5rem', margin: 0 }}>UPI ID: <strong style={{ color: '#1e293b' }}>{upiId}</strong></p>
                    <p style={{ color: '#334155', fontSize: '0.8rem', lineHeight: '1.4', margin: '0.5rem 0 0 0' }}>
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
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--doc-accent)' }}>Additional Payment Instructions</h4>
                  <div style={{ whiteSpace: 'pre-wrap', color: '#334155', fontSize: '0.85rem' }}>{bankDetailsText}</div>
                </div>
              )}

              {!hasBankDetails && !hasGPay && !hasUpi && !bankDetailsText && (
                <div className="invoice-bank-option">
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--doc-accent)' }}>Payment Instructions</h4>
                  <p style={{ color: '#334155', fontSize: '0.85rem' }}>No offline payment instructions configured by merchant.</p>
                </div>
              )}

              {handleSubmitOfflinePayment && doc.status !== 'paid' && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
                  {isPendingVerification ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: '10px', padding: '1rem' }}>
                      <h5 style={{ color: 'var(--accent-warning)', fontSize: '0.9rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                        <ShieldCheck size={16} /> Awaiting Verification
                      </h5>
                      <p style={{ color: '#334155', fontSize: '0.8rem', margin: 0 }}>
                        You submitted payment proof (Ref: <strong>{doc.offline_payment_info?.reference}</strong> via {doc.offline_payment_info?.method === 'bank_transfer' ? 'Bank Transfer' : 'UPI'}). The merchant is reviewing your payment.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmitOfflinePayment} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h5 style={{ color: 'var(--doc-accent)', fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Confirm Offline Payment</h5>
                      <p style={{ color: '#334155', fontSize: '0.8rem', margin: 0 }}>
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
          
          const computedOriginalTotal = originalTotal || parseFloat(doc.total_due || 0);
          const computedFinalTotal = finalTotal || computedOriginalTotal;
          const paidAmount = doc.status === 'paid' ? computedFinalTotal : 0;
          const remainingDue = doc.status === 'paid' ? 0 : computedFinalTotal;

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
                    <span>{currencySymbol}{computedOriginalTotal.toFixed(2)}</span>
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
        {config.footerNotes || `Thanks for choosing ${businessInfo?.businessName || 'Ultrakey IT Solutions Pvt. Ltd.'} | ${businessInfo?.email || 'support@ultrakeyit.com'} | ${businessInfo?.website || '+91 6300440316'}`}
      </div>
    </div>
  );
};

export default DocumentTemplate;
