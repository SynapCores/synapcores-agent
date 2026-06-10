/* Per-visitor identity store + injector.
 *
 * When the host site calls `widget.identify({name, email, ...})`, the
 * widget POSTs the payload to the proxy's /v1/identify. The proxy stores
 * it keyed by visitorId (from the session cookie) and injects it into
 * `send_message.context.user` on every subsequent frame so the upstream
 * agent (AGENT_RUN) sees the visitor as identified.
 *
 * In-memory Map for v1 — sufficient for a single-instance proxy. If you
 * scale horizontally OR need identity to survive proxy restarts, persist
 * to SynapCores (one row per visitor in an `widget_identities` table,
 * keyed by visitorId). Out of scope for Sprint 3.
 */

/** @type {Map<string, {name?: string, email?: string, id?: string, attrs?: Record<string, unknown>, ts: number}>} */
const store = new Map();

const MAX_ENTRIES = 10_000;
const TTL_MS = 24 * 3600 * 1000;

export function setIdentity(visitorId, identity) {
  // Drop oldest if we're at the cap.
  if (store.size >= MAX_ENTRIES) {
    const firstKey = store.keys().next().value;
    if (firstKey) store.delete(firstKey);
  }
  store.set(visitorId, {
    name: identity.name,
    email: identity.email,
    id: identity.id,
    attrs: identity.attrs,
    ts: Date.now(),
  });
}

export function getIdentity(visitorId) {
  const id = store.get(visitorId);
  if (!id) return null;
  if (Date.now() - id.ts > TTL_MS) {
    store.delete(visitorId);
    return null;
  }
  return id;
}

export function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (v.ts < cutoff) store.delete(k);
}

setInterval(sweep, 3600_000).unref();
