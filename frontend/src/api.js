// API Client — Dynamic Backend Integration
// No mock fallbacks. All requests go to the real backend API.
// JWT token and tenant context are read from localStorage on every call.

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

/**
 * Core HTTP request handler.
 * Automatically attaches Authorization and x-tenant-id headers.
 * Dispatches auth:logout event on 401/403 responses.
 */
const request = async (url, options = {}) => {
  const token = localStorage.getItem('invoice_saas_token') || '';
  const activeTenant = (() => {
    try { return JSON.parse(localStorage.getItem('invoice_saas_active_tenant')); } catch { return null; }
  })();

  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...(activeTenant?.id && { 'x-tenant-id': activeTenant.id }),
    ...options.headers
  };

  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });

  // Session expired or unauthorized — trigger global logout
  if (res.status === 401 || res.status === 403) {
    const errBody = await res.json().catch(() => ({}));
    // Only auto-logout on token-related errors, not role-based errors
    if (errBody.error?.toLowerCase().includes('token') ||
        errBody.error?.toLowerCase().includes('session') ||
        errBody.error?.toLowerCase().includes('access token')) {
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }
    throw new Error(errBody.error || `Access denied (${res.status})`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `HTTP error! Status: ${res.status}`);
  }

  return await res.json();
};

// ════════════════════════════════════════════════════════════════════════════
// API Methods — Organized by resource domain
// ════════════════════════════════════════════════════════════════════════════

