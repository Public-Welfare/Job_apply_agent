export const STATUS = {
  not_applied: { label: 'Not Applied', bg: 'rgba(139,148,158,.15)', fg: '#9ca3af', dot: '#6b7280' },
  applied:     { label: 'Applied',     bg: 'rgba(56,139,253,.15)',  fg: '#388bfd', dot: '#388bfd' },
  interview:   { label: 'Interview',   bg: 'rgba(227,179,65,.15)',  fg: '#e3b341', dot: '#e3b341' },
  offer:       { label: 'Offer',       bg: 'rgba(63,185,80,.15)',   fg: '#3fb950', dot: '#3fb950' },
  rejected:    { label: 'Rejected',    bg: 'rgba(248,81,73,.15)',   fg: '#f85149', dot: '#f85149' },
};

export const SOURCE = {
  'Indeed India': { bg: 'rgba(255,107,44,.15)', fg: '#fb923c' },
  'Indeed':       { bg: 'rgba(255,107,44,.15)', fg: '#fb923c' },
  'RemoteOK':     { bg: 'rgba(124,58,237,.18)', fg: '#a78bfa' },
  'Greenhouse':   { bg: 'rgba(63,185,80,.15)',  fg: '#3fb950' },
  'Lever':        { bg: 'rgba(56,139,253,.15)', fg: '#388bfd' },
  'Ashby':        { bg: 'rgba(236,72,153,.15)', fg: '#ec4899' },
  'Workday':      { bg: 'rgba(14,165,233,.15)', fg: '#38bdf8' },
};

export const sourceStyle = (src) => SOURCE[src] || { bg: 'rgba(125,133,144,.15)', fg: '#8b949e' };

const AVATAR_PALETTES = [
  ['#388bfd', '#1e3a8a'], ['#8b5cf6', '#3b0764'], ['#3fb950', '#064e3b'],
  ['#e3b341', '#78350f'], ['#f85149', '#7f1d1d'], ['#0ea5e9', '#0c4a6e'],
  ['#ec4899', '#831843'],
];

export function avatarGradient(name) {
  let h = 0;
  for (const c of String(name || '?')) h = (h << 5) - h + c.charCodeAt(0);
  const [a, b] = AVATAR_PALETTES[Math.abs(h) % AVATAR_PALETTES.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function safeUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? u : '#';
  } catch {
    return '#';
  }
}

export function timeAgo(iso) {
  const d = Date.now() - new Date(iso);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dy = Math.floor(h / 24);
  if (dy < 30) return `${dy}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function logLineClass(line) {
  const l = line.toLowerCase();
  if (l.includes('error') || l.includes('failed') || l.includes('exit code 1')) return 'err';
  if (l.includes('http') || l.includes('dashboard')) return 'web';
  if (l.includes('processed') || l.includes('done') || l.includes('generated') || l.includes('saved')) return 'ok';
  if (line.startsWith('  ') || line.startsWith('\t')) return 'dim';
  return '';
}
