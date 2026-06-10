/* Session bootstrap via the widget-proxy.
 *
 * The widget no longer holds any SynapCores credential — not even a
 * short-lived JWT. It POSTs the project key to the proxy's /v1/session
 * endpoint; the proxy validates origin + project, sets an HttpOnly cookie
 * on the response, and replies with metadata (persona, agent name) that
 * the widget uses to render its header.
 *
 * The cookie is invisible to JS (HttpOnly), HMAC-signed by the proxy, and
 * automatically attached by the browser to the subsequent WS upgrade.
 *
 * `credentials: 'include'` makes the browser:
 *   - SEND any existing cookie on the proxy's origin
 *   - STORE the Set-Cookie response (subject to SameSite + Secure rules)
 *
 * For cross-origin embedding (proxy on a different origin from the host
 * site), the proxy must be configured with `session.same_site_none = true`
 * + HTTPS so the cookie is `SameSite=None; Secure`. Same-origin dev (proxy
 * serves both the embedding page and the widget) works with the default
 * `SameSite=Lax`.
 */

export interface SessionResponse {
  project_key: string;
  persona: string;
  agent_name: string;
  database: string;
  visitor_id: string;
}

export async function openSession(
  apiBase: string,
  projectKey: string,
  visitorId: string,
): Promise<SessionResponse> {
  const res = await fetch(`${apiBase}/v1/session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project_key: projectKey, visitor_id: visitorId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`session failed: ${res.status} ${res.statusText} — ${text}`);
  }
  return (await res.json()) as SessionResponse;
}
