/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import { Save, AlertCircle, Eye, Code, Upload } from 'lucide-react';
import { sanitizeHtmlContent } from '../utils/sanitize';
import { useSettings } from '../context/SettingsContext';

/**
 * Settings Control Dashboard.
 * Integrates 8 distinct tabs mapping to the Ultrakey product design.
 */
export const Settings = () => {
  const { settings: ctxSettings, refreshSettings } = useSettings();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoUploading, setLogoUploading] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const logoInputRef = useRef(null);

  // Emails active template key selector
  const [activeEmailKey, setActiveEmailKey] = useState('');

  // Input states for pipe-delimited parser preview
  const [rawLineItemsText, setRawLineItemsText] = useState('');
  const [parsedLineItems, setParsedLineItems] = useState([]);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api.getSettings();
      // Ensure payments_config is always present (safe guard for older stored configs)
      if (!data.payments_config) data.payments_config = {};
      setSettings(data);
      
      // Parse pre-defined line items format to string
      if (data.general_config?.predefinedLineItems) {
        const pipeString = data.general_config.predefinedLineItems
          .map(item => `${item.qty} | ${item.title} | ${item.price} | ${item.description}`)
          .join('\n');
        setRawLineItemsText(pipeString);
        setParsedLineItems(data.general_config.predefinedLineItems);
      }
      if (data.email_templates) {
        const firstKey = Object.keys(data.email_templates)[0];
        setActiveEmailKey(firstKey || '');
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ctxSettings) {
      setSettings(ctxSettings);
      setLoading(false);
      if (ctxSettings.general_config?.predefinedLineItems) {
        const pipeString = ctxSettings.general_config.predefinedLineItems
          .map(item => `${item.qty} | ${item.title} | ${item.price} | ${item.description}`)
          .join('\n');
        setRawLineItemsText(pipeString);
        setParsedLineItems(ctxSettings.general_config.predefinedLineItems);
      }
      if (ctxSettings.email_templates) {
        const firstKey = Object.keys(ctxSettings.email_templates)[0];
        setActiveEmailKey(firstKey || '');
      }
    } else {
      fetchSettings();
    }
  }, [ctxSettings, fetchSettings]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const oauthParam = params.get('oauth');
    const messageParam = params.get('message');

    if (tabParam) {
      setActiveTab(tabParam);
    }

    if (oauthParam === 'success') {
      setFeedback({ type: 'success', message: 'Razorpay account connected successfully via OAuth!' });
      window.history.replaceState({}, document.title, window.location.pathname + '?tab=payments');
      fetchSettings();
    } else if (oauthParam === 'error') {
      setFeedback({ type: 'error', message: `Razorpay connection failed: ${messageParam || 'Unknown error'}` });
      window.history.replaceState({}, document.title, window.location.pathname + '?tab=payments');
    }
  }, [fetchSettings]);


  // Real-time Pipe Delimited String Parser
  const handlePipeTextChange = (e) => {
    const text = e.target.value;
    setRawLineItemsText(text);

    const lines = text.split('\n');
    const parsed = [];

    lines.forEach(line => {
      if (!line.trim()) return;
      const parts = line.split('|');
      
      const qty = parseInt(parts[0]?.trim(), 10) || 1;
      const title = parts[1]?.trim() || '';
      
      // Strip currency signs and map to strict numbers
      let rawPrice = parts[2]?.trim() || '0';
      rawPrice = rawPrice.replace(/[^0-9.]/g, ''); // Aggressive symbol stripping
      const price = parseFloat(rawPrice) || 0;
      
      const description = parts[3]?.trim() || '';

      if (title) {
        parsed.push({ qty, title, price, description });
      }
    });

    setParsedLineItems(parsed);
  };

  const handleSave = async (category) => {
    setFeedback({ type: '', message: '' });
    try {
      let payload = {};
      if (category === 'general') {
        payload = {
          fiscalYearStart: settings.general_config.fiscalYearStart,
          fiscalYearEnd: settings.general_config.fiscalYearEnd,
          predefinedLineItems: parsedLineItems
        };
      } else {
        let key = `${category}_config`;
        if (category === 'business') key = 'business_info';
        if (category === 'email') key = 'email_templates';
        if (category === 'translations') key = 'translations';
        payload = settings[key] || settings[category] || {};
      }

      await api.updateSettings(category, payload);
      setFeedback({ type: 'success', message: `${category.charAt(0).toUpperCase() + category.slice(1)} settings saved successfully!` });
      setTimeout(() => setFeedback({ type: '', message: '' }), 4000);
      refreshSettings(); // Propagate to all consumers via SettingsContext
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

  const updateSubSettingState = (block, parentKey, key, value) => {
    setSettings(prev => ({
      ...prev,
      [block]: {
        ...prev[block],
        [parentKey]: {
          ...prev[block][parentKey],
          [key]: value
        }
      }
    }));
  };

  const handleLogoFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLogoUploading(true);
    setFeedback({ type: '', message: '' });

    try {
      const data = await api.uploadLogo(file);
      updateSettingState('business_info', 'logoUrl', data.logoUrl);
      setFeedback({ type: 'success', message: 'Logo uploaded successfully.' });
      refreshSettings();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to upload logo.' });
    } finally {
      setLogoUploading(false);
      event.target.value = '';
    }
  };

  const handleConnectRazorpay = async () => {
    setFeedback({ type: '', message: '' });
    try {
      const { authorizeUrl } = await api.getTenantOAuthUrl();
      if (authorizeUrl) {
        window.location.href = authorizeUrl;
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to initialize Razorpay OAuth.' });
    }
  };

  const handleDisconnectRazorpay = async () => {
    setFeedback({ type: '', message: '' });
    if (!window.confirm('Are you sure you want to disconnect your Razorpay integration? Client online checkout payments will be disabled.')) {
      return;
    }
    try {
      await api.disconnectTenantRazorpay();
      setFeedback({ type: 'success', message: 'Razorpay connected account successfully disconnected.' });
      fetchSettings();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to disconnect Razorpay.' });
    }
  };

  if (loading) {
    return <p style={{ color: 'var(--text-secondary)' }}>Loading settings config modules...</p>;
  }

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'business', label: 'Business' },
    { id: 'quotes', label: 'Quotes' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'payments', label: 'Payments' },
    { id: 'tax', label: 'Tax' },
    { id: 'emails', label: 'Emails' },
    { id: 'translate', label: 'Translate' }
  ];

  return (
    <div className="fade-in">
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 800 }}>Platform Settings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Configure document sequencing, business identity, and routing parameters.</p>
        </div>
      </div>

      {/* Settings Navigation Tabs Header */}
      <div className="settings-tabs-header">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setFeedback({ type: '', message: '' });
            }}
            className={`settings-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Alert Feedbacks */}
      {feedback.message && (
        <div 
          className="info-alert" 
          style={{ 
            backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            borderColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)' 
          }}
        >
          <AlertCircle size={18} style={{ color: feedback.type === 'success' ? 'var(--accent-success)' : 'var(--accent-danger)' }} />
          <span className="info-alert-text" style={{ color: feedback.type === 'success' ? 'hsl(142, 72%, 85%)' : 'hsl(350, 89%, 85%)' }}>
            {feedback.message}
          </span>
        </div>
      )}

      {/* TABS CONTAINER */}
      <div className="glass-card">
        
        {/* ==================== 1. GENERAL SETTINGS ==================== */}
        {activeTab === 'general' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Fiscal Calendar & Core Settings</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div className="form-group">
                <label className="form-label">Year Start</label>
                <select 
                  className="form-select" 
                  value={settings.general_config.fiscalYearStart}
                  onChange={(e) => updateSettingState('general_config', 'fiscalYearStart', e.target.value)}
                >
                  <option value="01 Jan">01 Jan</option>
                  <option value="01 Apr">01 Apr (Default)</option>
                  <option value="01 Jul">01 Jul</option>
                  <option value="01 Oct">01 Oct</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Year End</label>
                <select 
                  className="form-select"
                  value={settings.general_config.fiscalYearEnd}
                  onChange={(e) => updateSettingState('general_config', 'fiscalYearEnd', e.target.value)}
                >
                  <option value="31 Dec">31 Dec</option>
                  <option value="31 Mar">31 Mar (Default)</option>
                  <option value="30 Jun">30 Jun</option>
                  <option value="30 Sep">30 Sep</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Pre-Defined Line Items</label>
              <textarea 
                className="form-textarea" 
                value={rawLineItemsText}
                onChange={handlePipeTextChange}
                placeholder="Qty | Title | Price | Description"
                style={{ height: '140px', fontFamily: 'monospace' }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Format: <code>Quantity | Title | Price | Description</code> (one item per line). Prices are parsed numerically.
              </span>
            </div>

            {/* Real-time Parser Preview */}
            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Eye size={16} /> Real-Time Delimited Parser Output
              </h4>
              {parsedLineItems.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Type line items above to see real-time parsing...</p>
              ) : (
                <div className="parsed-grid">
                  {parsedLineItems.map((item, idx) => (
                    <div key={idx} className="parsed-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4>{item.title || 'Untitled Item'}</h4>
                        <span className="badge badge-published" style={{ fontSize: '0.65rem' }}>Qty: {item.qty}</span>
                      </div>
                      <p style={{ flex: 1 }}>{item.description || 'No description provided.'}</p>
                      <span className="price">₹{parseFloat(item.price).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('general')}>
                <Save size={16} /> Save General Settings
              </button>
            </div>
          </div>
        )}

        {/* ==================== 2. BUSINESS TAB ==================== */}
        {activeTab === 'business' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Business Profile Branding</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Business Logo</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Paste an image URL or upload a file"
                    value={settings.business_info.logoUrl}
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
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Upload PNG, JPG, SVG, or WebP up to 2 MB, or paste a hosted logo URL.
                </span>
                {settings.business_info.logoUrl && (
                  <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', display: 'inline-block' }}>
                    <img src={settings.business_info.logoUrl} alt="Logo Preview" style={{ maxHeight: '45px', display: 'block' }} onError={(e) => e.target.style.display = 'none'} />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Business Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.business_info.businessName}
                  onChange={(e) => updateSettingState('business_info', 'businessName', e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Address</label>
              <textarea 
                className="form-textarea" 
                value={settings.business_info.address}
                onChange={(e) => updateSettingState('business_info', 'address', e.target.value)}
                style={{ height: '80px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Website</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.business_info.website}
                  onChange={(e) => updateSettingState('business_info', 'website', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email</label>
                <input 
                  type="email" 
                  className="form-input" 
                  value={settings.business_info.email}
                  onChange={(e) => updateSettingState('business_info', 'email', e.target.value)}
                />
              </div>
            </div>

            {/* Extra Business Info with Live HTML Preview */}
            <div className="form-group">
              <label className="form-label">Extra Business Info (HTML Allowed)</label>
              <textarea 
                className="form-textarea" 
                value={settings.business_info.extraInfo}
                onChange={(e) => updateSettingState('business_info', 'extraInfo', e.target.value)}
                placeholder="<b>GST No:</b> 36AADCU5062A1ZO"
                style={{ height: '80px', fontFamily: 'monospace' }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Allows embedding formatted strings like bold headers or tax registration numbers.
              </span>
            </div>

            {/* HTML Preview Panel */}
            <div style={{ marginTop: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem', background: 'rgba(0,0,0,0.1)' }}>
              <h5 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Code size={14} /> Rendered Header Output (Sanitized Preview)
              </h5>
              <div 
                style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtmlContent(settings.business_info.extraInfo || '<i>No extra details supplied.</i>') }}
              />
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('business')}>
                <Save size={16} /> Save Business Profile
              </button>
            </div>
          </div>
        )}

        {/* ==================== 3. QUOTATION CONFIGURATION ==================== */}
        {activeTab === 'quotes' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Quotation Settings</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Prefix</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.invoice_config.quote.prefix}
                  onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'prefix', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Suffix</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.invoice_config.quote.suffix}
                  onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'suffix', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Next Number</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={settings.invoice_config.quote.nextNumber}
                  onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'nextNumber', parseInt(e.target.value, 10) || 1)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Validity (Days)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={settings.invoice_config.quote.validityDays}
                  onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'validityDays', parseInt(e.target.value, 10) || 30)}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Auto Increment</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.invoice_config.quote.autoIncrement}
                    onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'autoIncrement', e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>Auto increment quotes count</span>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Action Upon Client Acceptance</label>
                <select 
                  className="form-select"
                  value={settings.invoice_config.quote.actionOnAccept}
                  onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'actionOnAccept', e.target.value)}
                >
                  <option value="convert_to_invoice">Convert Quote to Invoice and publish</option>
                  <option value="none">Set status to Accepted, take no action</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Terms & Conditions</label>
              <textarea 
                className="form-textarea" 
                value={settings.invoice_config.quote.termsAndConditions}
                onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'termsAndConditions', e.target.value)}
                style={{ height: '80px' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Footer Notes</label>
              <textarea 
                className="form-textarea" 
                value={settings.invoice_config.quote.footerNotes}
                onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'footerNotes', e.target.value)}
                style={{ height: '80px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Template Design</label>
                <select 
                  className="form-select"
                  value={settings.invoice_config.quote.templateDesign}
                  onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'templateDesign', e.target.value)}
                >
                  <option value="default">Default Glass-Theme</option>
                  <option value="simple">Minimal Grid Layout</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Client Portal Acceptance Button</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={settings.invoice_config.quote.enableAcceptPortalButton}
                    onChange={(e) => updateSubSettingState('invoice_config', 'quote', 'enableAcceptPortalButton', e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>Show "Accept Quote" button on customer portal</span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('invoice')}>
                <Save size={16} /> Save Quotation Settings
              </button>
            </div>
          </div>
        )}

        {/* ==================== 4. INVOICE CONFIGURATION ==================== */}
        {activeTab === 'invoices' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Invoice Configuration</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Prefix</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.invoice_config.invoice.prefix}
                  onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'prefix', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Suffix</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.invoice_config.invoice.suffix}
                  onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'suffix', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Next Number</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={settings.invoice_config.invoice.nextNumber}
                  onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'nextNumber', parseInt(e.target.value, 10) || 1)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Due Date Threshold (Days)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={settings.invoice_config.invoice.dueDateDays}
                  onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'dueDateDays', parseInt(e.target.value, 10) || 14)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Auto Increment</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={settings.invoice_config.invoice.autoIncrement}
                  onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'autoIncrement', e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <span>Auto increment invoice numbers sequentially</span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-label">Terms & Conditions</label>
              <textarea 
                className="form-textarea" 
                value={settings.invoice_config.invoice.termsAndConditions}
                onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'termsAndConditions', e.target.value)}
                style={{ height: '80px' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Footer Notes</label>
              <textarea 
                className="form-textarea" 
                value={settings.invoice_config.invoice.footerNotes}
                onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'footerNotes', e.target.value)}
                style={{ height: '80px' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Template Design</label>
              <select 
                className="form-select"
                value={settings.invoice_config.invoice.templateDesign}
                onChange={(e) => updateSubSettingState('invoice_config', 'invoice', 'templateDesign', e.target.value)}
              >
                <option value="default">Default Glass-Theme</option>
                <option value="simple">Minimal Grid Layout</option>
              </select>
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('invoice')}>
                <Save size={16} /> Save Invoice Settings
              </button>
            </div>
          </div>
        )}

        {/* ==================== 5. PAYMENT CONFIGURATION ==================== */}
        {activeTab === 'payments' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Payment Gateway Integrations</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">GPay / PhonePe Number</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={settings.payments_config?.gpayNumber || ''}
                  onChange={e => updateSettingState('payments_config', 'gpayNumber', e.target.value)}
                  placeholder="e.g. 6300440316" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Bank Name</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={settings.payments_config?.bankName || ''}
                  onChange={e => updateSettingState('payments_config', 'bankName', e.target.value)}
                  placeholder="e.g. HDFC Bank" 
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Bank Account Number</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={settings.payments_config?.bankAccountNumber || ''}
                  onChange={e => updateSettingState('payments_config', 'bankAccountNumber', e.target.value)}
                  placeholder="e.g. 50200092611852" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Bank Account Name</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={settings.payments_config?.bankAccountName || ''}
                  onChange={e => updateSettingState('payments_config', 'bankAccountName', e.target.value)}
                  placeholder="e.g. Ultrakey IT Solutions Pvt. Ltd." 
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">IFSC Code</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={settings.payments_config?.bankIfsc || ''}
                  onChange={e => updateSettingState('payments_config', 'bankIfsc', e.target.value)}
                  placeholder="e.g. HDFC0000968" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Branch Name</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={settings.payments_config?.bankBranch || ''}
                  onChange={e => updateSettingState('payments_config', 'bankBranch', e.target.value)}
                  placeholder="e.g. GACHIBOWLI" 
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Additional Payment Instructions (shown on invoices)</label>
              <textarea
                className="form-textarea"
                value={settings.payments_config?.bankDetails || ''}
                onChange={e => updateSettingState('payments_config', 'bankDetails', e.target.value)}
                placeholder="Any other terms or instructions..."
                style={{ height: '80px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">UPI ID (for dynamic QR code generation)</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={settings.payments_config?.upiId || ''}
                  onChange={e => updateSettingState('payments_config', 'upiId', e.target.value)}
                  placeholder="e.g. business@okaxis" 
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Enter your business UPI VPA. It will generate a dynamic QR Code at checkout.
                </span>
              </div>
              <div className="form-group">
                <label className="form-label">Currency Position</label>
                <select className="form-select"
                  value={settings.payments_config?.currencyPosition || 'left'}
                  onChange={e => updateSettingState('payments_config', 'currencyPosition', e.target.value)}>
                  <option value="left">Left (₹1,000)</option>
                  <option value="right">Right (1,000₹)</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <label className="form-label" style={{ fontSize: '1rem', display: 'block', marginBottom: '0.75rem' }}>Razorpay Online Gateway Integration</label>
              
              {settings.payments_config?.razorpayConnected ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid var(--accent-success)', color: 'var(--accent-success)', padding: '0.35rem 0.75rem', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 600 }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-success)' }} />
                      Connected
                    </div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Merchant Account ID: <strong>{settings.payments_config?.razorpayKeyId}</strong>
                    </span>
                  </div>
                  
                  <button type="button" className="btn btn-secondary" onClick={handleDisconnectRazorpay} style={{ borderColor: 'var(--accent-danger)', color: 'var(--accent-danger)' }}>
                    Disconnect Razorpay Account
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: '1.5' }}>
                    Connect your Razorpay account to accept secure credit card, netbanking, and wallet payments directly on your invoices.
                  </p>
                  
                  <button type="button" className="btn btn-primary" onClick={handleConnectRazorpay}>
                    Connect with Razorpay
                  </button>
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={settings.payments_config?.passGatewayFees === true}
                  onChange={e => updateSettingState('payments_config', 'passGatewayFees', e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <span style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  Pass Razorpay Transaction Fee (2.00%) to client as a surcharge
                </span>
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem', marginLeft: '1.75rem' }}>
                If enabled, clients will cover the 2% fee at checkout (e.g., a ₹1,000 invoice will bill ₹1,020.41, netting you exactly ₹1,000.00).
              </span>
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('payments')}>
                <Save size={16} /> Save Payment Configuration
              </button>
            </div>
          </div>
        )}

        {/* ==================== 6. TAX SETTINGS ==================== */}
        {activeTab === 'tax' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Tax Settings & Rules</h3>
            
            <div className="form-group">
              <label className="form-label">Prices Entered With Tax</label>
              <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="tax_exclusive_inclusive" 
                    checked={settings.tax_config.pricesInclusiveOfTax === true}
                    onChange={() => updateSettingState('tax_config', 'pricesInclusiveOfTax', true)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>Yes, prices are inclusive of tax</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="tax_exclusive_inclusive" 
                    checked={settings.tax_config.pricesInclusiveOfTax === false}
                    onChange={() => updateSettingState('tax_config', 'pricesInclusiveOfTax', false)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>No, enter price pre-tax (Exclusive)</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Default Tax Percentage</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="form-input" 
                  value={settings.tax_config.defaultTaxPercentage}
                  onChange={(e) => updateSettingState('tax_config', 'defaultTaxPercentage', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tax Name (Local Title)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.tax_config.defaultTaxName}
                  onChange={(e) => updateSettingState('tax_config', 'defaultTaxName', e.target.value)}
                  placeholder="GST, VAT, Sales Tax"
                />
              </div>
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('tax')}>
                <Save size={16} /> Save Tax Configuration
              </button>
            </div>
          </div>
        )}

        {/* ==================== 7. EMAILS TEMPLATES ==================== */}
        {activeTab === 'emails' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Automated Communication Templates</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '1.5rem' }}>
              {/* Vertical sub-selector — FUNCTIONAL: clicking a trigger key switches the active template */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span className="form-label">Mail Triggers</span>
                {Object.keys(settings.email_templates).map(key => (
                  <button
                    key={key}
                    className="btn btn-secondary"
                    style={{
                      justifyContent: 'flex-start',
                      fontSize: '0.82rem',
                      padding: '0.6rem 1rem',
                      backgroundColor: activeEmailKey === key ? 'rgba(59,130,246,0.15)' : 'transparent',
                      borderColor: activeEmailKey === key ? 'var(--accent-primary)' : 'var(--border-color)',
                      color: activeEmailKey === key ? 'var(--accent-primary)' : 'var(--text-secondary)'
                    }}
                    onClick={() => setActiveEmailKey(key)}
                  >
                    {key.replace(/_/g, ' ').toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Template editor — driven by activeEmailKey state */}
              {activeEmailKey && settings.email_templates[activeEmailKey] && (
                <div style={{ background: 'rgba(0,0,0,0.1)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontSize: '1rem', marginBottom: '1rem', textTransform: 'capitalize' }}>
                    Template: {activeEmailKey.replace(/_/g, ' ')}
                  </h4>
                  
                  <div className="form-group">
                    <label className="form-label">Subject</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={settings.email_templates[activeEmailKey]?.subject || ''}
                      onChange={(e) => updateSubSettingState('email_templates', activeEmailKey, 'subject', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Body Content</label>
                    <textarea 
                      className="form-textarea" 
                      value={settings.email_templates[activeEmailKey]?.body || ''}
                      onChange={(e) => updateSubSettingState('email_templates', activeEmailKey, 'body', e.target.value)}
                      style={{ height: '140px' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Wildcards: <code>%client_first_name%</code>, <code>%number%</code>, <code>%link%</code>, <code>%total%</code>, <code>%due_date%</code>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('email')}>
                <Save size={16} /> Save Mail Configurations
              </button>
            </div>
          </div>
        )}

        {/* ==================== 8. TRANSLATIONS MATRIX ==================== */}
        {activeTab === 'translate' && (
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Linguistic Key Translation Matrix</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Map internal document terms to localized words in client outputs.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              {Object.keys(settings.translations).map(key => (
                <div key={key} className="form-group">
                  <label className="form-label" style={{ textTransform: 'capitalize' }}>{key}</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={settings.translations[key]}
                    onChange={(e) => updateSettingState('translations', key, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => handleSave('translations')}>
                <Save size={16} /> Save Translation Matrix
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Settings;
