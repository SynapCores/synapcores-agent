# @synapcores/widget

Drop-in chat widget powered by SynapCores. Embed it on any site with one
`<script>` tag; the SynapCores engine is the brain.

> **Status — Sprint 1 MVP** (v0.1.0-mvp). The Sprint 0 spike's wire is now
> wrapped in a polished UI: theming, dark/light auto, mobile full-screen,
> animated typing dots, markdown rendering, ARIA focus trap + ESC, and
> exponential-backoff reconnect. Sprint 2 adds multi-tenant project keying;
> Sprint 3 adds identity + persistent conversation; Sprint 4 ships CDN + npm.

---

## Install

```html
<script
  defer
  src="https://cdn.synapcores.com/widget.js"
  data-backend="wss://your-agent-backend.com/ws"
></script>
```

That's the whole install. The widget renders a floating launcher button (you
choose the corner), opens a chat panel on click, and connects to the backend
you point it at. **Bring-your-own backend** — see `synapcores-agent` for the
Python runtime that serves the WebSocket.

---

## Config (via `data-*` attributes)

| Attribute              | Default          | Notes                                                    |
| ---------------------- | ---------------- | -------------------------------------------------------- |
| `data-backend`         | _(required)_     | WS URL of the synapcores-agent backend                   |
| `data-project`         | _(none)_         | Project id; passed through but ignored until Sprint 2    |
| `data-agent-name`      | `Support`        | Header label                                             |
| `data-greeting`        | sensible default | First message shown when the panel opens                 |
| `data-primary-color`   | `#00bfff`        | Any CSS color string — applied as a CSS custom property  |
| `data-position`        | `bottom-right`   | `bottom-right` / `bottom-left` / `top-right` / `top-left`|
| `data-theme`           | `auto`           | `light` / `dark` / `auto` (follows prefers-color-scheme) |
| `data-show-branding`   | `true`           | Set `false` to hide the "Powered by SynapCores" footer   |

## Config (via JS API)

If you'd rather init manually:

```html
<script defer src=".../widget.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', () => {
    const w = window.SynapCores.init({
      backend: 'wss://your-backend/ws',
      agentName: 'Support',
      greeting: 'Hi! How can I help?',
      primaryColor: '#7c3aed',
      position: 'bottom-right',
      theme: 'auto',
      showBranding: true,
    });
    // returned `w` exposes: open(), close(), toggle(), send(text), destroy()
  });
</script>
```

---

## What's in Sprint 1 (MVP)

- **Theming**: primary color via `--sc-primary` CSS custom property, four
  position variants, light / dark / `prefers-color-scheme: auto` with live
  media-query updates.
- **Mobile**: collapses to a full-screen overlay below 480px width.
- **Animated typing indicator**: 3-dot pulse with `prefers-reduced-motion`
  respect.
- **Markdown rendering** in agent replies — bold, italic, inline code, fenced
  code blocks, `[text](url)` links, paragraph breaks. User input stays plain
  text. URL allowlist: `http://` and `https://` only.
- **Exponential-backoff reconnect**: 1s → 2s → 4s → 8s → 16s, cap 30s. A
  "Reconnecting…" status banner makes the state visible.
- **ARIA + keyboard**: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus
  trap inside the panel, ESC closes and returns focus to the launcher.
- **Scoped CSS**: every rule is namespaced under `.sc-widget-root` so host
  styles can't bleed in and widget styles can't bleed out.

## What's NOT in Sprint 1 (later sprints)

- ❌ Multi-tenant project keying — **Sprint 2**
- ❌ `SynapCores.identify({ name, email })` — **Sprint 3**
- ❌ Persistent conversation across page loads — **Sprint 3**
- ❌ Source-link chips for KB grounding — **Sprint 3** (depends on backend's
  `brain` payload shape)
- ❌ Per-project rate-limit UI handling — **Sprint 2**
- ❌ CDN / npm publish — **Sprint 4**

---

## Build

```bash
npm install
npm run build       # → dist/widget.js (one file, CSS inlined, 19 KB minified)
npm run dev         # esbuild watch + dev/ static server on :5050
```

`dist/widget.js` is the entire shipped artifact. No CSS file to host
separately, no peer deps on the embedding page.

## Verify

### Wire shape (automated)

```bash
.venv/bin/python widget/dev/mock_backend.py &   # speaks v1 protocol verbatim
.venv/bin/python widget/dev/smoke_client.py     # round-trip turn→thinking→brain→reply
```

### UI (manual, in a real browser)

```bash
.venv/bin/python widget/dev/mock_backend.py &
cd widget && npm run dev
```

Open <http://localhost:5050/>. Click the launcher. Try:

- Send a plain message → see the dot-pulse → see the mock reply
- Send `**bold** *italic* \`code\`` and confirm only agent replies render
  markdown (your input stays plain text)
- Kill the mock backend and watch the "Reconnecting…" banner
- Restart it and watch the connection recover
- Press `ESC` while the panel is open → it closes, focus returns to the launcher
- Tab around inside the panel → focus stays trapped inside
- Toggle your OS dark mode → palette flips live (theme=auto)
- Resize the window below 480px → panel goes full-screen
- Add `?reduced=1` (or set Reduce Motion in OS settings) → dot pulse stops

---

## Source layout

```
widget/src/
  index.ts      public API + auto-init from <script data-*>
  widget.ts     UI composition: launcher, panel, composer, ARIA wiring
  config.ts     types, defaults, data-* parsing
  visitor.ts    crypto.randomUUID() → localStorage → cookie → in-memory
  ws.ts         WebSocket client with exponential-backoff reconnect
  theme.ts      primary color + position + dark/light auto
  dom.ts        el() factory + focus-trap helper
  markdown.ts   tiny safe markdown renderer (bold/italic/code/links)
  styles.css    scoped styles, inlined into the bundle at build time
```

## License

MIT — see [LICENSE](../LICENSE).
