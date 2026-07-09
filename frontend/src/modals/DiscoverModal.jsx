import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { safeUrl } from '../utils';
import { Icon, Modal, Spinner, useToast } from '../ui';

/** Browse every source's cached jobs by job type; refresh runs discovery. */
export default function DiscoverModal({ open, onClose, onOpenJob }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null); // null = loading
  const [status, setStatus] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const debounceRef = useRef(null);

  const loadTypes = useCallback(async () => {
    try {
      const { types: t, total } = await api('/api/job-types');
      setTypes(t);
      setStatus((s) => s || `${total} jobs cached across all sources`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [toast]);

  const loadJobs = useCallback(async (sel, q) => {
    const qs = new URLSearchParams({ limit: '300' });
    if (sel.size) qs.set('types', [...sel].join(','));
    if (q) qs.set('search', q);
    setData(null);
    try {
      setData(await api('/api/jobs?' + qs));
    } catch (e) {
      setData({ total: 0, groups: {}, labels: {}, error: e.message });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadTypes();
    loadJobs(selected, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    loadJobs(next, search);
  };

  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadJobs(selected, v.trim()), 300);
  };

  const refresh = async () => {
    try {
      await api('/api/jobs/refresh', { method: 'POST' });
    } catch (e) {
      if (!/in progress/i.test(e.message)) { toast(e.message, 'error'); return; }
    }
    setRefreshing(true);
    const poll = async () => {
      try {
        const st = await api('/api/jobs/refresh/status');
        setStatus(st.running && st.log.length ? st.log[st.log.length - 1] : '');
        if (st.running) { setTimeout(poll, 1500); return; }
        setRefreshing(false);
        toast(`Discovery done — ${st.summary ? st.summary.total : 0} jobs`, 'success');
        loadTypes();
        loadJobs(selected, search);
      } catch (e) {
        setRefreshing(false);
        toast(e.message, 'error');
      }
    };
    setTimeout(poll, 1200);
  };

  const openJob = async (id) => {
    try {
      onOpenJob(await api('/api/jobs/cached/' + encodeURIComponent(id)));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const groups = data ? Object.entries(data.groups || {}).filter(([, jobs]) => jobs.length) : [];

  return (
    <Modal open={open} onClose={onClose} width={860}>
      <div className="modal-head">
        <div className="modal-title">
          <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: '#a78bfa' }}>
            <Icon d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={15} />
          </span>
          <span>Discover jobs</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon d="M6 18L18 6M6 6l12 12" />
        </button>
      </div>

      <div className="modal-body">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input
            className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Search title or company…"
            value={search} onChange={(e) => onSearch(e.target.value)}
          />
          <button className="btn btn-ghost btn-sm" disabled={refreshing} onClick={refresh}>
            {refreshing ? <Spinner size={13} /> : <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={14} />}
            Refresh from all sources
          </button>
        </div>

        {status && <p style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 10 }}>{status}</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {types.map((t) => (
            <button key={t.id} className={`chip${selected.has(t.id) ? ' active' : ''}`} onClick={() => toggle(t.id)}>
              {t.label}
              <span className="c">{t.count}</span>
            </button>
          ))}
        </div>

        {data === null ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}
          </div>
        ) : data.error ? (
          <p style={{ fontSize: 13, color: 'var(--red)' }}>{data.error}</p>
        ) : !data.total ? (
          <div className="empty" style={{ padding: '40px 0' }}>
            <p style={{ fontSize: 13.5 }}>No jobs match. Try <b style={{ color: 'var(--text)' }}>Refresh from all sources</b> or widen your selection.</p>
          </div>
        ) : (
          groups.map(([id, jobs]) => (
            <div key={id} style={{ marginBottom: 20 }}>
              <p className="section-label" style={{ color: '#a78bfa' }}>
                {(data.labels || {})[id] || id} <span style={{ color: 'var(--faint)' }}>· {jobs.length}</span>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 8 }}>
                {jobs.map((j) => (
                  <div
                    key={j.id}
                    onClick={() => openJob(j.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                      background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 12,
                      padding: '10px 12px', cursor: 'pointer',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.title}>{j.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[j.company, j.location].filter(Boolean).join(' · ')}
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                        <span className="badge" style={{ background: 'var(--accent-soft)', color: '#a78bfa' }}>{j.source}</span>
                        {(j.categories || []).slice(0, 3).map((c) => (
                          <span key={c} className="badge" style={{ background: 'rgba(255,255,255,.05)', color: 'var(--faint)' }}>{c}</span>
                        ))}
                      </div>
                    </div>
                    <a
                      className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}
                      href={safeUrl(j.apply_url)} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Apply
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
