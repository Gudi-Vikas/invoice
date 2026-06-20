/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback } from 'react';

/**
 * ToastContext — Global notification system.
 *
 * Usage:
 *   import { useToast } from '../context/ToastContext';
 *   const { showToast } = useToast();
 *   showToast('Client created successfully!', 'success');
 */

const ToastContext = createContext(null);

let toastId = 0;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast Container */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          zIndex: 9999,
          maxWidth: '420px'
        }}>
          {toasts.map(toast => {
            const colors = {
              success: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)', text: 'hsl(142, 72%, 70%)' },
              error:   { bg: 'rgba(239, 68, 68, 0.15)',  border: 'rgba(239, 68, 68, 0.4)',  text: 'hsl(350, 89%, 75%)' },
              info:    { bg: 'rgba(59, 130, 246, 0.15)',  border: 'rgba(59, 130, 246, 0.4)', text: 'hsl(217, 91%, 80%)' },
              warning: { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)', text: 'hsl(37, 90%, 70%)' }
            };
            const c = colors[toast.type] || colors.info;

            return (
              <div
                key={toast.id}
                className="toast-slide-in"
                style={{
                  background: c.bg,
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: `1px solid ${c.border}`,
                  borderRadius: '12px',
                  padding: '1rem 1.25rem',
                  color: c.text,
                  fontSize: '0.9rem',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 500,
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  animation: 'toastSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards'
                }}
              >
                <span>{toast.message}</span>
                <button
                  onClick={() => removeToast(toast.id)}
                  style={{
                    background: 'none', border: 'none', color: c.text,
                    cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1,
                    opacity: 0.7, flexShrink: 0
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider> tree.');
  }
  return ctx;
};

export default ToastContext;
