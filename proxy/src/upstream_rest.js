/* Thin REST client for the upstream SynapCores gateway.
 *
 * The proxy speaks AiChatWsMessage over WS for chat; for HISTORY retrieval
 * we use the existing REST endpoint:
 *
 *   GET /v1/chat/sessions/{session_id}/messages?page_size=N
 *
 * Returns the raw messages array (or empty when the session is brand
 * new). Errors are swallowed to an empty-history result on the proxy side
 * — a missing history is not a fatal widget condition.
 */

/**
 * @param {Object} args
 * @param {string} args.apiBase
 * @param {string} args.token
 * @param {string} args.sessionId
 * @param {number} [args.pageSize]
 * @returns {Promise<Array<{role?: string, content?: string, created_at?: string, [k: string]: unknown}>>}
 */
export async function fetchHistory({ apiBase, token, sessionId, pageSize = 40 }) {
  const url = `${apiBase}/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages?page_size=${pageSize}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/json',
      },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let body;
  try {
    body = await res.json();
  } catch {
    return [];
  }
  // Gateway responses are typically `{success: true, data: [...]}` for
  // success_response(). Tolerate either shape.
  const data = body?.data ?? body?.messages ?? body;
  return Array.isArray(data) ? data : [];
}
