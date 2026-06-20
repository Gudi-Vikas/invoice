import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, Copy, ShieldCheck, Download } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';

const DocumentListTable = ({ defaultType, onViewDetails, onCopyLink, onVerifyPayment }) => {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const clientId = searchParams.get('client');
  
  const [documents, setDocuments] = useState([]);
  const [stats, setStats] = useState({});
  const [clients, setClients] = useState([]);
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDate, setFilterDate] = useState('all'); // could be "all", "this_month", "last_month" etc

  const currencySymbol = settings?.tax_config?.currencySymbol || '₹';

  const loadData = useCallback(async () => {
    try {
      const statsParams = { type: defaultType };
      if (clientId) statsParams.clientId = clientId;
      
      const statsData = await api.getDocumentStats(statsParams);
      setStats(statsData || {});
      
      const params = { page, limit: 10, type: defaultType };
      if (clientId) params.clientId = clientId;
      if (filterStatus !== 'all') params.status = filterStatus;
      
      // Basic date filtering based on selection
      if (filterDate === 'this_month') {
        const date = new Date();
        params.dateFrom = new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
      }
      
      const data = await api.getDocuments(params);
      setDocuments(data.documents || []);
      setTotalPages(data.totalPages || 1);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      showToast('Failed to load documents: ' + err.message, 'error');
    }
  }, [page, filterStatus, filterDate, defaultType, clientId, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allStatuses = [
    { key: 'all', label: 'All' },
    { key: 'published', label: 'Published' },
    { key: 'draft', label: 'Draft' },
    { key: 'sent', label: 'Sent' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'declined', label: 'Declined' },
    { key: 'paid', label: 'Paid' },
    { key: 'pending_verification', label: 'Pending Verification' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'voided', label: 'Voided' }
  ];

  // Render top status counts
  const renderStatusLinks = () => {
    return allStatuses.map((s, idx) => {
      const count = stats[s.key] || 0;
      if (s.key !== 'all' && count === 0) return null; // hide empty statuses
      
      const isActive = filterStatus === s.key;
      return (
        <span key={s.key}>
          <button
            onClick={() => { setFilterStatus(s.key); setPage(1); }}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: isActive ? 'var(--text-primary)' : 'var(--accent-primary)',
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer', fontSize: '0.85rem'
            }}
          >
            {s.label} <span style={{ color: 'var(--text-muted)' }}>({count})</span>
          </button>
          {idx < allStatuses.length - 1 && <span style={{ margin: '0 0.5rem', color: 'var(--border-color)' }}>|</span>}
        </span>
      );
    });
  };

  return (
    <div className="wp-list-table-container fade-in">
      {/* Top Status Links */}
      <div style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        {renderStatusLinks()}
      </div>

      {/* Filters & Actions Bar */}
      <div className="glass-card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select className="form-select" style={{ padding: '0.3rem 1.5rem 0.3rem 0.75rem', fontSize: '0.85rem' }} value={filterDate} onChange={e => { setFilterDate(e.target.value); setPage(1); }}>
            <option value="all">All dates</option>
            <option value="this_month">This Month</option>
          </select>
          <select className="form-select" style={{ padding: '0.3rem 1.5rem 0.3rem 0.75rem', fontSize: '0.85rem' }} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="all">View all statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
          <button className="btn btn-secondary" style={{ padding: '0.3rem 1rem', fontSize: '0.85rem' }} onClick={() => loadData()}>
            Filter
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{totalCount} items</span>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: '0.85rem' }}>{page} of {totalPages}</span>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 0 }}>
        <div className="table-container" style={{ margin: 0 }}>
          {documents.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>No {defaultType}s found.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                  <th>Date Info</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id}>
                    <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{doc.document_number}</td>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{doc.client_name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.client_email}</div>
                    </td>
                    <td>
                      <span className={`badge badge-${doc.status}`} style={{ textTransform: 'capitalize' }}>
                        {doc.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{new Date(doc.created_at).toLocaleDateString()}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Due: {new Date(doc.due_date).toLocaleDateString()}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {currencySymbol}{parseFloat(doc.total_due).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        {doc.status === 'pending_verification' && (
                          <button 
                            className="btn btn-primary" 
                            style={{ padding: '0.4rem 0.5rem', backgroundColor: 'var(--accent-warning)', borderColor: 'var(--accent-warning)', color: '#fff' }} 
                            onClick={() => onVerifyPayment(doc)}
                            title="Verify Payment"
                          >
                            <ShieldCheck size={14} />
                          </button>
                        )}
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.5rem' }} onClick={() => onViewDetails(doc.id)} title="View Document">
                          <Check size={14} style={{ opacity: 0 }} /> {/* visual placeholder */}
                          View
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.5rem' }}
                          onClick={() => onCopyLink(doc)}
                          title="Copy Magic Link"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Published<br/>{new Date(doc.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Bottom Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{totalCount} items</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: '0.85rem' }}>{page} of {totalPages}</span>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentListTable;
