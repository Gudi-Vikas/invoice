import { useState, useEffect } from 'react';
import { ArrowLeft, Printer, Loader, CreditCard, Download } from 'lucide-react';
import { downloadElementAsPdf } from '../../utils/pdfUtils';
import { sanitizeHtmlContent } from '../../utils/sanitize';
import { getContrastColor } from '../../utils/colorUtils';
import api from '../../api';

export const PlatformInvoiceVisualizer = ({ 
  invoice, 
  tenantName, 
  onClose, 
  onPay, 
  isPaying, 
  showPayButton = false,
  businessInfo,
  invoiceConfig,
  taxConfig,
  hideTopBar = false
}) => {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [fetchedSettings, setFetchedSettings] = useState(null);

  useEffect(() => {
    if (!businessInfo && !invoiceConfig && !taxConfig) {
      api.masterGetSettings()
        .then(data => setFetchedSettings(data))
        .catch(err => console.error('Failed to load platform settings for visualizer:', err));
    }
  }, [businessInfo, invoiceConfig, taxConfig]);

  if (!invoice) return null;

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      const fileName = `platform_invoice_${invoice.invoice_number || 'download'}.pdf`;
      await downloadElementAsPdf('print-area', fileName);
    } catch (err) {
      console.error('PDF download error:', err);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const activeBusinessInfo = businessInfo || fetchedSettings?.business_info;
  const activeInvoiceConfig = invoiceConfig || fetchedSettings?.invoice_config;
  const activeTaxConfig = taxConfig || fetchedSettings?.tax_config;

  const themeColor = activeInvoiceConfig?.templateColor || '#7c3aed';
  const themeDesign = activeInvoiceConfig?.templateDesign || 'default';
  const contrastColor = getContrastColor(themeColor);
  const currencySymbol = activeTaxConfig?.currencySymbol || '₹';

  const bName = activeBusinessInfo?.businessName || 'Ultrakey IT Solutions Private Limited';
  const bAddress = activeBusinessInfo?.address || 'Flat No. 204, 2nd Floor, Cyber Residency,\nIndira Nagar, Gachibowli,\nHyderabad, Telangana, India-500032';
  const bEmail = activeBusinessInfo?.email || 'support@ultrakeyit.com';
  const bPhone = activeBusinessInfo?.phone;
  const bExtraInfo = activeBusinessInfo?.extraInfo || '<b>GST No:</b> 36AADCU5062A1ZO';
  const logoUrl = activeBusinessInfo?.logoUrl;

  return (
    <div>
      {/* Top Bar (Hidden when hideTopBar = true for live setting preview) */}
      {!hideTopBar && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            <ArrowLeft size={16} /> Back
          </button>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'uppercase' }}>
              Platform Invoice
            </span>
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
            
            {showPayButton && (
              <button 
                className="btn btn-primary"
                onClick={onPay}
                disabled={isPaying || invoice.status === 'paid'}
                style={{ background: invoice.status === 'paid' ? 'var(--accent-success)' : '', gap: '0.5rem' }}
              >
                {isPaying ? (
                  <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Processing...</>
                ) : invoice.status === 'paid' ? (
                  'Already Paid'
                ) : (
                  <><CreditCard size={15} /> Pay Online via Razorpay</>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Print-Only PDF Container */}
      <div id="print-area" className={`invoice-container theme-${themeDesign}`} style={{ '--theme-color': themeColor, '--theme-contrast': contrastColor, borderColor: themeColor }}>
        {/* Header */}
        <div className="invoice-header">
          <div className="invoice-logo-container">
            {logoUrl ? (
              <img 
                src={logoUrl} 
                alt={bName} 
                style={{ maxHeight: '60px', maxWidth: '220px', objectFit: 'contain' }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            ) : (
              <h2 className="invoice-logo-fallback" style={{ color: themeColor, fontSize: '1.75rem', fontWeight: '800' }}>
                {bName.split(' ')[0] || 'Ultrakey'}
              </h2>
            )}
          </div>
          <div className="invoice-title-banner">
            Subscription Tax Invoice
          </div>
        </div>

        {/* Mid Section */}
        <div className="invoice-mid-section">
          {/* Left Column: From and To Addresses */}
          <div className="invoice-left-col">
            <div className="invoice-address-block">
              <div className="invoice-address-header">Billed By:</div>
              <div className="invoice-address-body">
                <p><b>{bName}</b></p>
                {bAddress.split('\n').map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
                {bEmail && <p>{bEmail}</p>}
                {bPhone && <p>{bPhone}</p>}
                {bExtraInfo && (
                  <div 
                    style={{ marginTop: '0.35rem' }}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtmlContent(bExtraInfo) }} 
                  />
                )}
              </div>
            </div>

            <div className="invoice-address-block">
              <div className="invoice-address-header">Billed To:</div>
              <div className="invoice-address-body">
                <p><b>{tenantName || 'Tenant Organization'}</b></p>
                <p>Platform Tenant</p>
              </div>
            </div>
          </div>

          {/* Right Column: Meta */}
          <div className="invoice-right-col">
            <div className="invoice-meta-list">
              <span><b>Invoice Number</b></span>
              <span>{invoice.invoice_number}</span>
              
              <span><b>Invoice Date</b></span>
              <span>{new Date(invoice.created_at).toLocaleDateString()}</span>
              
              <span><b>Due Date</b></span>
              <span>{new Date(invoice.due_date).toLocaleDateString()}</span>
            </div>

            <div className="invoice-total-due-banner">
              <span>TOTAL DUE</span>
              <span>{currencySymbol}{parseFloat(invoice.total_amount).toFixed(2)}</span>
            </div>

            <div className="invoice-payment-terms">
              {invoice.status === 'paid' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent-success)', fontWeight: 700, fontSize: '1.1rem' }}>
                    PAID on {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString() : 'N/A'}
                  </span>
                  {invoice.razorpay_payment_id && (
                    <div style={{ 
                      backgroundColor: '#ffffff', 
                      color: '#000000', 
                      padding: '0.4rem 0.75rem', 
                      borderRadius: '6px', 
                      border: '1px solid #cbd5e1',
                      fontSize: '1rem',
                      fontWeight: 500
                    }}>
                      Ref/UTR: <strong style={{ color: '#000000', fontWeight: 800 }}>{invoice.razorpay_payment_id}</strong>
                    </div>
                  )}
                </div>
              ) : (
                activeInvoiceConfig?.termsAndConditions || 'Payment is due upon receipt. Late payments may result in workspace suspension.'
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <table className="invoice-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>QTY</th>
              <th style={{ textAlign: 'left' }}>DESCRIPTION</th>
              <th style={{ textAlign: 'right' }}>RATE</th>
              <th style={{ textAlign: 'right' }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ textAlign: 'left', verticalAlign: 'top' }}>1</td>
              <td style={{ textAlign: 'left', verticalAlign: 'top' }}>
                <span className="invoice-item-desc">
                  SaaS Subscription - {invoice.plan_name || 'Custom Plan'}
                </span>
                <span className="invoice-item-subdesc">
                  Billing Period: {new Date(invoice.billing_period_start).toLocaleDateString()} to {new Date(invoice.billing_period_end).toLocaleDateString()}
                </span>
              </td>
              <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                {currencySymbol}{parseFloat(invoice.amount).toFixed(2)}
              </td>
              <td style={{ textAlign: 'right', verticalAlign: 'top', fontWeight: 600 }}>
                {currencySymbol}{parseFloat(invoice.amount).toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Bottom section */}
        <div className="invoice-bottom-section">
          {/* Notes */}
          <div className="invoice-bank-details-box">
            <h4 style={{ color: themeColor }}>Notes</h4>
            {invoice.notes || activeInvoiceConfig?.footerNotes ? (
              <p style={{ color: '#334155', margin: 0, whiteSpace: 'pre-wrap' }}>
                {invoice.notes || activeInvoiceConfig?.footerNotes}
              </p>
            ) : (
              <p style={{ color: '#334155', margin: 0, fontStyle: 'italic' }}>Thank you for your business!</p>
            )}
          </div>

          {/* Totals */}
          <div className="invoice-totals-box">
            <div className="invoice-totals-row">
              <span>Subtotal</span>
              <span>{currencySymbol}{parseFloat(invoice.amount).toFixed(2)}</span>
            </div>
            <div className="invoice-totals-row">
              <span>Tax ({parseFloat(invoice.tax_percentage)}%)</span>
              <span>{currencySymbol}{parseFloat(invoice.tax_amount).toFixed(2)}</span>
            </div>
            <div className="invoice-totals-row grand-total" style={{ borderTop: `2px solid ${themeColor}`, color: themeColor }}>
              <span>Total Amount</span>
              <span>{currencySymbol}{parseFloat(invoice.total_amount).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlatformInvoiceVisualizer;
