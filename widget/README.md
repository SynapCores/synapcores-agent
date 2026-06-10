# @synapcores/widget

Drop-in chat widget powered by SynapCores. Embed it on any site with one
`<script>` tag; the SynapCores engine **is** the agent — recall memory + RAG
+ tool routing + grounded generation run in-DB via `AGENT_RUN()`.

> **Status — Sprint 2 Phase A (v0.2.0-gateway)**. The widget now talks
> **directly to the SynapCores gateway** at `/ws` over the `AiChatWsMessage`
> protocol. No Python middleware, no second process. Phase B (auto-bootstrap
> via `POST /v1/widget/token` on the gateway) is the next ticket; until it
> ships, dev/preview use the `data-token` attribute with a manually-issued
> JWT. Production embedders should always use the bootstrap.

---

## Architecture

```
Browser                  SynapCores gateway              In-DB
─────────                ──────────────────              ─────
<script widget.js>
   │ POST /v1/widget/token   ─►  validate project_key,
   │ (project_key, visitor)      check Origin allowlist,
   │                             issue ~5 min JWT
   │ ◄─ {token}
   │
   │ WS  /ws?token=<jwt>     ─►  websocket_handler.rs
   │ {type:"send_message"        AiChatWsMessage
   │  session_id, message}        │
   │                              ▼
   │                       handle_ai_chat_message
   │                              │
   │                              ▼
   │                       chat_engine + AGENT_RUN
   │                              │
   │ ◄─ {type:"message_chunk"}    │ (streaming tokens)
   │ ◄─ {type:"message_complete"} ▼
```

One docker container. No Python sidecar. No protocol drift between two
copies of an "agent loop." Multi-tenancy uses the existing gateway
tenant/JWT/CORS plumbing.

---

## Install (production, post Phase B)

```html
<script
  defer
  src="https://cdn.synapcores.com/widget.js"
  data-api-base="https://your-synapcores.example.com"
  data-database="default"
  data-project-key="pk_abc123"
></script>
```

The widget POSTs the project key + a generated visitor id at first open,
gets back a ~5-minute scoped JWT, opens WS. The Origin header is validated
server-side against the project's `allowed_origins` allowlist (the gateway
config defines that), so the embed code is safe to publish on a public page
even though it identifies the project.

## Install (dev — Phase B not yet shipped)

```html
<script
  defer
  src="/dist/widget.js"
  data-api-base="http://localhost:8080"
  data-database="default"
  data-token="<paste a JWT here>"
></script>
```

See `dev/RUN_AGAINST_SYNAPCORES.md` for the full curl flow to obtain a
JWT (docker run → `/v1/auth/login` → paste).

---

## Config

| Attribute              | Default          | Notes                                                    |
| ---------------------- | ---------------- | -------------------------------------------------------- |
| `data-api-base`        | _(required)_     | SynapCores gateway base URL (e.g. `https://api.your.com`)|
| `data-database`        | _(required)_     | Which database in the SynapCores tenant to chat against  |
| `data-project-key`     | _(required\*)_   | Project public key for bootstrap (* OR `data-token`)     |
| `data-token`           | _(none)_         | Manual JWT — dev/preview only, never in production       |
| `data-agent-name`      | `Support`        | Header label                                             |
| `data-greeting`        | sensible default | First message shown when the panel opens                 |
| `data-primary-color`   | `#00bfff`        | Any CSS color string                                     |
| `data-position`        | `bottom-right`   | `bottom-right` / `bottom-left` / `top-right` / `top-left`|
| `data-theme`           | `auto`           | `light` / `dark` / `auto`                                |
| `data-show-branding`   | `true`           | Set `false` to hide the "Powered by SynapCores" footer   |
| `data-model`           | server default   | Optional override for `send_message.model`               |

Or via JS API:

```html
<script defer src=".../widget.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', () => {
    const w = window.SynapCores.init({
      apiBase: 'https://api.your.com',
      database: 'default',
      projectKey: 'pk_abc123',
      agentName: 'Support',
      primaryColor: '#7c3aed',
    });
    // w.open(), w.close(), w.toggle(), w.send(text), w.destroy()
  });
</script>
```

---

## What's in Sprint 2 Phase A

- **Direct-to-gateway wire** — `send_message` / `message_chunk` /
  `message_complete` / `tool_result` / `error` / `pong`. Matches
  `crates/aidb-gateway/src/websocket/ai_chat_handler.rs::AiChatWsMessage`
  exactly.
- **Streaming render** — chunks accumulate into an in-progress agent
  bubble; on `message_complete` it re-renders with full markdown.
- **Bootstrap step** — `POST /v1/widget/token` with `{project_key,
  visitor_id}`. Used when `data-token` is not set.
- **Manual-token bypass** — `data-token` for development before
  Phase B ships.
- **Session id** — one UUID per widget mount; keys per-conversation memory.
- All Sprint 1 polish kept: theming, dark mode, mobile overlay, animated
  dots, exponential-backoff reconnect, ARIA dialog + focus trap + ESC,
  scoped CSS, safe markdown.

## What's still pending

- **Phase B — gateway endpoint** (next ticket): `POST /v1/widget/token`
  Rust handler, `[[widget.projects]]` config section, CORS allowlist on
  `/ws` per project, short-lived JWT issuance.
- `identify({name, email})` — Sprint 3.
- Persistent conversation across page loads — Sprint 3.
- CDN + npm publish — Sprint 4.

---

## Build

```bash
npm install
npm run build       # → dist/widget.js (21.6 KB minified, CSS inlined)
npm run dev         # esbuild watch + http.server widget/ on :5050
                    # then open http://localhost:5050/dev/
```

## Verify

See `dev/RUN_AGAINST_SYNAPCORES.md` — five steps: docker run, get JWT,
paste into `dev/index.html`, `npm run dev`, open the page.

---

## Source layout

```
widget/src/
  index.ts        public API + auto-init from <script data-*>
  widget.ts       UI + bootstrap + AiChatWsMessage protocol
  config.ts       types, defaults, data-* parsing, deriveWsUrl()
  bootstrap.ts    POST /v1/widget/token (the auto path)
  visitor.ts     crypto.randomUUID() → localStorage → cookie → in-memory
  ws.ts           WebSocket with 1/2/4/8/16s backoff reconnect
  theme.ts        primary color + position + dark/light auto
  dom.ts          el() factory + focus-trap helper
  markdown.ts     safe MD renderer (bold/italic/code/links, http(s) only)
  styles.css      scoped under .sc-widget-root, inlined into the bundle
```

## License

MIT — see [LICENSE](../LICENSE).
