import { useEffect, useState } from 'react';
import { api, dlOpen, getToken } from '../api';
import { Icon, Modal, Spinner, useToast } from '../ui';

/**
 * Create Resume: paste text/LaTeX → AI extracts → LaTeX template → PDF,
 * optionally with ATS-tuned variants per job type. Shows a provider/API-key
 * box when no LLM is available (Ollama down, no saved token).
 */
export default function ImportModal({ open, onClose }) {
  const toast = useToast();
  const [phase, setPhase] = useState('pick'); // pick | busy | done
  const [llm, setLlm] = useState(null);
  const [provider, setProvider] = useState('groq');
  const [apiKey, setApiKey] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [types, setTypes] = useState([]);
  const [roles, setRoles] = useState(() => new Set());
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setPhase('pick');
    setErr('');
    setResult(null);
    api('/api/llm/status').then(setLlm).catch(() => setLlm(null));
    api('/api/job-types').then(({ types: t }) => setTypes(t)).catch(() => setTypes([]));
  }, [open]);

  const needsToken = llm && llm.needs_token;
  const providers = (llm && llm.providers) || {};
  const keysUrl = (providers[provider] || {}).keysUrl;

  const saveToken = async () => {
    if (!apiKey.trim()) return;
    try {
      setLlm(await api('/api/llm/token', { method: 'POST', body: { provider, api_key: apiKey.trim() } }));
      setApiKey('');
      toast('AI token saved', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const toggleRole = (id) => {
    const next = new Set(roles);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setRoles(next);
  };

  const generate = async () => {
    if (!text.trim()) { setErr('Paste your resume text first.'); return; }
    setErr('');
    setPhase('busy');
    try {
      // Not using api(): this call can run for tens of seconds, keep it explicit.
      const res = await fetch('/api/resume/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text, roles: [...roles] }),
      });
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({ detail: 'Import failed' }));
        throw new Error(detail || 'Import failed');
      }
      setResult(await res.json());
      setPhase('done');
    } catch (e) {
      setErr(e.message);
      setPhase('pick');
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={520}>
      <div className="modal-head">
        <div className="modal-title">
          <span style={{ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: '#a78bfa' }}>
            <Icon d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" size={15} />
          </span>
          <span>Create Resume</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon d="M6 18L18 6M6 6l12 12" />
        </button>
      </div>

      <div className="modal-body">
        {phase === 'busy' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '28px 0' }}>
            <Spinner />
            <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>Extracting with AI &amp; compiling PDF…</p>
            <p style={{ fontSize: 12, color: 'var(--faint)' }}>This can take a minute on first run.</p>
          </div>
        )}

        {phase === 'done' && result && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
              <Icon d="M5 13l4 4L19 7" size={19} style={{ color: 'var(--green)' }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                Rebuilt <span style={{ color: '#a78bfa' }}>{result.name || 'Resume'}</span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => dlOpen(result.base.pdf_url)}>Download PDF</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => dlOpen(result.base.tex_url)}>Download .tex</button>
            </div>
            {result.variants && result.variants.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="section-label">Specialised versions</p>
                {result.variants.map((v) => (
                  <div
                    key={v.jobType}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 10,
                      padding: '8px 12px', marginBottom: 6, fontSize: 12.5,
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.label}
                      {!v.tailored && <span style={{ color: 'var(--faint)' }}> · same as base</span>}
                    </span>
                    <span style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                      <button style={{ color: '#a78bfa', fontWeight: 600, fontSize: 12.5 }} onClick={() => dlOpen(v.pdf_url)}>PDF</button>
                      <button style={{ color: 'var(--muted)', fontSize: 12.5 }} onClick={() => dlOpen(v.tex_url)}>.tex</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => { setPhase('pick'); setResult(null); }}>
              Create another
            </button>
          </>
        )}

        {phase === 'pick' && (
          <>
            {llm && !needsToken && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--faint)', marginBottom: 12 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />
                AI ready · {llm.provider} · {llm.model}
              </p>
            )}
            {needsToken && (
              <div className="token-box">
                <div className="msg">
                  Ollama isn't running — paste a free AI API key to continue
                  {keysUrl && <> (<a href={keysUrl} target="_blank" rel="noopener noreferrer">get one free</a>)</>}.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <select className="select" style={{ maxWidth: 150 }} value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {Object.entries(providers).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <input
                    className="input" type="password" placeholder="Paste API key"
                    style={{ flex: 1, minWidth: 150 }} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button className="btn btn-primary btn-sm" onClick={saveToken}>Save</button>
                </div>
              </div>
            )}

            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 12 }}>
              Paste your résumé below — plain text or LaTeX. The AI extracts the content and rebuilds
              it in the Apsis template, then compiles a clean PDF.
            </p>
            <textarea
              className="input" rows={9} style={{ minHeight: 180 }}
              placeholder="Paste your resume here — name, contact, education, work experience, projects, skills, coding profiles, achievements…"
              value={text} onChange={(e) => setText(e.target.value)}
            />
            {err && (
              <p style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, fontSize: 12.5, background: 'rgba(248,81,73,.12)', border: '1px solid rgba(248,81,73,.35)', color: '#ff8b84' }}>
                {err}
              </p>
            )}

            <div style={{ marginTop: 16 }}>
              <p className="section-label">
                Also make specialised versions for <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional, ATS-tuned per role)</span>
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {types.map((t) => (
                  <button key={t.id} className={`chip${roles.has(t.id) ? ' active' : ''}`} onClick={() => toggleRole(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={generate}>
                <Icon d="M5 13l4 4L19 7" size={15} />
                Generate Resume
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
