// API Client — Dynamic Backend Integration
// No mock fallbacks. All requests go to the real backend API.
// JWT token and tenant context are read from localStorage on every call.

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

// In-memory cache for GET requests
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Core HTTP request handler.
 * Automatically attaches Authorization and x-tenant-id headers.
 * Dispatches auth:logout event on 401/403 responses.
 */
const request = async (url, options = {}) => {
  const method = options.method || 'GET';
  
  const token = localStorage.getItem('invoice_saas_token') || '';
  const activeTenant = (() => {
    try { return JSON.parse(localStorage.getItem('invoice_saas_active_tenant')); } catch { return null; }
  })();

  // Cache removed for realtime dashboard data freshness

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

  const data = await res.json();

  return data;
};

// ════════════════════════════════════════════════════════════════════════════
// API Methods — Organized by resource domain
// ════════════════════════════════════════════════════════════════════════════

export const api = {

  // ── Subscriptions (Shared) ──────────────────────────────────────────────────────
  getPlans: () => request('/subscriptions/plans'),

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
  masterCreateAdmin: (data) =>
    request('/master/admins', { method: 'POST', body: JSON.stringify(data) }),
  masterUpdateAdminPermissions: (id, permissions) =>
    request(`/master/admins/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissions }) }),
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

  // ── Master Plan Management ─────────────────────────────────────────────
  masterListPlans: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/master/plans${qs ? '?' + qs : ''}`);
  },
  masterCreatePlan: (data) =>
    request('/master/plans', { method: 'POST', body: JSON.stringify(data) }),
  masterUpdatePlan: (id, data) =>
    request(`/master/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  masterArchivePlan: (id) =>
    request(`/master/plans/${id}/archive`, { method: 'PATCH', body: JSON.stringify({}) }),
  masterRestorePlan: (id) =>
    request(`/master/plans/${id}/restore`, { method: 'PATCH', body: JSON.stringify({}) }),

  // ── Auth (used by AuthContext, exposed here for completeness) ──────────
  invite: (data, tenantId = null) => {
    const headers = tenantId ? { 'x-tenant-id': tenantId } : {};
    return request('/auth/invite', { method: 'POST', headers, body: JSON.stringify(data) });
  },
  listTeamUsers: () => request('/auth/users'),
  updateTeamUserPermissions: (id, permissions) => 
    request(`/auth/users/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
  removeTeamUser: (id) =>
    request(`/auth/users/${id}`, { method: 'DELETE' }),

  // ── Notification Badges & Feed ──────────────────────────────────────────────
  getMasterNotifications: () => request('/master/notifications')

};

export default api;
