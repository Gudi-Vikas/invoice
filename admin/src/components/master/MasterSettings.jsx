/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api';
import { Save, AlertCircle, Eye, Code, Upload, Settings as SettingsIcon } from 'lucide-react';
import { sanitizeHtmlContent } from '../../utils/sanitize';
import PlatformInvoiceVisualizer from '../shared/PlatformInvoiceVisualizer';

/**
 * Master Admin Platform Settings Control Dashboard.
 * Includes Billing Settings (Business identity + Invoice layout & sequence) and Tax Settings.
 */
export const MasterSettings = () => {
  const [activeTab, setActiveTab] = useState('billing');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoUploading, setLogoUploading] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const logoInputRef = useRef(null);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api.masterGetSettings();
      setSettings(data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load platform settings:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async (category) => {
    setFeedback({ type: '', message: '' });
    try {
      let payload = {};
      if (category === 'business') {
        payload = settings.business_info || {};
      } else if (category === 'invoice') {
        payload = settings.invoice_config || {};
      } else if (category === 'tax') {
        payload = settings.tax_config || {};
      }

      await api.masterUpdateSettings(category, payload);
      setFeedback({
        type: 'success',
        message: `Platform ${category.charAt(0).toUpperCase() + category.slice(1)} settings saved successfully!`
      });
      setTimeout(() => setFeedback({ type: '', message: '' }), 4000);
      fetchSettings();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update platform settings.' });
    }
  };

  const handleSaveBillingAll = async () => {
    setFeedback({ type: '', message: '' });
    try {
      await api.masterUpdateSettings('business', settings.business_info || {});
      await api.masterUpdateSettings('invoice', settings.invoice_config || {});
      setFeedback({
        type: 'success',
        message: 'Platform Billing & Business settings saved successfully!'
      });
      setTimeout(() => setFeedback({ type: '', message: '' }), 4000);
      fetchSettings();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update settings.' });
    }
  };

  const updateSettingState = (block, key, value) => {
    setSettings(prev => ({
      ...prev,
      [block]: {
        ...prev[block],
        [key]: value
      }
    }));
  };

  const handleLogoFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLogoUploading(true);
    setFeedback({ type: '', message: '' });

    try {
      const data = await api.masterUploadLogo(file);
      updateSettingState('business_info', 'logoUrl', data.logoUrl);
      setFeedback({ type: 'success', message: 'Platform logo uploaded successfully.' });
      fetchSettings();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to upload platform logo.' });
    } finally {
      setLogoUploading(false);
      event.target.value = '';
    }
  };

  if (loading) {
    return <p style={{ color: 'var(--text-secondary)' }}>Loading platform settings...</p>;
  }

  const tabs = [
    { id: 'billing', label: 'Billing Settings' },
    { id: 'tax', label: 'Tax Settings' }
  ];

  const dummyPlatformInvoice = {
    invoice_number: `${settings?.invoice_config?.prefix || 'UKEY-BILL-'}202608-0001${settings?.invoice_config?.suffix || ''}`,
    created_at: new Date().toISOString(),
    due_date: new Date(Date.now() + (settings?.invoice_config?.dueDateDays || 15) * 86400000).toISOString(),
    status: 'pending',
    amount: 999.00,
    tax_percentage: settings?.tax_config?.defaultTaxPercentage || 18.00,
    tax_amount: (999.00 * (settings?.tax_config?.defaultTaxPercentage || 18.00)) / 100,
    total_amount: 999.00 + (999.00 * (settings?.tax_config?.defaultTaxPercentage || 18.00)) / 100,
    plan_name: 'Pro Subscription Plan',
    billing_period_start: new Date().toISOString(),
    billing_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
    notes: settings?.invoice_config?.footerNotes || 'Thank you for subscribing to Ultrakey SaaS platform.'
  };

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <SettingsIcon size={28} style={{ color: 'var(--accent-secondary)' }} />
            Platform Settings
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Configure platform business identity, SaaS billing invoice parameters, and tax rules.
          </p>
        </div>
      </div>

      {/* Tabs Navigation Header */}
      <div className="settings-tabs-header" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setFeedback({ type: '', message: '' });
            }}
            className={`settings-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            style={{
              padding: '0.7rem 1.5rem',
              borderRadius: '10px',
              border: 'none',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: '0.92rem',
              cursor: 'pointer',
              background: activeTab === tab.id ? 'var(--accent-secondary)' : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.2s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Alert Feedback Messages */}
      {feedback.message && (
        <div 
          className="info-alert" 
          style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '1rem 1.25rem',
            borderRadius: '12px',
            marginBottom: '1.5rem',
            backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
          }}
        >
          <AlertCircle size={18} style={{ color: feedback.type === 'success' ? 'var(--accent-success)' : 'var(--accent-danger)' }} />
          <span style={{ color: feedback.type === 'success' ? 'var(--accent-success)' : 'var(--accent-danger)', fontWeight: 500, fontSize: '0.9rem' }}>
            {feedback.message}
          </span>
        </div>
      )}

      <div className="admin-card" style={{ padding: '2rem' }}>
        
        {/* ==================== 1. BILLING & BUSINESS SETTINGS ==================== */}
        {activeTab === 'billing' && (
          <div>
            {/* Section A: Business Profile Identity */}
            <div style={{ marginBottom: '2.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.35rem', fontWeight: 700 }}>
                Platform Business Profile & Branding
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                Identity details rendered on platform invoices sent to SaaS tenants.
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Platform Logo</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Paste an image URL or upload a file"
                      value={settings.business_info.logoUrl || ''}
                      onChange={(e) => updateSettingState('business_info', 'logoUrl', e.target.value)}
                    />
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileChange}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.5rem 1rem', minWidth: '46px' }}
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                      title="Upload logo from your files"
                    >
                      <Upload size={16} />
                    </button>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'block' }}>
                    PNG, JPG, SVG, or WebP up to 2 MB, or hosted URL.
                  </span>
                  {settings.business_info.logoUrl && (
                    <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', display: 'inline-block', border: '1px solid var(--border-color)' }}>
                      <img src={settings.business_info.logoUrl} alt="Platform Logo Preview" style={{ maxHeight: '60px', maxWidth: '200px', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} onError={(e) => e.target.style.display = 'none'} />
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Business / Legal Entity Name</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={settings.business_info.businessName || ''}
                    onChange={(e) => updateSettingState('business_info', 'businessName', e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="form-label">Registered Business Address</label>
                <textarea 
                  className="form-textarea" 
                  value={settings.business_info.address || ''}
                  onChange={(e) => updateSettingState('business_info', 'address', e.target.value)}
                  style={{ height: '80px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', marginTop: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Website URL</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={settings.business_info.website || ''}
                    onChange={(e) => updateSettingState('business_info', 'website', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Billing Support Email</label>
                  <input 
                    type="email" 
                    className="form-input" 
                    value={settings.business_info.email || ''}
                    onChange={(e) => updateSettingState('business_info', 'email', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Contact Phone</label>
                  <input 
                    type="tel" 
                    className="form-input" 
                    value={settings.business_info.phone || ''}
                    onChange={(e) => updateSettingState('business_info', 'phone', e.target.value)}
                  />
                </div>
              </div>

              {/* Extra Business Info with HTML Preview */}
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="form-label">Extra Tax Registration / Legal Notes (HTML Allowed)</label>
                <textarea 
                  className="form-textarea" 
                  value={settings.business_info.extraInfo || ''}
                  onChange={(e) => updateSettingState('business_info', 'extraInfo', e.target.value)}
                  placeholder="<b>GST No:</b> 36AADCU5062A1ZO"
                  style={{ height: '80px', fontFamily: 'monospace' }}
                />
              </div>

              {/* HTML Sanitized Preview Box */}
              <div style={{ marginTop: '1rem', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem', background: 'rgba(0,0,0,0.15)' }}>
                <h5 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Code size={14} /> Rendered Header Output (Sanitized Preview)
                </h5>
                <div 
                  style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtmlContent(settings.business_info.extraInfo || '<i>No extra details supplied.</i>') }}
                />
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '2.5rem 0' }} />

            {/* Section B: Platform Invoice Sequence & Styling */}
            <div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.35rem', fontWeight: 700 }}>
                Platform Invoice Numbering & Layout Parameters
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                Configure sequence numbers, due dates, terms, and visual styling for tenant billing invoices.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Invoice Prefix</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={settings.invoice_config.prefix || ''}
                    onChange={(e) => updateSettingState('invoice_config', 'prefix', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Invoice Suffix</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={settings.invoice_config.suffix || ''}
                    onChange={(e) => updateSettingState('invoice_config', 'suffix', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Next Sequence Number</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={settings.invoice_config.nextNumber || 1}
                    onChange={(e) => updateSettingState('invoice_config', 'nextNumber', parseInt(e.target.value, 10) || 1)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Date Threshold (Days)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={settings.invoice_config.dueDateDays || 15}
                    onChange={(e) => updateSettingState('invoice_config', 'dueDateDays', parseInt(e.target.value, 10) || 15)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.invoice_config.autoIncrement !== false}
                    onChange={(e) => updateSettingState('invoice_config', 'autoIncrement', e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-secondary)' }}
                  />
                  <span>Auto-increment platform invoice numbers sequentially</span>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Terms & Conditions</label>
                <textarea 
                  className="form-textarea" 
                  value={settings.invoice_config.termsAndConditions || ''}
                  onChange={(e) => updateSettingState('invoice_config', 'termsAndConditions', e.target.value)}
                  style={{ height: '80px' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Footer Notes</label>
                <textarea 
                  className="form-textarea" 
                  value={settings.invoice_config.footerNotes || ''}
                  onChange={(e) => updateSettingState('invoice_config', 'footerNotes', e.target.value)}
                  style={{ height: '80px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Template Design Theme</label>
                  <select 
                    className="form-select"
                    value={settings.invoice_config.templateDesign || 'default'}
                    onChange={(e) => updateSettingState('invoice_config', 'templateDesign', e.target.value)}
                  >
                    <option value="default">Default Glass-Theme</option>
                    <option value="simple">Minimal Grid Layout</option>
                    <option value="modern">Modern Professional</option>
                    <option value="bold">Bold Corporate</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label className="form-label">Template Primary Accent Color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input 
                      type="color" 
                      value={settings.invoice_config.templateColor || '#7c3aed'}
                      onChange={(e) => updateSettingState('invoice_config', 'templateColor', e.target.value)}
                      style={{ height: '38px', width: '50px', cursor: 'pointer', padding: '0', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                      {settings.invoice_config.templateColor || '#7c3aed'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Live Preview Panel */}
              <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Eye size={18} /> Live Platform Invoice Document Preview
                </h4>
                <div style={{ 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '12px', 
                  overflowY: 'auto',
                  overflowX: 'hidden', 
                  maxHeight: '600px', 
                  backgroundColor: '#f8fafc',
                  padding: '1.5rem'
                }}>
                  <PlatformInvoiceVisualizer
                    invoice={dummyPlatformInvoice}
                    tenantName="Sample Tenant Org"
                    onClose={() => {}}
                    showPayButton={false}
                    businessInfo={settings?.business_info}
                    invoiceConfig={settings?.invoice_config}
                    taxConfig={settings?.tax_config}
                    hideTopBar={true}
                  />

                </div>
              </div>
            </div>

            <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                className="btn btn-primary" 
                onClick={handleSaveBillingAll}
                style={{
                  padding: '0.8rem 1.75rem',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))'
                }}
              >
                <Save size={18} /> Save Billing & Business Settings
              </button>
            </div>
          </div>
        )}

        {/* ==================== 2. TAX SETTINGS ==================== */}
        {activeTab === 'tax' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.35rem', fontWeight: 700 }}>
              Platform Tax Rules & Currency Controls
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Global tax rates and formatting defaults for SaaS plan invoices generated by Ultrakey.
            </p>
            
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Prices Entered With Tax</label>
              <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="tax_exclusive_inclusive" 
                    checked={settings.tax_config.pricesInclusiveOfTax === true}
                    onChange={() => updateSettingState('tax_config', 'pricesInclusiveOfTax', true)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-secondary)' }}
                  />
                  <span>Yes, plan prices are inclusive of tax</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="tax_exclusive_inclusive" 
                    checked={settings.tax_config.pricesInclusiveOfTax === false}
                    onChange={() => updateSettingState('tax_config', 'pricesInclusiveOfTax', false)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-secondary)' }}
                  />
                  <span>No, plan prices are pre-tax (Exclusive)</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Default Platform Tax Percentage (%)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="form-input" 
                  value={settings.tax_config.defaultTaxPercentage ?? 18.00}
                  onChange={(e) => updateSettingState('tax_config', 'defaultTaxPercentage', parseFloat(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  Standard GST / VAT rate applied to SaaS plan billing invoices.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Tax Name / Label</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.tax_config.defaultTaxName || 'GST'}
                  onChange={(e) => updateSettingState('tax_config', 'defaultTaxName', e.target.value)}
                  placeholder="GST, VAT, Sales Tax"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Currency Symbol</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.tax_config.currencySymbol || '₹'}
                  onChange={(e) => updateSettingState('tax_config', 'currencySymbol', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Thousand Separator</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.tax_config.thousandSeparator || ','}
                  onChange={(e) => updateSettingState('tax_config', 'thousandSeparator', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Decimal Separator</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.tax_config.decimalSeparator || '.'}
                  onChange={(e) => updateSettingState('tax_config', 'decimalSeparator', e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                className="btn btn-primary" 
                onClick={() => handleSave('tax')}
                style={{
                  padding: '0.8rem 1.75rem',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: 'linear-gradient(135deg, var(--accent-secondary), var(--accent-primary))'
                }}
              >
                <Save size={18} /> Save Tax Configuration
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default MasterSettings;
