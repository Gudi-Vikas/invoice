/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { UserPlus, FileCheck, CheckCircle2, ShieldAlert, AlertTriangle, Trash2, X, Wallet } from 'lucide-react';

/**
 * Marketplace Vendor Management & KYC Panel.
 */
export const Vendors = () => {
  const { showToast } = useToast();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Registration Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [bizName, setBizName] = useState('');
  const [email, setEmail] = useState('');
  const [feePercent, setFeePercent] = useState(5.00);
  const [creatingVendor, setCreatingVendor] = useState(false);

  // KYC Form modal inline
  const [kycVendorId, setKycVendorId] = useState(null);
  const [holderName, setHolderName] = useState('');
  const [holderPan, setHolderPan] = useState('');
  const [holderAddress, setHolderAddress] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [submittingKyc, setSubmittingKyc] = useState(false);

  // Details Modal
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Payout Form Modal
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [processingPayout, setProcessingPayout] = useState(false);

  const loadVendors = useCallback(async () => {
    try {
      const data = await api.getVendors();
      setVendors(data || []);
      setLoading(false);
    } catch (err) {
      showToast('Failed to load vendors: ' + err.message, 'error');
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadVendors();

    // Check query params for OAuth success/error feedback
    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get('oauth');
    if (oauthStatus === 'success') {
      showToast('Razorpay Route account connected successfully via OAuth!', 'success');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (oauthStatus === 'error') {
      const msg = params.get('message') || 'Unknown error occurred';
      showToast('OAuth connection failed: ' + msg, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [loadVendors, showToast]);

  const handleAddVendor = async (e) => {
    e.preventDefault();
    if (!bizName || !email || creatingVendor) return;

    setCreatingVendor(true);
    try {
      await api.createVendor({
        businessName: bizName,
        email,
        platformFeePercentage: parseFloat(feePercent)
      });
      setBizName('');
      setEmail('');
      setFeePercent(5.00);
      setShowAddForm(false);
      showToast('Vendor registered successfully.', 'success');
      loadVendors();
    } catch (err) {
      showToast('Failed to register vendor: ' + err.message, 'error');
    } finally {
      setCreatingVendor(false);
    }
  };

  const handleKycSubmit = async (e) => {
    e.preventDefault();
    if (!kycVendorId || !holderName || !bankAccount || submittingKyc) return;

    setSubmittingKyc(true);
    try {
      await api.submitKyc(kycVendorId, {
        stakeholder: {
          name: holderName,
          email: 'signatory@company.com',
          pan: holderPan,
          address: { street: holderAddress, city: 'Hyderabad', state: 'Telangana', country: 'India', zip: '500032' }
        },
        bankDetails: {
          ifsc: bankIfsc,
          accountNumber: bankAccount,
          beneficiaryName: holderName
        }
      });

      setKycVendorId(null);
      setHolderName('');
      setHolderPan('');
      setHolderAddress('');
      setBankIfsc('');
      setBankAccount('');
      showToast('KYC submitted successfully.', 'success');
      loadVendors();
    } catch (err) {
      showToast('Failed to submit KYC data: ' + err.message, 'error');
    } finally {
      setSubmittingKyc(false);
    }
  };

  const handleOAuthConnect = async (vendorId) => {
    try {
      const res = await api.getVendorOAuthUrl(vendorId);
      if (res.authorizeUrl) {
        window.location.assign(res.authorizeUrl);
      } else {
        showToast('OAuth URL could not be retrieved.', 'error');
      }
    } catch (err) {
      showToast('OAuth flow initialization failed: ' + err.message, 'error');
    }
  };

  const openDetails = async (vendor) => {
    setSelectedVendor(vendor);
    setLoadingDetails(true);
    setTransfers([]);
    setBalance(0);
    try {
      const [transfersData, balanceData] = await Promise.all([
        api.getVendorTransfers(vendor.id),
        api.getVendorBalance(vendor.id)
      ]);
      setTransfers(transfersData || []);
      setBalance(balanceData?.balance || 0);
    } catch (err) {
      showToast('Failed to load vendor financial reports: ' + err.message, 'error');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDeleteVendor = async (vendorId) => {
    if (!window.confirm('Are you sure you want to remove this vendor? This action cannot be undone.')) return;
    try {
      await api.deleteVendor(vendorId);
      showToast('Vendor deleted successfully.', 'success');
      setSelectedVendor(null);
      loadVendors();
    } catch (err) {
      showToast('Failed to delete vendor: ' + err.message, 'error');
    }
  };

  const handlePayoutSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVendor || !payoutAmount) return;

    const amt = parseFloat(payoutAmount);
    if (isNaN(amt) || amt <= 0 || amt > balance) {
      showToast('Invalid payout amount.', 'error');
      return;
    }

    setProcessingPayout(true);
    try {
      await api.payoutVendor(selectedVendor.id, amt);
      showToast(`Payout of ₹${amt.toFixed(2)} processed successfully.`, 'success');
      setShowPayoutModal(false);
      setPayoutAmount('');
      
      // Refresh details and summary reports
      const [transfersData, balanceData] = await Promise.all([
        api.getVendorTransfers(selectedVendor.id),
        api.getVendorBalance(selectedVendor.id)
      ]);
      setTransfers(transfersData || []);
      setBalance(balanceData?.balance || 0);
      loadVendors();
    } catch (err) {
      showToast('Failed to process payout: ' + err.message, 'error');
    } finally {
      setProcessingPayout(false);
    }
  };

  if (loading) {
    return <p style={{ color: 'var(--text-secondary)' }}>Loading marketplace vendors...</p>;
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Marketplace Vendors Hub</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Onboard external sellers, check KYC status, and adjust platform commission splits.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
          <UserPlus size={16} /> Add New Vendor
        </button>
      </div>

      {/* Grid List */}
      <div className="vendors-grid">
        {vendors.map(v => {
          let statusColor = 'var(--text-muted)';
          let StatusIcon = ShieldAlert;
          if (v.kyc_status === 'active') {
            statusColor = 'var(--accent-success)';
            StatusIcon = CheckCircle2;
          } else if (v.kyc_status === 'under_review') {
            statusColor = 'var(--accent-primary)';
            StatusIcon = FileCheck;
          } else if (v.kyc_status === 'needs_clarification') {
            statusColor = 'var(--accent-warning)';
            StatusIcon = AlertTriangle;
          }

          return (
            <div key={v.id} className="glass-card vendor-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.15rem', color: '#fff', fontWeight: 700 }}>{v.business_name}</h3>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.08)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                    Fee: {v.platform_fee_percentage}%
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', wordBreak: 'break-all' }}><b>Email:</b> {v.email}</p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', wordBreak: 'break-all' }}><b>Linked Acc:</b> <code style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{v.razorpay_account_id}</code></p>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: statusColor }}>
                  <StatusIcon size={16} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                    {v.kyc_status}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {v.kyc_status === 'uninitiated' && (
                    <>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={() => setKycVendorId(v.id)}
                      >
                        KYC
                      </button>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--accent-primary)', color: '#3b82f6' }}
                        onClick={() => handleOAuthConnect(v.id)}
                      >
                        OAuth
                      </button>
                    </>
                  )}
                  <button 
                    className="btn btn-secondary" 
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}
                    onClick={() => openDetails(v)}
                  >
                    Details
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ==================== ADD VENDOR MODAL ==================== */}
      {showAddForm && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '450px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.25rem' }}>Onboard New Marketplace Seller</h3>
            
            <form onSubmit={handleAddVendor}>
              <div className="form-group">
                <label className="form-label">Vendor Business Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={bizName} 
                  onChange={(e) => setBizName(e.target.value)}
                  placeholder="e.g. AWS Reseller Services"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Contact Email</label>
                <input 
                  type="email" 
                  className="form-input" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vendor@biz.local"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Platform Fee Commission (%)</label>
                <input 
                  type="number" 
                  step="0.1" 
                  className="form-input" 
                  value={feePercent} 
                  onChange={(e) => setFeePercent(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creatingVendor} style={{ opacity: creatingVendor ? 0.7 : 1 }}>{creatingVendor ? 'Creating...' : 'Create Vendor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== KYC SIGNATORY SUBMISSION MODAL ==================== */}
      {kycVendorId && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '480px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Submit KYC Signatory Profiles</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1.25rem' }}>
              KYC details are required by financial clearing partners to activate the Route splitting payouts.
            </p>

            <form onSubmit={handleKycSubmit}>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>
                Authorized Stakeholder
              </h4>
              
              <div className="form-group">
                <label className="form-label">Signatory Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={holderName} 
                  onChange={(e) => setHolderName(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">PAN Number</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={holderPan} 
                    onChange={(e) => setHolderPan(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Residential Address</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={holderAddress} 
                    onChange={(e) => setHolderAddress(e.target.value)}
                    required
                  />
                </div>
              </div>

              <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem', marginTop: '1rem' }}>
                Settlement Bank Account
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label">IFSC Code</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={bankIfsc} 
                    onChange={(e) => setBankIfsc(e.target.value)}
                    placeholder="IFSC1234567"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Account Number</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={bankAccount} 
                    onChange={(e) => setBankAccount(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setKycVendorId(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submittingKyc} style={{ opacity: submittingKyc ? 0.7 : 1 }}>{submittingKyc ? 'Submitting...' : 'Submit KYC'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== VENDOR DETAILS & PAYOUTS DRAWER/MODAL ==================== */}
      {selectedVendor && (
        <div className="modal-overlay">
          <div className="glass-card modal-card" style={{ '--modal-width': '750px', position: 'relative' }}>
            <button 
              type="button" 
              style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setSelectedVendor(null)}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>{selectedVendor.business_name}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{selectedVendor.email} · platform commission: {selectedVendor.platform_fee_percentage}%</p>
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                onClick={() => handleDeleteVendor(selectedVendor.id)}
              >
                <Trash2 size={14} /> Remove Vendor
              </button>
            </div>

            {loadingDetails ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>Loading reports...</p>
            ) : (
              <div>
                {/* Financial Summary Info */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                  <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(59, 130, 246, 0.04)', padding: '1rem' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-primary)', padding: '0.75rem', borderRadius: '10px' }}>
                      <Wallet size={24} />
                    </div>
                     <div>
                       <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outstanding Payable</span>
                       <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                         <strong style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 800 }}>₹{balance.toFixed(2)}</strong>
                         {balance > 0 && selectedVendor.kyc_status === 'active' && (
                           <button
                             className="btn btn-primary"
                             style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}
                             onClick={() => {
                               setPayoutAmount(balance.toFixed(2));
                               setShowPayoutModal(true);
                             }}
                           >
                             Payout
                           </button>
                         )}
                       </div>
                     </div>
                  </div>
                  <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(16, 185, 129, 0.04)', padding: '1rem' }}>
                    <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-success)', padding: '0.75rem', borderRadius: '10px' }}>
                      <FileCheck size={24} />
                    </div>
                    <div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Linked account status</span>
                      <span style={{ fontSize: '1.0rem', fontWeight: 700, color: selectedVendor.kyc_status === 'active' ? 'var(--accent-success)' : 'var(--accent-primary)', display: 'block', wordBreak: 'break-all' }}>
                        {selectedVendor.razorpay_account_id ? `${selectedVendor.razorpay_account_id} (${selectedVendor.kyc_status.toUpperCase()})` : 'UNLINKED'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Transfers Table */}
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginBottom: '1rem' }}>Split Payout Transfers Ledger</h4>
                <div className="table-container" style={{ margin: 0, maxHeight: '250px', overflowY: 'auto' }}>
                  {transfers.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No split transfers recorded for this vendor.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Invoice #</th>
                          <th>Date</th>
                          <th style={{ textAlign: 'right' }}>Total Share</th>
                          <th style={{ textAlign: 'right' }}>Vendor Payout</th>
                          <th style={{ textAlign: 'right' }}>Platform Fee</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transfers.map(t => {
                          let badgeColor = 'rgba(255,255,255,0.06)';
                          let textClr = 'var(--text-muted)';
                          if (t.status === 'settled') {
                            badgeColor = 'rgba(16, 185, 129, 0.1)';
                            textClr = 'var(--accent-success)';
                          } else if (t.status === 'processed') {
                            badgeColor = 'rgba(59, 130, 246, 0.1)';
                            textClr = 'var(--accent-primary)';
                          } else if (t.status === 'pending') {
                            badgeColor = 'rgba(245, 158, 11, 0.1)';
                            textClr = 'var(--accent-warning)';
                          } else if (t.status === 'failed') {
                            badgeColor = 'rgba(239, 68, 68, 0.1)';
                            textClr = 'var(--accent-danger)';
                          }

                          return (
                            <tr key={t.id}>
                              <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{t.document_number}</td>
                              <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{new Date(t.invoice_date).toLocaleDateString()}</td>
                              <td style={{ textAlign: 'right' }}>₹{parseFloat(t.total_amount).toFixed(2)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-highlight)' }}>₹{parseFloat(t.vendor_share).toFixed(2)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>₹{parseFloat(t.platform_fee).toFixed(2)}</td>
                              <td>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '4px', background: badgeColor, color: textClr, textTransform: 'uppercase' }}>
                                  {t.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== VENDOR PAYOUT MODAL ==================== */}
      {showPayoutModal && selectedVendor && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="glass-card modal-card" style={{ '--modal-width': '400px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Process Vendor Payout</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1.25rem' }}>
              Directly transfer outstanding balance funds to the vendor's linked Razorpay Route account.
            </p>

            <form onSubmit={handlePayoutSubmit}>
              <div className="form-group">
                <label className="form-label">Available Balance</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={`₹${balance.toFixed(2)}`}
                  disabled
                />
              </div>

              <div className="form-group">
                <label className="form-label">Payout Amount (₹)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="form-input" 
                  value={payoutAmount} 
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  max={balance}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPayoutModal(false)} disabled={processingPayout}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={processingPayout}>
                  {processingPayout ? 'Processing...' : 'Confirm Payout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Vendors;