export const api = {

  // ── Settings ───────────────────────────────────────────────────────────
  getSettings: () => request('/settings'),
  updateSettings: (category, data) =>
    request(`/settings/${category}`, { method: 'PUT', body: JSON.stringify(data) }),
  uploadLogo: (file) => {
    const body = new FormData();
    body.append('logo', file);
    return request('/settings/logo', { method: 'POST', body });
  },
  getTenantOAuthUrl: () => request('/payments/razorpay/oauth-url'),
  disconnectTenantRazorpay: () => request('/payments/razorpay/disconnect', { method: 'POST' }),

  // ── Clients ────────────────────────────────────────────────────────────
  getClients: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/clients${qs ? '?' + qs : ''}`);
  },
  getClientById: (id) => request(`/clients/${id}`),
  createClient: (data) =>
    request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) =>
    request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getClientDocuments: (id) => request(`/clients/${id}/documents`),

  // ── Documents ──────────────────────────────────────────────────────────
  getDocuments: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/documents${qs ? '?' + qs : ''}`);
  },
  getDocumentStats: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/documents/stats${qs ? '?' + qs : ''}`);
  },
  getDocument: (id) => request(`/documents/${id}`),
  createDocument: (data) =>
    request('/documents', { method: 'POST', body: JSON.stringify(data) }),
  updateDocumentStatus: (id, status) =>
    request(`/documents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteDocument: (id) =>
    request(`/documents/${id}`, { method: 'DELETE' }),
  getMagicToken: (id) => request(`/documents/${id}/token`),
  sendDocumentEmail: (id) =>
    request(`/documents/${id}/send-email`, { method: 'POST', body: JSON.stringify({}) }),

  // ── Vendors ────────────────────────────────────────────────────────────
  getVendors: () => request('/vendors'),
  createVendor: (data) =>
    request('/vendors', { method: 'POST', body: JSON.stringify(data) }),
  submitKyc: (id, data) =>
    request(`/vendors/${id}/kyc`, { method: 'POST', body: JSON.stringify(data) }),
  getVendorOAuthUrl: (vendorId) =>
    request(`/vendors/oauth/authorize?vendorId=${vendorId}`),
  getVendorDetails: (id) => request(`/vendors/${id}`),
  getVendorTransfers: (id) => request(`/vendors/${id}/transfers`),
  getVendorBalance: (id) => request(`/vendors/${id}/balance`),
  payoutVendor: (id, amount) =>
    request(`/vendors/${id}/payout`, { method: 'POST', body: JSON.stringify({ amount }) }),
  deleteVendor: (id) => request(`/vendors/${id}`, { method: 'DELETE' }),

  // ── Portal (client-facing, magic-link authenticated) ───────────────────
  getPortalDocument: (token) => request(`/portal/documents/${token}`,
    { headers: { 'Authorization': '', 'x-tenant-id': '' } }),
  acceptQuote: (id, token) =>
    request(`/portal/quotes/${id}/accept`, { method: 'POST', body: JSON.stringify({ token }) }),
  declineQuote: (id, token) =>
    request(`/portal/quotes/${id}/decline`, { method: 'POST', body: JSON.stringify({ token }) }),
  initializePayment: (id, token) =>
    request(`/portal/invoices/${id}/pay`, { method: 'POST', body: JSON.stringify({ token }) }),
  verifyPortalPayment: (id, data) =>
    request(`/portal/invoices/${id}/verify`, {
      method: 'POST',
      headers: { 'Authorization': '', 'x-tenant-id': '' },
      body: JSON.stringify(data)
    }),
  verifyOfflinePayment: (id, data) =>
    request(`/portal/invoices/${id}/verify-offline`, {
      method: 'POST',
      headers: { 'Authorization': '', 'x-tenant-id': '' },
      body: JSON.stringify(data)
    }),

  // ── Subscriptions ──────────────────────────────────────────────────────
  getSubscriptionStatus: () => request('/subscriptions/status'),
  getPlans: () => request('/subscriptions/plans'),
  getPlatformInvoices: () => request('/subscriptions/invoices'),
  checkout: (planId) =>
    request('/subscriptions/checkout', { method: 'POST', body: JSON.stringify({ planId }) }),
  verifyCheckout: (data) =>
    request('/subscriptions/verify', { method: 'POST', body: JSON.stringify(data) }),
  payPlatformInvoice: (id) =>
    request(`/subscriptions/pay-invoice/${id}`, { method: 'POST', body: JSON.stringify({}) }),
  verifyPlatformInvoicePayment: (data) =>
    request('/subscriptions/verify-invoice', { method: 'POST', body: JSON.stringify(data) }),

  // ── Master Admin ───────────────────────────────────────────────────────
  masterDashboard: () => request('/master/dashboard'),
  masterListTenants: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/master/tenants${qs ? '?' + qs : ''}`);
  },
  masterGetTenant: (id) => request(`/master/tenants/${id}`),
  masterDisableTenant: (id, reason) =>
    request(`/master/tenants/${id}/disable`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  masterEnableTenant: (id) =>
    request(`/master/tenants/${id}/enable`, { method: 'PATCH', body: JSON.stringify({}) }),
  masterOverrideSub: (id, data) =>
    request(`/master/tenants/${id}/subscription`, { method: 'PATCH', body: JSON.stringify(data) }),
  masterDeleteTenant: (id) =>
    request(`/master/tenants/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) }),
  masterListAdmins: () => request('/master/admins'),
  masterToggleAdmin: (id) =>
    request(`/master/admins/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({}) }),
  masterGenerateBilling: (data) =>
    request('/master/billing/generate', { method: 'POST', body: JSON.stringify(data) }),
  masterListBilling: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/master/billing${qs ? '?' + qs : ''}`);
  },
  masterGetBilling: (id) => request(`/master/billing/${id}`),
  masterMarkPaid: (id, data) =>
    request(`/master/billing/${id}/mark-paid`, { method: 'PATCH', body: JSON.stringify(data || {}) }),
  masterVoidInvoice: (id, reason) =>
    request(`/master/billing/${id}/void`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  masterMarkOverdue: () =>
    request('/master/billing/mark-overdue', { method: 'POST', body: JSON.stringify({}) }),
  masterTenantBilling: (tenantId) => request(`/master/billing/tenant/${tenantId}`),

  // ── Auth (used by AuthContext, exposed here for completeness) ──────────
  invite: (data, tenantId = null) => {
    const headers = tenantId ? { 'x-tenant-id': tenantId } : {};
    return request('/auth/invite', { method: 'POST', headers, body: JSON.stringify(data) });
  },
  listTeamUsers: () => request('/auth/users')
};

export default api;
