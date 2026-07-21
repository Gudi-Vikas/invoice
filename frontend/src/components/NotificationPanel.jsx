import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { X, Bell, ExternalLink, Calendar, Check, CheckCheck } from 'lucide-react';
import api from '../api';

export const NotificationPanel = () => {
  const { isPanelOpen, closePanel, globalUnreadCount, setGlobalUnreadCount } = useNotifications();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Handle escape key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isPanelOpen) closePanel();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isPanelOpen, closePanel]);

  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      const data = await api.getNotifications({ page: pageNum, limit: 15 });
      setNotifications(prev => append ? [...prev, ...data.notifications] : data.notifications);
      setGlobalUnreadCount(data.unreadCount);
      setHasMore(data.notifications.length === 15);
      setPage(pageNum);
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isPanelOpen) {
      fetchNotifications(1, false);
    }
  }, [isPanelOpen, fetchNotifications]);

  const handleAction = async (item) => {
    if (!item.is_read) {
      await markAsRead(item.id);
    }
    const url = item.action_url;
    if (url) {
      try {
        const targetUrl = new URL(url, window.location.origin);
        targetUrl.searchParams.set('t', Date.now());
        navigate(targetUrl.pathname + targetUrl.search);
      } catch (e) {
        navigate(url);
      }
    }
    closePanel();
  };

  const markAsRead = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      await api.markNotificationAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setGlobalUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark as read', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.markAllNotificationsAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setGlobalUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read', err);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'danger': return 'var(--accent-danger)';
      case 'warning': return 'var(--accent-warning)';
      case 'success': return 'var(--accent-success)';
      case 'info': return 'var(--accent-primary)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="modal-overlay" 
        style={{
          opacity: isPanelOpen ? 1 : 0,
          pointerEvents: isPanelOpen ? 'auto' : 'none',
          transition: 'opacity 0.3s ease',
          zIndex: 1050
        }}
        onClick={closePanel}
      />

      {/* Slide-out Panel */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          right: isPanelOpen ? 0 : '-420px',
          width: '100%',
          maxWidth: '400px',
          height: '100vh',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 1100,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-card)'
        }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Bell size={20} style={{ color: 'var(--accent-primary)' }} />
            Notifications
            {globalUnreadCount > 0 && (
              <span className="badge" style={{ background: 'var(--accent-danger)', color: 'white', marginLeft: '0.5rem' }}>
                {globalUnreadCount}
              </span>
            )}
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(notifications.length > 0 || globalUnreadCount > 0) && (
              <button 
                className="btn btn-secondary" 
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', gap: '0.3rem', color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }}
                onClick={async () => {
                  if (confirm('Are you sure you want to clear all notifications?')) {
                    try {
                      await api.deleteAllNotifications();
                      setNotifications([]);
                      setGlobalUnreadCount(0);
                    } catch (err) {
                      console.error('Failed to clear all', err);
                    }
                  }
                }}
                title="Clear all notifications"
              >
                <X size={16} /> Clear All
              </button>
            )}
            <button 
              className="btn btn-secondary" 
              style={{ padding: '0.4rem', border: 'none', background: 'transparent' }}
              onClick={closePanel}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Feed Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {!notifications || notifications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <Bell size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
              <p>You're all caught up!</p>
              <p style={{ fontSize: '0.85rem' }}>No new notifications.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {notifications.map((item, idx) => {
                const color = getStatusColor(item.status || 'info');
                const isRead = item.is_read;
                
                return (
                  <div 
                    key={`${item.id}-${idx}`}
                    className="glass-card"
                    style={{
                      padding: '1rem',
                      borderLeft: `4px solid ${isRead ? 'var(--border-color)' : color}`,
                      background: isRead ? 'var(--bg-secondary)' : 'var(--bg-card)',
                      cursor: item.action_url ? 'pointer' : 'default',
                      transition: 'transform 0.2s ease, border-color 0.2s ease',
                      position: 'relative',
                      opacity: isRead ? 0.7 : 1
                    }}
                    onClick={() => item.action_url && handleAction(item)}
                    onMouseEnter={(e) => {
                      if (item.action_url) e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: isRead ? 500 : 700, color: 'var(--text-primary)', paddingRight: '2rem' }}>
                        {item.title}
                      </h4>
                      <div style={{ position: 'absolute', top: '1rem', right: '1rem', display: 'flex', gap: '0.5rem' }}>
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '0.2rem', background: 'transparent', border: 'none', color: 'var(--accent-danger)' }}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await api.deleteNotification(item.id);
                              setNotifications(prev => prev.filter(n => n.id !== item.id));
                              if (!item.is_read) {
                                setGlobalUnreadCount(prev => Math.max(0, prev - 1));
                              }
                            } catch (err) {
                              console.error('Failed to delete', err);
                            }
                          }}
                          title="Delete notification"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                    
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                      {item.message}
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                      <span className="badge" style={{ 
                        background: `${color}15`, 
                        color: color, 
                        border: `1px solid ${color}30`,
                        padding: '0.15rem 0.5rem'
                      }}>
                        {item.type}
                      </span>
                      {item.created_at && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
                          <Calendar size={12} />
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {hasMore && (
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', marginTop: '0.5rem' }}
                  onClick={() => fetchNotifications(page + 1, true)}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load More'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default NotificationPanel;
