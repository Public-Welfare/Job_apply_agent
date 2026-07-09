const TOKEN_KEY = 'apsis_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  location.replace('/login');
}

/** Authenticated JSON fetch. Bounces to /login on 401; throws {detail} errors. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail || 'Request failed');
  }
  return res.json();
}

/**
 * Downloads: <a> links can't send the Authorization header, so fetch a
 * short-lived ticket and open the URL with it — the session JWT never
 * appears in a URL.
 */
export async function dlOpen(url) {
  const { token } = await api('/api/download-ticket');
  window.open(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), '_blank');
}
