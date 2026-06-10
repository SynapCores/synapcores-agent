/* HMAC-signed HttpOnly session cookies.
 *
 * The browser never holds a SynapCores credential. It holds only this
 * cookie — an HMAC-SHA256-signed JSON payload identifying the visitor and
 * the project. The cookie is HttpOnly so JS can't read it and SameSite=Lax
 * so it travels on top-level navigations but not 3rd-party fetches.
 *
 * Cookie value format: base64url(json) + "." + base64url(hmac(secret, json))
 * Payload: { v: 1, vid: string, pk: string, iat: int }
 *
 * Verify rejects: bad base64, bad JSON, bad HMAC, expired cookies (iat +
 * ttl < now), version mismatch.
 */

import crypto from 'node:crypto';
import { parse, serialize } from 'cookie';

const VERSION = 1;

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest();
}

/** @returns {string} HttpOnly Set-Cookie header value */
export function makeSessionCookie({
  secret,
  cookieName,
  ttlSeconds,
  visitorId,
  projectKey,
  sameSiteNone = false,
}) {
  const payload = JSON.stringify({
    v: VERSION,
    vid: visitorId,
    pk: projectKey,
    iat: Math.floor(Date.now() / 1000),
  });
  const sig = hmac(secret, payload);
  const value = `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
  // SameSite=Lax fits same-origin dev (widget + proxy on the same host).
  // Production embed runs cross-origin — set same_site_none in projects.json,
  // and HTTPS becomes mandatory (Secure flag).
  return serialize(cookieName, value, {
    httpOnly: true,
    sameSite: sameSiteNone ? 'none' : 'lax',
    secure: sameSiteNone || process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttlSeconds,
  });
}

/**
 * @returns {null | {visitorId: string, projectKey: string, iat: number}}
 */
export function verifySessionCookie(headerValue, { secret, cookieName, ttlSeconds }) {
  if (!headerValue) return null;
  const cookies = parse(headerValue);
  const raw = cookies[cookieName];
  if (!raw || !raw.includes('.')) return null;
  const [payloadB64, sigB64] = raw.split('.');
  let payload;
  let payloadBytes;
  let sigBytes;
  try {
    payloadBytes = b64urlDecode(payloadB64);
    sigBytes = b64urlDecode(sigB64);
    payload = JSON.parse(payloadBytes.toString('utf-8'));
  } catch {
    return null;
  }
  const expected = hmac(secret, payloadBytes);
  if (
    expected.length !== sigBytes.length ||
    !crypto.timingSafeEqual(expected, sigBytes)
  ) {
    return null;
  }
  if (payload.v !== VERSION) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number' || payload.iat + ttlSeconds < now) return null;
  if (typeof payload.vid !== 'string' || typeof payload.pk !== 'string') return null;
  return { visitorId: payload.vid, projectKey: payload.pk, iat: payload.iat };
}

/** Generate a fresh visitor id (UUID v4 via node:crypto). */
export function newVisitorId() {
  return crypto.randomUUID();
}

/**
 * Deterministic per-visitor-per-project chat session id.
 *
 * HMAC(secret, "scs1:" + visitorId + ":" + projectKey), b64url-truncated.
 * Recoverable across proxy restarts without any in-memory state, and the
 * `scs1:` prefix lets us re-key the derivation in a future migration if
 * we ever need to.
 */
export function deriveSessionId(secret, visitorId, projectKey) {
  const digest = crypto.createHmac('sha256', secret).update(`scs1:${visitorId}:${projectKey}`).digest();
  return Buffer.from(digest)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 22);
}
