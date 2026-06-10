/* Token bootstrap — turn a public project key into a short-lived visitor JWT.
 *
 * Flow:
 *   1. POST {apiBase}/v1/widget/token  {project_key, visitor_id}
 *   2. Server validates project_key against [[widget.projects]] config,
 *      checks Origin header against allowed_origins, issues a JWT scoped
 *      to that project's tenant/persona (~5 min TTL).
 *   3. Widget opens WS at {apiBase}/ws?token=<jwt>.
 *
 * If the gateway endpoint isn't deployed yet (Sprint 2 Phase B), the
 * embedder can pass `data-token` directly with a manually-issued JWT for
 * dev/preview use. Production embed codes should ALWAYS use the bootstrap.
 */

export interface BootstrapResponse {
  /** Short-lived JWT scoped to this project's tenant + persona. */
  token: string;
  /** TTL in seconds — for the renew timer. */
  expires_in?: number;
  /** Optional persona name override from server config. */
  persona?: string;
}

export async function bootstrapToken(
  apiBase: string,
  projectKey: string,
  visitorId: string,
): Promise<BootstrapResponse> {
  const url = `${apiBase}/v1/widget/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project_key: projectKey, visitor_id: visitorId }),
    // The widget runs on the embedder's origin; we explicitly do NOT send
    // cookies. Visitor identity is the body's `visitor_id`, not a cookie.
    credentials: 'omit',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`bootstrap failed: ${res.status} ${res.statusText} — ${text}`);
  }
  const body = (await res.json()) as BootstrapResponse;
  if (!body.token) throw new Error('bootstrap response missing `token`');
  return body;
}
