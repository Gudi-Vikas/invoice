import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

/**
 * AuthContext — Central authentication state manager.
 *
 * Provides login/signup/logout/switchTenant/createTenant/joinWorkspace actions
 * and exposes the current user, active tenant, all tenants, and auth status.
 *
 * JWT tokens are persisted in localStorage and hydrated on mount.
 * Expired tokens trigger automatic logout.
 */

const API_BASE = 'http://localhost:5000/api/v1';

const AuthContext = createContext(null);

// ── localStorage key constants ─────────────────────────────────────────────
const LS_TOKEN        = 'invoice_saas_token';
const LS_USER         = 'invoice_saas_user';
const LS_ACTIVE       = 'invoice_saas_active_tenant';
const LS_ALL_TENANTS  = 'invoice_saas_all_tenants';
const LS_IS_MASTER    = 'invoice_saas_is_master';

// ── Helpers ────────────────────────────────────────────────────────────────
const safeParse = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};

const isTokenExpired = (token) => {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

/**
 * Raw fetch wrapper for auth-specific endpoints.
 * Does NOT use the api.js client — avoids circular dependency since
 * api.js reads auth state from localStorage that this context writes.
 */
const authFetch = async (url, body = {}) => {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};

const authFetchWithToken = async (url, body = {}) => {
  const token = localStorage.getItem(LS_TOKEN) || '';
  const activeTenant = safeParse(LS_ACTIVE);
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...(activeTenant?.id && { 'x-tenant-id': activeTenant.id })
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};

// ── Provider Component ─────────────────────────────────────────────────────
export const AuthProvider = ({ children }) => {
  const [user, setUser]                 = useState(null);
  const [token, setToken]               = useState(null);
  const [activeTenant, setActiveTenant] = useState(null);
  const [allTenants, setAllTenants]     = useState([]);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);
  const [loading, setLoading]           = useState(true);

  const isAuthenticated = !!token && !!user;

  // ── Persist auth state to localStorage ──────────────────────────────────
  const persistAuth = useCallback((tokenVal, userVal, tenantVal, tenantsVal, isMaster = false) => {
    localStorage.setItem(LS_TOKEN, tokenVal);
    localStorage.setItem(LS_USER, JSON.stringify(userVal));
    if (tenantVal) localStorage.setItem(LS_ACTIVE, JSON.stringify(tenantVal));
    if (tenantsVal) localStorage.setItem(LS_ALL_TENANTS, JSON.stringify(tenantsVal));
    localStorage.setItem(LS_IS_MASTER, JSON.stringify(isMaster));

    setToken(tokenVal);
    setUser(userVal);
    setActiveTenant(tenantVal);
    setAllTenants(tenantsVal || []);
    setIsMasterAdmin(isMaster);
  }, []);

  // ── Hydrate state from localStorage on mount ───────────────────────────
  useEffect(() => {
    const storedToken = localStorage.getItem(LS_TOKEN);
    if (storedToken && !isTokenExpired(storedToken)) {
      setToken(storedToken);
      setUser(safeParse(LS_USER));
      setActiveTenant(safeParse(LS_ACTIVE));
      setAllTenants(safeParse(LS_ALL_TENANTS) || []);
      setIsMasterAdmin(safeParse(LS_IS_MASTER) === true);
    } else if (storedToken) {
      // Token exists but expired — clear everything
      clearAuth();
    }
    setLoading(false);
  }, []);

  // ── Listen for forced logout events from api.js ────────────────────────
  useEffect(() => {
    const handleForceLogout = () => clearAuth();
    window.addEventListener('auth:logout', handleForceLogout);
    return () => window.removeEventListener('auth:logout', handleForceLogout);
  }, []);

  const clearAuth = () => {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_ACTIVE);
    localStorage.removeItem(LS_ALL_TENANTS);
    localStorage.removeItem(LS_IS_MASTER);
    setToken(null);
    setUser(null);
    setActiveTenant(null);
    setAllTenants([]);
    setIsMasterAdmin(false);
  };

  // ── Auth Actions ───────────────────────────────────────────────────────

  const login = async (email, password) => {
    const data = await authFetch('/auth/login', { email, password });
    persistAuth(data.token, data.user, data.activeTenant, data.allTenants || [data.activeTenant]);
    return data;
  };

  const signup = async (name, domain, email, password) => {
    const data = await authFetch('/auth/signup', { name, domain, email, password });
    persistAuth(data.token, data.user, data.activeTenant, [data.activeTenant]);
    return data;
  };

  const logout = () => {
    clearAuth();
  };

  const switchTenant = async (tenantId) => {
    const data = await authFetchWithToken('/auth/switch-tenant', { tenantId });
    const updatedTenant = data.activeTenant;
    localStorage.setItem(LS_TOKEN, data.token);
    localStorage.setItem(LS_ACTIVE, JSON.stringify(updatedTenant));
    setToken(data.token);
    setActiveTenant(updatedTenant);
    // Dispatch event so SettingsContext can re-fetch
    window.dispatchEvent(new CustomEvent('tenant:switched'));
    return data;
  };

  const createTenant = async (name, domain) => {
    const data = await authFetchWithToken('/auth/create-tenant', { name, domain });
    const newTenant = data.activeTenant;
    const updatedTenants = [...allTenants, newTenant];
    persistAuth(data.token, data.user, newTenant, updatedTenants);
    window.dispatchEvent(new CustomEvent('tenant:switched'));
    return data;
  };

  const joinWorkspace = async (inviteToken, password) => {
    const data = await authFetch('/auth/join', { inviteToken, password });
    persistAuth(data.token, data.user, data.activeTenant, [data.activeTenant]);
    return data;
  };

  const masterLogin = async (email, password) => {
    const data = await authFetch('/master/login', { email, password });
    persistAuth(data.token, data.admin, null, [], true);
    return data;
  };

  const invite = async (email, role) => {
    return await authFetchWithToken('/auth/invite', { email, role });
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      activeTenant,
      allTenants,
      isMasterAdmin,
      isAuthenticated,
      loading,
      login,
      signup,
      logout,
      switchTenant,
      createTenant,
      joinWorkspace,
      masterLogin,
      invite
    }}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to access the auth context.
 * Throws if used outside of <AuthProvider>.
 */
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider> tree.');
  }
  return ctx;
};

export default AuthContext;
