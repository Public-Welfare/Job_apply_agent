import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { logLineClass } from '../utils';
import { Icon, Modal, useToast } from '../ui';

/**
 * New Crawl modal. Pre-state: role multi-select + the 24h non-admin gate.
 * Running state: live log streamed by the crawl hook in App (props.crawl).
 */
export default function CrawlModal({ open, onClose, crawl }) {
  const toast = useToast();
  const [roles, setRoles] = useState(null); // null = loading
  const [checked, setChecked] = useState(new Set());
  const [gate, setGate] = useState(null);
  const [starting, setStarting] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    if (!open || crawl.running) return;
    setRoles(null);
    api('/api/roles')
      .then((rs) => {
        setRoles(rs);
        setChecked(new Set(rs.map((r) => r.role)));
      })
      .catch(() => setRoles([]));
    api('/api/crawl/schedule')
      .then((sc) => setGate(sc.may_crawl ? null : `A crawl ran in the last ${sc.interval_hours}h. Only an admin can start another before then.`))
      .catch(() => setGate(null));
  }, [open, crawl.running]);

  // Keep the log pinned to the bottom as lines stream in.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [crawl.lines]);

  const toggle = (role) => {
    const next = new Set(checked);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setChecked(next);
  };

  const toggleAll = () => {
    if (!roles) return;
    setChecked(checked.size === roles.length ? new Set() : new Set(roles.map((r) => r.role)));
  };

  const start = async () => {
    setStarting(true);
    try {
      await crawl.start(roles && checked.size < roles.length ? [...checked] : []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={520}>
      <div className="modal-head">
        <div className="modal-title">
          <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: '#a78bfa' }}>
            <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={15} />
          </span>
          <span>{crawl.running ? 'Crawl in progress' : 'New Crawl'}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon d="M6 18L18 6M6 6l12 12" />
        </button>
      </div>

      <div className="modal-body">
        {crawl.running || crawl.lines.length ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: crawl.running ? 'var(--yellow)' : 'var(--green)',
                  animation: crawl.running ? 'pulse 1.2s ease infinite' : 'none',
                }}
              />
              {crawl.running ? 'Running… the agent is searching and tailoring resumes.' : 'Complete'}
            </div>
            <div className="log-box" ref={logRef}>
              {crawl.lines.map((line, i) => (
                <div key={i} className={`log-line ${logLineClass(line)}`}>{line}</div>
              ))}
            </div>
            {!crawl.running && (
              <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={onClose}>Done</button>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 14 }}>
              The agent searches the boards for your target roles, tailors a resume for each match,
              and saves everything to the tracker for you to review.
            </p>

            {gate && (
              <div className="token-box"><div className="msg" style={{ marginBottom: 0 }}>{gate}</div></div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p className="section-label" style={{ marginBottom: 0 }}>Roles to crawl</p>
              {roles && roles.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={toggleAll}>Toggle all</button>
              )}
            </div>
            {roles === null ? (
              <div className="skeleton" style={{ height: 70 }} />
            ) : roles.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, maxHeight: 220, overflowY: 'auto' }}>
                {roles.map((r) => (
                  <label key={r.id ?? r.role} className="role-check" title={r.role}>
                    <input type="checkbox" checked={checked.has(r.role)} onChange={() => toggle(r.role)} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.role}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12.5, color: 'var(--faint)' }}>No roles configured — the crawl will use your profile roles.</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!!gate || starting || (roles !== null && roles.length > 0 && checked.size === 0)} onClick={start}>
                <Icon d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" size={15} />
                Start Crawl
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
