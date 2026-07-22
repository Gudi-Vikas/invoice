import { useState } from 'react';
import { ArrowLeft, Printer, Loader, CreditCard, Download } from 'lucide-react';
import { downloadElementAsPdf } from '../../utils/pdfUtils';

export const PlatformInvoiceVisualizer = ({ 
  invoice, 
  tenantName, 
  onClose, 
  onPay, 
  isPaying, 
  showPayButton = false 
}) => {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

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

  return (
    <div>
      {/* Top Bar */}
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
          
          {showPayButton && (invoice.status === 'pending' || invoice.status === 'overdue') && (
            <button
              className="btn btn-primary"
              onClick={onPay}
              disabled={isPaying}
              style={{ gap: '0.5rem' }}
            >
              {isPaying ? (
                <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Processing...</>
              ) : (
                <><CreditCard size={15} /> Pay Online via Razorpay</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Print-Only PDF Container */}
      <div id="print-area" className="invoice-container">
        {/* Header */}
        <div className="invoice-header">
          <div className="invoice-logo-container">
            <h2 className="invoice-logo-fallback" style={{ color: '#fff', fontSize: '1.75rem', fontWeight: '800' }}>
              Ultrakey
            </h2>
          </div>
          <div className="invoice-title-banner" style={{ background: '#7c3aed', color: '#fff' }}>
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
                <p><b>Ultrakey IT Solutions Private Limited</b></p>
                <p>Flat No. 204, 2nd Floor, Cyber Residency,</p>
                <p>Indira Nagar, Gachibowli,</p>
                <p>Hyderabad, Telangana, India-500032</p>
                <p>support@ultrakeyit.com</p>
                <p><b>GST No:</b> 36AADCU5062A1ZO</p>
              </div>
            </div>

            <div className="invoice-address-block">
              <div className="invoice-address-header">Billed To:</div>
              <div className="invoice-address-body">
                <p><b>{tenantName}</b></p>
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

            <div className="invoice-total-due-banner" style={{ borderLeft: '4px solid #7c3aed' }}>
              <span>TOTAL DUE</span>
              <span>₹{parseFloat(invoice.total_amount).toFixed(2)}</span>
            </div>

            <div className="invoice-payment-terms">
              {invoice.status === 'paid' ? (
                <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}>
                  PAID on {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString() : 'N/A'}
                </span>
              ) : (
                'Payment is due upon receipt. Late payments may result in workspace suspension.'
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <table className="invoice-table">
          <thead>
            <tr style={{ background: '#7c3aed', color: '#fff' }}>
              <th style={{ textAlign: 'left', color: '#fff' }}>QTY</th>
              <th style={{ textAlign: 'left', color: '#fff' }}>DESCRIPTION</th>
              <th style={{ textAlign: 'right', color: '#fff' }}>RATE</th>
              <th style={{ textAlign: 'right', color: '#fff' }}>AMOUNT</th>
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
                ₹{parseFloat(invoice.amount).toFixed(2)}
              </td>
              <td style={{ textAlign: 'right', verticalAlign: 'top', fontWeight: 600 }}>
                ₹{parseFloat(invoice.amount).toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Bottom section */}
        <div className="invoice-bottom-section">
          {/* Notes */}
          <div className="invoice-bank-details-box">
            <h4>Notes</h4>
            {invoice.notes ? (
              <p style={{ color: '#475569', margin: 0, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
            ) : (
              <p style={{ color: '#64748b', margin: 0, fontStyle: 'italic' }}>Thank you for your business!</p>
            )}
          </div>

          {/* Totals */}
          <div className="invoice-totals-box">
            <div className="invoice-totals-row">
              <span>Subtotal</span>
              <span>₹{parseFloat(invoice.amount).toFixed(2)}</span>
            </div>
            <div className="invoice-totals-row">
              <span>Tax ({parseFloat(invoice.tax_percentage)}%)</span>
              <span>₹{parseFloat(invoice.tax_amount).toFixed(2)}</span>
            </div>
            <div className="invoice-totals-row grand-total" style={{ borderTop: '2px solid #7c3aed', color: '#7c3aed' }}>
              <span>Total Amount</span>
              <span>₹{parseFloat(invoice.total_amount).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlatformInvoiceVisualizer;
