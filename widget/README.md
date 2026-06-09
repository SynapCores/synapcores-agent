# @synapcores/widget

Drop-in chat widget powered by SynapCores. Embed it on any site with one
`<script>` tag; the SynapCores engine is the brain.

> **Status — Sprint 0 spike** (v0.1.0-sprint0). This is the scaffold that proves
> the wire works end-to-end against the existing v1 backend. Sprint 1 hardens
> the UI; Sprints 2-4 add multi-tenant, config surface, and CDN distribution.

---

## Install

```html
<script
  defer
  src="https://cdn.synapcores.com/widget.js"
  data-backend="wss://your-agent-backend.com/ws"
></script>
```

That's the whole install. The widget renders a floating launcher button in the
bottom-right, opens a chat panel on click, and connects to the backend you
point it at. Bring-your-own backend: see `synapcores-agent` for the Python
runtime that serves the WebSocket.

## Config (via `data-*` attributes)

| Attribute         | Default      | Notes                                          |
| ----------------- | ------------ | ---------------------------------------------- |
| `data-backend`    | _(required)_ | WS URL of the synapcores-agent backend         |
| `data-project`    | _(none)_     | Project id; ignored in Sprint 0, used Sprint 2 |
| `data-agent-name` | `Support`    | Header label                                   |
| `data-greeting`   | sensible     | First message shown when the panel opens       |

## Config (via JS API)

If you'd rather init manually:

```html
<script defer src=".../widget.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', () => {
    window.SynapCores.init({
      backend: 'wss://your-backend/ws',
      agentName: 'Support',
      greeting: 'Hi! How can I help?',
    });
  });
</script>
```

The auto-init via `data-*` attributes is the recommended path. Use the JS API
when you need to choose between hosts at runtime, or to call `widget.open()` /
`widget.close()` from the host page.

---

## Sprint 0 — decisions locked

1. **Bundler: esbuild.** Fastest dev iteration, zero-config IIFE output for the
   `<script>` tag, single-file output (CSS inlined via the `define` macro), no
   plugin ecosystem to learn.
2. **Visitor ID: Web Crypto `crypto.randomUUID()` in `localStorage`, cookie
   fallback.** Better Safari ITP behaviour than 3rd-party cookies; GDPR-friendly
   (no automatic consent flow needed for non-tracking storage). Falls back to a
   `synapcores_visitor` cookie when localStorage is blocked, and to an
   in-memory id when both are.
3. **Wire protocol: identical to v1 (`{type:"turn",user_id,text}` →
   `{type:"thinking"|"brain"|"reply"}`).** Means Sprint 0 connects to the
   existing backend without any backend changes — proves the path. Multi-tenant
   project keying is layered on top in Sprint 2 via a new WS route.

## Sprint 0 — what's NOT in this spike

The polish work is all Sprint 1+:

- Markdown / code-block rendering in agent bubbles
- Source-link chips for KB grounding
- ARIA focus trap / ESC-to-close / keyboard nav
- Mobile full-screen overlay
- Reconnect-with-backoff after `ws.close`
- Per-project rate-limit handling
- Identity (`SynapCores.identify({…})`) — Sprint 3
- Persistent conversation across page loads — Sprint 3

---

## Build

```bash
npm install
npm run build       # → dist/widget.js (one file, CSS inlined)
npm run dev         # esbuild watch + dev/ static server on :5050
```

`dist/widget.js` is the entire shipped artifact. No CSS file to host
separately, no peer deps on the embedding page.

## Verify Sprint 0 end-to-end

```bash
# Terminal 1 — v1 backend (default port 8810)
cd /path/to/synapcores-agent
python -m synapcores_agent.web

# Terminal 2 — widget dev server
cd widget
npm install
npm run dev
```

Open <http://localhost:5050/>, click the floating chat button. Send a message
and watch the WS frames in DevTools. A round-trip closes the spike.

## License

MIT — see [LICENSE](../LICENSE).
