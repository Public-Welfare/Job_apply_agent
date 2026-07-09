import { useEffect, useRef, useState } from 'react';
import { dlOpen } from './api';
import { STATUS, avatarGradient, safeUrl, sourceStyle, timeAgo } from './utils';
import { Icon } from './ui';

export function SourceBadge({ src }) {
  const s = sourceStyle(src);
  return <span className="badge" style={{ background: s.bg, color: s.fg }}>{src || '—'}</span>;
}

/** Status pill with an inline dropdown to change it. */
export function StatusBadge({ status, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const m = STATUS[status] || STATUS.applied;
  return (
    <span ref={ref} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button className="badge status-btn" style={{ background: m.bg, color: m.fg }} onClick={() => setOpen(!open)}>
        <i style={{ background: m.dot }} />
        {m.label}
        <Icon d="M19 9l-7 7-7-7" size={9} width={2.5} />
      </button>
      {open && (
        <div className="pop">
          {Object.entries(STATUS).map(([k, v]) => (
            <button key={k} onClick={() => { setOpen(false); if (k !== status) onChange(k); }}>
              <i style={{ width: 7, height: 7, borderRadius: '50%', background: v.dot, flexShrink: 0 }} />
              {v.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default function JobCard({ app, index, onOpen, onStatus, onDelete }) {
  const stripe = (STATUS[app.status] || STATUS.applied).dot;
  const salary = (app.salary || '').trim();
  return (
    <div
      className="card"
      style={{ '--stripe': stripe, animationDelay: `${Math.min(index * 30, 400)}ms` }}
      onClick={() => onOpen(app)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div className="avatar" style={{ background: avatarGradient(app.company) }}>
          {(app.company || '?')[0].toUpperCase()}
        </div>
        <StatusBadge status={app.status} onChange={(s) => onStatus(app.id, s)} />
      </div>

      <h3 title={app.title}>{app.title}</h3>
      <p className="meta">
        {app.company || 'Unknown company'}
        {app.location ? ` · ${app.location}` : ''}
      </p>
      <p className="salary" style={{ color: salary ? '#5fd17a' : 'var(--faint)' }}>
        <Icon d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={14} />
        {salary || 'NA'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
        {app.source && <SourceBadge src={app.source} />}
        <span style={{ fontSize: 12, color: 'var(--faint)' }} title={app.applied_at}>{timeAgo(app.applied_at)}</span>
      </div>
      {app.notes && <p className="notes">{app.notes}</p>}

      <div className="card-foot" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 2 }}>
          {app.resume_path && (
            <button className="icon-btn" title="Download tailored resume" onClick={() => dlOpen(`/api/resume/${app.id}`)}>
              <Icon d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </button>
          )}
          {app.apply_url && (
            <a className="icon-btn" title="Open job listing" href={safeUrl(app.apply_url)} target="_blank" rel="noopener noreferrer">
              <Icon d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </a>
          )}
          <button className="icon-btn danger" title="Delete" onClick={() => onDelete(app.id)}>
            <Icon d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </button>
        </div>
        <button className="icon-btn" title="Details" onClick={() => onOpen(app)}>
          <Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </button>
      </div>
    </div>
  );
}
