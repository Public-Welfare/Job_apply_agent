import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, logout } from './api';
import { STATUS } from './utils';
import { Icon, useToast } from './ui';
import JobCard from './JobCard';
import JobModal from './modals/JobModal';
import CrawlModal from './modals/CrawlModal';
import DiscoverModal from './modals/DiscoverModal';
import ImportModal from './modals/ImportModal';

/**
 * Owns the background-crawl lifecycle: start, incremental ?since= log polling
 * (survives the modal being closed), and a completion toast + refresh.
 */
function useCrawl(onFinished) {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState([]);
  const seenRef = useRef(0);
  const activeRef = useRef(false);

  const poll = useCallback(async function tick() {
    try {
      const s = await api('/api/crawl/status?since=' + seenRef.current);
      if (s.log_offset < seenRef.current) {
        seenRef.current = 0;
        setLines([]);
      } else {
        if (s.log.length) setLines((p) => [...p, ...s.log]);
        seenRef.current = s.log_offset;
      }
      if (s.running) {
        setTimeout(tick, 1500);
      } else if (activeRef.current) {
        activeRef.current = false;
        setRunning(false);
        toast('Crawl complete — applications updated', 'success');
        onFinished();
      }
    } catch {
      if (activeRef.current) setTimeout(tick, 3000);
    }
  }, [toast, onFinished]);

  const start = useCallback(async (roles = []) => {
    await api('/api/crawl', { method: 'POST', body: { roles } });
    seenRef.current = 0;
    setLines([]);
    activeRef.current = true;
    setRunning(true);
    poll();
  }, [poll]);

  // Resume watching a crawl that was already running when the page loaded.
  useEffect(() => {
    api('/api/crawl/status')
      .then((s) => {
        if (s.running) {
          activeRef.current = true;
          setRunning(true);
          poll();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { running, lines, start };
}

const SORTS = [
  { v: 'newest', label: 'Newest first' },
  { v: 'oldest', label: 'Oldest first' },
];

export default function App() {
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [stats, setStats] = useState(null);
  const [apps, setApps] = useState(null); // null = loading
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');
  const [sources, setSources] = useState([]);

  const [jobModal, setJobModal] = useState(null);
  const [crawlOpen, setCrawlOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const searchTimer = useRef(null);
  const queryRef = useRef({ filterStatus: '', filterSource: '', sort: 'newest', search: '' });
  queryRef.current = { filterStatus, filterSource, sort, search };

  const loadStats = useCallback(() => api('/api/stats').then(setStats).catch(() => {}), []);

  const loadApps = useCallback(async () => {
    const q = queryRef.current;
    const p = new URLSearchParams({ sort: q.sort });
    if (q.filterStatus) p.set('status', q.filterStatus);
    if (q.filterSource) p.set('source', q.filterSource);
    if (q.search) p.set('search', q.search);
    try {
      const list = await api('/api/applications?' + p);
      setApps(list);
      // Source filter options come from the data itself.
      setSources((prev) => {
        const all = new Set(prev);
        list.forEach((a) => a.source && all.add(a.source));
        return [...all].sort();
      });
    } catch (e) {
      toast(e.message, 'error');
      setApps([]);
    }
  }, [toast]);

  const refresh = useCallback(() => { loadStats(); loadApps(); }, [loadStats, loadApps]);
  const crawl = useCrawl(refresh);

  useEffect(() => {
    api('/api/me').then(setMe).catch(() => {});
    refresh();
  }, [refresh]);

  useEffect(() => { setApps(null); loadApps(); }, [filterStatus, filterSource, sort, loadApps]);

  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadApps(), 300);
  };

  const setStatus = async (id, status) => {
    try {
      await api(`/api/applications/${id}/status`, { method: 'PATCH', body: { status } });
      toast(`Status → ${STATUS[status].label}`, 'success');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };

  const deleteApp = async (id) => {
    try {
      await api(`/api/applications/${id}`, { method: 'DELETE' });
      toast('Application removed', 'info');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };

  const statCells = [
    { key: '', label: 'Total', dot: 'var(--accent)', value: stats?.total },
    ...Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v.label, dot: v.dot, value: stats?.[k] })),
  ];

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a className="brand" href="/">
            <span className="brand-mark">A</span>
            <span>Apsis</span>
          </a>
          {crawl.running && (
            <button className="crawl-indicator" onClick={() => setCrawlOpen(true)}>
              <span className="dot" />
              Crawling…
            </button>
          )}
          <button className="btn btn-ghost btn-sm" title="Discover jobs" onClick={() => setDiscoverOpen(true)}>
            <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={14} />
            <span className="lbl-sm">Discover</span>
          </button>
          <button className="btn btn-ghost btn-sm" title="Create Resume" onClick={() => setImportOpen(true)}>
            <Icon d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" size={14} />
            <span className="lbl-sm">Create Resume</span>
          </button>
          <button className="btn btn-accent btn-sm" title="New Crawl" onClick={() => setCrawlOpen(true)}>
            <Icon d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" size={14} />
            <span className="lbl-sm">New Crawl</span>
          </button>
          <button className="icon-btn" title={me ? `Sign out (${me.username})` : 'Sign out'} onClick={logout}>
            <Icon d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </button>
        </div>
      </header>

      <main className="container" style={{ padding: '26px 20px 60px' }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>
            Your application <span style={{ color: '#a78bfa' }}>pipeline</span>
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 4 }}>
            Every role your agent finds, tailors, and tracks — in one place. Click a stat to filter.
          </p>
        </div>

        <div className="stats" style={{ marginBottom: 18 }}>
          {statCells.map((s) => (
            <button
              key={s.key || 'total'}
              className={`stat${filterStatus === s.key ? ' active' : ''}`}
              style={{ '--dot': s.dot }}
              onClick={() => setFilterStatus(filterStatus === s.key ? '' : s.key)}
            >
              <div className="num">{s.value ?? '—'}</div>
              <div className="lbl"><i />{s.label}</div>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          <input
            className="input" style={{ flex: 1, minWidth: 200 }}
            placeholder="Search title or company…"
            value={search} onChange={(e) => onSearch(e.target.value)}
          />
          <select className="select" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>

        {apps === null ? (
          <div className="grid">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ height: 200 }} />)}
          </div>
        ) : apps.length === 0 ? (
          <div className="empty">
            <span style={{ width: 54, height: 54, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--faint)' }}>
              <Icon d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" size={26} width={1.5} />
            </span>
            <div>
              <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>
                {filterStatus || filterSource || search ? 'No results found' : 'No applications yet'}
              </p>
              <p style={{ fontSize: 12.5, marginTop: 3 }}>
                {filterStatus || filterSource || search ? 'Try clearing the filters or search.' : 'Run a crawl to start finding jobs.'}
              </p>
            </div>
            {!(filterStatus || filterSource || search) && (
              <button className="btn btn-primary" onClick={() => setCrawlOpen(true)}>New Crawl</button>
            )}
          </div>
        ) : (
          <div className="grid">
            {apps.map((a, i) => (
              <JobCard key={a.id} app={a} index={i} onOpen={setJobModal} onStatus={setStatus} onDelete={deleteApp} />
            ))}
          </div>
        )}
      </main>

      {jobModal && <JobModal job={jobModal} onClose={() => setJobModal(null)} />}
      <CrawlModal open={crawlOpen} onClose={() => setCrawlOpen(false)} crawl={crawl} />
      <DiscoverModal open={discoverOpen} onClose={() => setDiscoverOpen(false)} onOpenJob={setJobModal} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

// Auth guard used by main.jsx before rendering anything.
export function requireAuthOrRedirect() {
  if (!getToken()) {
    location.replace('/login');
    return false;
  }
  return true;
}
