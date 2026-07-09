import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ── Shared modal shell: backdrop click + Esc to close ────────────────── */
export function Modal({ open, onClose, width = 500, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }}>{children}</div>
    </div>
  );
}

export function ModalHead({ icon, title, onClose, children }) {
  return (
    <div className="modal-head">
      <div className="modal-title">
        {icon && (
          <span
            style={{
              width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center',
              background: 'var(--accent-soft)', color: '#a78bfa', flexShrink: 0,
            }}
          >
            {icon}
          </span>
        )}
        {children || <span>{title}</span>}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <Icon d="M6 18L18 6M6 6l12 12" />
      </button>
    </div>
  );
}

/* ── Inline SVG icon (heroicons outline paths) ─────────────────────────── */
export function Icon({ d, size = 16, width: sw = 2, style }) {
  return (
    <svg style={{ width: size, height: size, flexShrink: 0, ...style }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export const Spinner = ({ size = 30 }) => <span className="spinner" style={{ width: size, height: size }} />;

/* ── Toasts ────────────────────────────────────────────────────────────── */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

const TOAST_ICONS = {
  success: 'M5 13l4 4L19 7',
  error: 'M12 9v3m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <Icon d={TOAST_ICONS[t.type] || TOAST_ICONS.info} size={15} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
