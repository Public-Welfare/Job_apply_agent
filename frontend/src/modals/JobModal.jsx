import { dlOpen } from '../api';
import { STATUS, avatarGradient, safeUrl, timeAgo } from '../utils';
import { Icon, Modal } from '../ui';
import { SourceBadge } from '../JobCard';

/** Popup with everything about one job (tracked application or cached job). */
export default function JobModal({ job, onClose }) {
  if (!job) return null;
  const st = job.status && STATUS[job.status];
  const salary = (job.salary || '').trim();
  const notes = (job.notes || '').trim();
  const kw = job.keywords_matched || [];
  const desc = (job.description || '').trim();

  return (
    <Modal open onClose={onClose} width={560}>
      <div className="modal-head">
        <div className="modal-title">
          <div className="avatar" style={{ background: avatarGradient(job.company), width: 38, height: 38 }}>
            {(job.company || '?')[0].toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, lineHeight: 1.35 }}>{job.title || 'Untitled role'}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[job.company || 'Unknown company', job.location].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon d="M6 18L18 6M6 6l12 12" />
        </button>
      </div>

      <div className="modal-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
          {job.source && <SourceBadge src={job.source} />}
          {st && (
            <span className="badge" style={{ background: st.bg, color: st.fg }}>
              <i style={{ background: st.dot }} />
              {st.label}
            </span>
          )}
          {job.applied_at && (
            <span style={{ fontSize: 12, color: 'var(--faint)' }} title={job.applied_at}>{timeAgo(job.applied_at)}</span>
          )}
        </div>

        {salary && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: '#5fd17a', marginBottom: 12 }}>
            <Icon d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={14} />
            {salary}
          </p>
        )}

        {notes && (
          <p style={{ fontSize: 12.5, fontStyle: 'italic', color: 'var(--muted)', background: 'var(--elevated)', borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
            {notes}
          </p>
        )}

        {kw.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <p className="section-label">Matched keywords</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {kw.map((k, i) => (
                <span key={k} className="kw-chip" style={{ animationDelay: `${i * 35}ms` }}>{k}</span>
              ))}
            </div>
          </div>
        )}

        {desc ? (
          <div>
            <p className="section-label">Job description</p>
            <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--muted)', whiteSpace: 'pre-line' }}>{desc}</div>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--faint)' }}>No description was captured for this job.</p>
        )}

        {(job.apply_url || (job.resume_path && job.id)) && (
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            {job.apply_url && (
              <a className="btn btn-primary" style={{ flex: 1 }} href={safeUrl(job.apply_url)} target="_blank" rel="noopener noreferrer">
                <Icon d="M13 7l5 5m0 0l-5 5m5-5H6" size={15} />
                Open Job Listing
              </a>
            )}
            {job.resume_path && job.id && (
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => dlOpen(`/api/resume/${job.id}`)}>
                Resume PDF
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
