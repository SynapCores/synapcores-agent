# @synapcores/widget

Drop-in chat widget powered by SynapCores. Embed it on any site with one
`<script>` tag; the SynapCores engine is the brain (recall memory + RAG +
tool routing + grounded generation via `AGENT_RUN()` in-DB).

> **Status — Sprint 2 Phase B (v0.2.1-proxy)**. The widget no longer
> talks to the SynapCores gateway directly. It talks to a tiny Node.js
> **proxy** (sibling crate at `../proxy/`) that holds the SynapCores
> credential server-side. The browser holds only an HttpOnly signed
> session cookie. See [`../proxy/README.md`](../proxy/README.md) for the
> proxy setup; see this README for the widget surface.

---

## Architecture

```
Browser                  widget-proxy (Node.js)      SynapCores gateway
─────────                ──────────────────────       ──────────────────
<script /widget.js>
  │ POST /v1/session     ─► validates origin,
  │  {project_key}          sets HttpOnly cookie
  │ ◄─ {persona, agent_name, …}
  │
  │ WS /ws (cookie auth) ─► verifies cookie,
  │                         opens upstream WS,
  │                         pipes AiChatWsMessage   ─► AGENT_RUN in-DB
  │ ◄─ message_chunk          ◄─                       ◄─
  │ ◄─ message_complete       ◄─                       ◄─
```

Browser holds: an HttpOnly signed cookie. Nothing else.
Proxy holds: the SynapCores JWT/API key, project allowlist, rate limits.
SynapCores: runs `AGENT_RUN()` natively.

One credential, one proxy, one engine. No Python, no DB token in JS.

---

## Install (production)

The embedder hosts the proxy. The site author pastes one of:

```html
<!-- A. jsDelivr CDN, version-pinned + SRI (recommended) -->
<script defer
  src="https://cdn.jsdelivr.net/npm/@synapcores/widget@0.4.0/dist/widget.js"
  integrity="sha384-rn44GdC0gnzNPwhJYHl4TEzahTnCGWtcE/N7QJZ1T5L+Sta8Bh/2d4lga2FaM4NB"
  crossorigin="anonymous"
  data-api-base="https://chat.your.com"
  data-project-key="pk_abc123"></script>

<!-- B. Proxy-hosted (no external CDN dep) -->
<script defer
  src="https://chat.your.com/widget.js"
  data-api-base="https://chat.your.com"
  data-project-key="pk_abc123"></script>
```

Where `https://chat.your.com` is the widget-proxy URL. The proxy's
`projects.json` defines `pk_abc123` with its tenant, database, persona,
upstream SynapCores credential, allowed origins, and rate limit. The
widget bundle on jsDelivr/unpkg is identical to what the proxy serves
at `/widget.js` — the only difference is the source the browser fetches
it from.

For cross-origin embeds (proxy on a different origin from the host site),
set `session.same_site_none = true` in the proxy config — required for
the cookie to travel cross-origin. HTTPS is then mandatory.

## Install (development)

```bash
# Run the proxy (this also serves the widget bundle and a dev landing page)
cd ../proxy
npm install
export PROXY_SESSION_SECRET="$(openssl rand -hex 32)"
export DEMO_SYNAPCORES_TOKEN="<a JWT from your SynapCores /v1/auth/login>"
cp projects.example.json projects.json
npm start                                   # http://127.0.0.1:5060

# Iterate on widget code (rebuilds dist/widget.js on every save)
cd ../widget
npm run dev
```

Open <http://127.0.0.1:5060/>. The proxy renders a dev landing page
script-tagging the widget against the first configured project.

---

## Config

| Attribute              | Default              | Notes                                                    |
| ---------------------- | -------------------- | -------------------------------------------------------- |
| `data-api-base`        | _(required)_         | widget-proxy URL                                         |
| `data-project-key`     | _(required)_         | proxy looks up tenant/database/persona/allowed_origins   |
| `data-agent-name`      | proxy default        | Header label (proxy supplies per-project default)        |
| `data-greeting`        | sensible             | First message shown when the panel opens                 |
| `data-primary-color`   | `#00bfff`            | Any CSS color                                            |
| `data-position`        | `bottom-right`       | `bottom-right` / `bottom-left` / `top-right` / `top-left`|
| `data-theme`           | `auto`               | `light` / `dark` / `auto`                                |
| `data-show-branding`   | `true`               | Set `false` to hide "Powered by SynapCores"              |
| `data-model`           | server default       | Optional override sent in `send_message.model`           |

