import React, { createContext, useContext, useState, useCallback } from 'react';

const ModalContext = createContext(null);

export const ModalProvider = ({ children }) => {
  const [modalState, setModalState] = useState({
    isOpen: false,
    type: 'confirm', // 'confirm' or 'prompt'
    title: '',
    message: '',
    placeholder: '',
    inputValue: '',
    resolve: null
  });

  const confirm = useCallback(({ title = 'Confirm', message = 'Are you sure?' }) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: 'confirm',
        title,
        message,
        placeholder: '',
        inputValue: '',
        resolve
      });
    });
  }, []);

  const prompt = useCallback(({ title = 'Input Required', message = '', placeholder = '' }) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        type: 'prompt',
        title,
        message,
        placeholder,
        inputValue: '',
        resolve
      });
    });
  }, []);

  const handleClose = (result) => {
    if (modalState.resolve) {
      modalState.resolve(result);
    }
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (modalState.type === 'prompt') {
      handleClose(modalState.inputValue);
    } else {
      handleClose(true);
    }
  };

  return (
    <ModalContext.Provider value={{ confirm, prompt }}>
      {children}
      
      {modalState.isOpen && (
        <>
          <div 
            className="modal-overlay"
            onClick={() => handleClose(modalState.type === 'prompt' ? null : false)}
            style={{ zIndex: 9999, opacity: 1, pointerEvents: 'auto' }}
          />
          <div 
            className="glass-card modal-card"
            style={{
              position: 'fixed',
              top: '50%',
              left: 'calc(var(--sidebar-width, 260px) + (100vw - var(--sidebar-width, 260px)) / 2)',
              transform: 'translate(-50%, -50%)',
              zIndex: 10000,
              width: 'min(90%, 400px)',
              maxWidth: '400px',
              padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}
          >
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
              {modalState.title}
            </h3>
            {modalState.message && (
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                {modalState.message}
              </p>
            )}
            
            <form onSubmit={handleSubmit}>
              {modalState.type === 'prompt' && (
                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={modalState.placeholder}
                    value={modalState.inputValue}
                    onChange={(e) => setModalState(prev => ({ ...prev, inputValue: e.target.value }))}
                    autoFocus
                  />
                </div>
              )}
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => handleClose(modalState.type === 'prompt' ? null : false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {modalState.type === 'prompt' ? 'Submit' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};
