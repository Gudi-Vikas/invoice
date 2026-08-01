/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';

/**
 * Global Settings Context.
 * Fetches tenant settings on mount and distributes to all consumers.
 * Re-fetches when tenant:switched event fires (from TenantSwitcher).
 *
 * Usage:
 *   import { useSettings } from '../context/SettingsContext';
 *   const { settings, loading, refreshSettings } = useSettings();
 */

const SettingsContext = createContext(null);

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getSettings();
      setSettings(data);
    } catch (err) {
      console.error('[SettingsContext] Failed to load settings:', err);
      // Settings might fail if tenant has no settings row yet — handle gracefully
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Re-fetch settings when tenant is switched
  useEffect(() => {
    const handleTenantSwitch = () => {
      fetchSettings();
    };
    window.addEventListener('tenant:switched', handleTenantSwitch);
    return () => window.removeEventListener('tenant:switched', handleTenantSwitch);
  }, [fetchSettings]);

  // Clear settings on logout
  useEffect(() => {
    const handleLogout = () => {
      setSettings(null);
      setLoading(false);
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  /**
   * Refreshes settings from the server.
   * Call this after saving settings to ensure all components reflect the change.
   */
  const refreshSettings = useCallback(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <SettingsContext.Provider value={{ settings, loading, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

/**
 * Hook to access the global settings context.
 * Throws if used outside of <SettingsProvider>.
 */
export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a <SettingsProvider> tree.');
  }
  return ctx;
};