Or via JS API:

```html
<script defer src=".../widget.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', () => {
    const w = window.SynapCores.init({
      apiBase: 'https://chat.your.com',
      projectKey: 'pk_abc123',
      primaryColor: '#7c3aed',
    });
    // w.open(), w.close(), w.toggle(), w.send(text), w.destroy()

    // When you know who the visitor is — e.g. after a login event —
    // call identify(). The proxy stores it and AGENT_RUN sees the
    // visitor as identified on every subsequent turn:
    w.identify({
      id: 'u_42',
      name: 'Luis',
      email: 'luis@example.com',
      attrs: { plan: 'pro' },
    });
    // Or call from the global — applies to every mounted widget:
    window.SynapCores.identify({ id: 'u_42', name: 'Luis' });
  });
</script>
```

---

## What this widget does on the wire

| Browser → proxy → upstream                                | Direction |
| --------------------------------------------------------- | --------- |
| `POST /v1/session {project_key, visitor_id?}`             | HTTPS     |
| `WS /ws` upgrade (cookie auth)                            | Browser → proxy |
| `{type:"send_message", session_id, message, model?}`      | Browser → proxy |
| `{type:"message_chunk", message_id, session_id, chunk}`   | Proxy → browser |
| `{type:"message_complete", message_id, full_message}`     | Proxy → browser |
| `{type:"error", message, code}`                           | Proxy → browser |

The proxy injects `context.database` and `context.visitor_id` upstream —
the widget cannot point at another tenant's database, and tries to
`execute_sql` from the browser are silently dropped at the proxy.

---

## What's in Sprint 3 (v0.3.0-identity)

- **`identify(attrs)`** on the Widget instance + `window.SynapCores.identify(attrs)`
  global. Stored on the proxy and threaded into `send_message.context.user`
  server-side — AGENT_RUN sees an identified visitor on every turn.
  Safe to call before the panel opens; replayed once the session cookie
  is set. The proxy holds it in-memory keyed by visitor id (TTL 24h);
  persisting to SynapCores is a future hardening pass.
- **Persistent conversation across page loads + days.** Server-supplied
  deterministic `session_id` (HMAC of secret + visitor + project) replaces
  the per-mount UUID. On open, the widget fetches `GET /v1/history` and
  re-renders prior turns before showing the composer — visitors returning
  later see the conversation they had.
- **`widget.identity`** read-only getter — what the embedder last
  identified (useful for debug overlays).
- All Sprint 1/2 polish unchanged.

## What's pending

- **Sprint 4** (#321): CDN publish (Cloudflare Pages — free), npm
  `@synapcores/widget` publish, Dockerfile for the proxy, docker-compose
  with synapcores + proxy + first project, minimal admin HTML page,
  example embeds (bare HTML / Next.js / WordPress).

---

## Source layout

```
widget/src/
  index.ts        public API + auto-init from <script data-*>
  widget.ts      UI + session bootstrap + AiChatWsMessage protocol
  config.ts      types, defaults, data-* parsing, deriveWsUrl()
  session.ts     POST /v1/session (cookie-set, no token in response body)
  visitor.ts     crypto.randomUUID() → localStorage → cookie → in-memory
  ws.ts          WebSocket with exponential-backoff reconnect
  theme.ts       primary color + position + dark/light auto
  dom.ts         el() factory + focus-trap helper
  markdown.ts    safe markdown renderer
  styles.css     scoped, inlined into the bundle at build time
```

## Build

```bash
npm install
npm run build       # → dist/widget.js (21.3 KB minified, CSS inlined)
npm run dev         # esbuild watch only (proxy serves the bundle)
```

## License

MIT — see [LICENSE](../LICENSE).
