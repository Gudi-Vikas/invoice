/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

/**
 * NotificationContext — Lightweight sidebar badge count provider.
 *
 * Uses WebSocket (socket.io) for real-time updates.
 *
 * Exposes:
 *   tenantCounts  — { pendingQuotes, overdueInvoices, unpaidInvoices, subscription }
 *   masterCounts  — { newTenants, inactiveTenants, overdueInvoices, pendingBilling }
 *   globalUnreadCount — number of unread persistent notifications
 *   refresh()     — manually trigger a count refresh
 */

const API_BASE_URL = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || 'http://localhost:5000';

const NotificationContext = createContext(null);

const DEFAULT_TENANT_COUNTS = {
  pendingQuotes:               0,
  overdueInvoices:             0,
  unpaidInvoices:              0,
  pendingVerificationInvoices: 0,
  subscription:                null,
  feed:                        []
};

const DEFAULT_MASTER_COUNTS = {
  newTenants:      0,
  inactiveTenants: 0,
  overdueInvoices: 0,
  pendingBilling:  0,
  feed:            []
};

export const NotificationProvider = ({ children }) => {
  const { isAuthenticated, isMasterAdmin } = useAuth();
  const { showToast } = useToast();

  const [tenantCounts, setTenantCounts] = useState(DEFAULT_TENANT_COUNTS);
  const [masterCounts, setMasterCounts] = useState(DEFAULT_MASTER_COUNTS);
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const isFetchingRef = useRef(false);
  const socketRef = useRef(null);

  const togglePanel = useCallback(() => {
    setIsPanelOpen(prev => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  const fetchCounts = useCallback(async () => {
    if (!isAuthenticated || isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      if (isMasterAdmin) {
        try {
          const data = await api.getMasterNotifications();
          setMasterCounts({
            newTenants: data.newTenants || 0,
            inactiveTenants: data.inactiveTenants || 0,
            overdueInvoices: data.overdueInvoices || 0,
            pendingBilling: data.pendingBilling || 0,
            feed: data.feed || []
          });
        } catch (e) {
          console.error('Failed to fetch master counts', e);
        }
      } else {
        try {
          const data = await api.getNotificationCounts();
          setTenantCounts({
            pendingQuotes: data.pendingQuotes || 0,
            overdueInvoices: data.overdueInvoices || 0,
            unpaidInvoices: data.unpaidInvoices || 0,
            pendingVerificationInvoices: data.pendingVerificationInvoices || 0,
            subscription: data.subscription || null,
            feed: data.feed || []
          });
        } catch (e) {
          console.error('Failed to fetch tenant counts', e);
        }
      }

      // Fetch persistent notifications unread count independently
      try {
        const notifData = await api.getNotifications({ limit: 1 });
        setGlobalUnreadCount(notifData.unreadCount || 0);
      } catch (e) {
        console.error('Failed to fetch global unread count', e);
      }
    } catch (err) {
      console.error(err);
      // Silently ignore errors — stale counts are fine
    } finally {
      isFetchingRef.current = false;
    }
  }, [isAuthenticated, isMasterAdmin]);

  // Initial fetch + WebSocket setup
  useEffect(() => {
    if (!isAuthenticated) {
      setTenantCounts(DEFAULT_TENANT_COUNTS);
      setMasterCounts(DEFAULT_MASTER_COUNTS);
      setIsPanelOpen(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    fetchCounts();

    const token = localStorage.getItem('invoice_saas_token');
    
    if (token && !socketRef.current) {
      socketRef.current = io(API_BASE_URL, {
        auth: { token }
      });

      socketRef.current.on('connect', () => {
        console.log('[NotificationService] WebSocket connected');
      });

      socketRef.current.on('notification', (newNotification) => {
        console.log('[NotificationService] New notification received:', newNotification);
        
        if (newNotification && newNotification.title) {
          showToast(`${newNotification.title}: ${newNotification.message}`, 'info');
        }

        // Refetch counts and feed to stay perfectly in sync without complex merging logic
        fetchCounts();
      });
      
      socketRef.current.on('disconnect', () => {
        console.log('[NotificationService] WebSocket disconnected');
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isAuthenticated, fetchCounts]);

  // Re-fetch on tab focus after being hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isAuthenticated) {
        fetchCounts();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchCounts, isAuthenticated]);

  const refresh = useCallback(() => fetchCounts(), [fetchCounts]);

  return (
    <NotificationContext.Provider value={{ 
      tenantCounts, 
      masterCounts, 
      globalUnreadCount,
      setGlobalUnreadCount,
      refresh,
      isPanelOpen,
      togglePanel,
      closePanel
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return ctx;
};

export default NotificationContext;
