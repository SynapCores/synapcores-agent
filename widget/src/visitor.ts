/* Visitor identity — UUID held across page loads.
 *
 * Order of preference:
 *   1. localStorage (survives Safari ITP cap better than 3rd-party cookies,
 *      GDPR-friendlier — non-tracking storage typically doesn't trip consent).
 *   2. Cookie fallback (Lax / 1y) when localStorage is blocked (private
 *      browsing, embedded webviews with storage walls).
 *   3. In-memory only when both are blocked — visitor identity is coherent
 *      for this page session but does not survive a reload.
 */

const KEY = 'synapcores_visitor';

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string): void {
  const exp = new Date(Date.now() + 365 * 24 * 3600 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

function newId(): string {
  // crypto.randomUUID() is in every browser we target (ES2020 lib). Fall back
  // to a Math.random() shape only as a last resort for jurassic environments.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getVisitorId(): string {
  try {
    const cached = localStorage.getItem(KEY);
    if (cached) return cached;
    const fresh = newId();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    /* localStorage blocked — fall through */
  }
  const fromCookie = readCookie(KEY);
  if (fromCookie) return fromCookie;
  const fresh = newId();
  try {
    writeCookie(KEY, fresh);
  } catch {
    /* cookies blocked too — caller gets an in-memory id for this load */
  }
  return fresh;
}
