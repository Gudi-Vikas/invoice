import React, { useState, useEffect } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { Users, UserPlus, FileCheck, CheckCircle2, ShieldAlert, AlertTriangle } from 'lucide-react';

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

  // KYC Form modal inline
  const [kycVendorId, setKycVendorId] = useState(null);
  const [holderName, setHolderName] = useState('');
  const [holderPan, setHolderPan] = useState('');
  const [holderAddress, setHolderAddress] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankAccount, setBankAccount] = useState('');

  useEffect(() => {
    loadVendors();
  }, []);

  const loadVendors = async () => {
    try {
      const data = await api.getVendors();
      setVendors(data || []);
      setLoading(false);
    } catch (err) {
      showToast('Failed to load vendors: ' + err.message, 'error');
      setLoading(false);
    }
  };

  const handleAddVendor = async (e) => {
    e.preventDefault();
    if (!bizName || !email) return;

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
    }
  };

  const handleKycSubmit = async (e) => {
    e.preventDefault();
    if (!kycVendorId || !holderName || !bankAccount) return;

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
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
            <div key={v.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.15rem', color: '#fff', fontWeight: 700 }}>{v.business_name}</h3>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.08)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                    Fee: {v.platform_fee_percentage}%
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}><b>Email:</b> {v.email}</p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}><b>Linked Acc:</b> <code style={{ color: 'var(--text-muted)' }}>{v.razorpay_account_id}</code></p>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: statusColor }}>
                  <StatusIcon size={16} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                    {v.kyc_status}
                  </span>
                </div>

                {v.kyc_status === 'uninitiated' && (
                  <button 
                    className="btn btn-secondary" 
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
                    onClick={() => setKycVendorId(v.id)}
                  >
                    Submit KYC
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ==================== ADD VENDOR MODAL ==================== */}
      {showAddForm && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass-card" style={{ width: '450px' }}>
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
                <button type="submit" className="btn btn-primary">Create Vendor</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== KYC SIGNATORY SUBMISSION MODAL ==================== */}
      {kycVendorId && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass-card" style={{ width: '480px' }}>
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
                <button type="submit" className="btn btn-primary">Submit KYC</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Vendors;
