# synapcores-agent v2 — Drop-in Chat Applet for Any Site

**Authored**: 2026-06-03
**Status**: Proposal — awaiting commit
**Target launch**: 6 weeks of focused engineering
**Effort**: ~3,500-4,500 LoC net new (TypeScript widget + multi-tenant backend) + ~3 weeks of polish/marketing
**Best-performer signal**: synapcores-agent is the only OSS repo of ours getting organic stars (6 vs 1 for every other). V2 leans into that. The format is the change: from "full-page demo" to "drop-in chat applet a developer embeds in their own product in 3 lines."

---

## 1. TL;DR — what changes from v1 → v2

| Dimension | v1 (today) | v2 (target) |
|---|---|---|
| **What it is** | A polished full-page demo (left: chat, right: "Brain" debugger) — for showing off SynapCores | A drop-in customer-support / docs-Q&A chat **applet** developers embed in their own product |
| **Install** | `git clone` + `pip install -e .` + `.env` + `python -m synapcores_agent` (5 steps) | `<script src="…/widget.js" data-project="pk_…"></script>` (1 line) |
| **Frontend** | Vanilla JS, aiohttp-served, full-screen two-pane | Vanilla TS bundle (~40 KB gzipped), floating button → popup panel, embed in any site |
| **Backend** | Python aiohttp + WebSocket, single tenant, one agent persona | Python aiohttp **multi-tenant** (project-keyed), multiple personas, multiple KBs in one runtime |
| **Audience** | "Look how cool SynapCores is" (us → them) | "Use SynapCores as the brain of MY chat widget" (them → their users) |
| **Conversion goal** | GitHub star | A live `<script>` tag on a real site → traffic + lock-in |
| **Comparable products** | (no widget at all) | Intercom, Drift, Crisp, Tawk.to — but open-source, self-hosted, BYO LLM |
| **License** | MIT (stays) | MIT (stays) |

v2 doesn't replace v1 — the two-pane demo lives on at `/demo` for marketing. v2 ADDS the embeddable applet.

---

## 2. Why this version, why now

### Strategic signal

`synapcores-agent` has **6 stars** in ~7 days. Every other OSS repo of ours is at 1 star. That's the only project where the framing landed. The v2 thesis: the framing isn't "framework-free agent" — it's "**a real chat thing a developer can use today**." Make it more concretely a real thing they can use, and the star math should compound.

### Market pattern

The biggest OSS chat-bot repos all got their traction from being **drop-in embeddable**:
- **Chatwoot** (22k stars) — embed widget for customer support
- **Botpress** (13k stars) — embed widget + builder
- **Typebot** (8k stars) — embed widget + builder
- **AnythingLLM** (50k stars) — embed widget on a docs site

None of those are SynapCores-grade on the brain side. We have AGENT_RUN, vector memory, Cypher graph traversal, multi-modal — and zero presence in the embeddable-widget category.

### Distribution leverage

A drop-in widget creates compounding distribution:
- Every site that embeds the widget shows "Powered by SynapCores" (configurable)
- Customers who like it tell their dev friends about it
- A live deployment URL is a much stronger HN/Reddit demo than a localhost screenshot
- It's the kind of thing X demos go viral with — "look, I added agent memory to my docs site with one script tag"

---

## 3. What v1 already has (the reusable foundation)

A thoughtful audit of `src/synapcores_agent/` shows:

| Module | LoC | What it does | v2 reuse |
|---|---:|---|---|
| `brain.py` | 192 | The agent loop — recall memory, RAG, route, generate, write back | **100% reused** — this IS the engine |
| `client.py` | 169 | Thin stdlib-only SynapCores HTTP client | **100% reused** — stdlib-only, perfect for multi-tenant runtime |
| `web.py` | 221 | aiohttp + WebSocket server for the demo widget | **~60% reused** — needs multi-tenant routing + project-key auth |
| `tools/support_tools.py` | 88 | KB search tool | 100% reused; new tools added (refund, escalate, schedule) |
| `tools/base.py` | 29 | Tool base class | 100% reused |
| `router.py` | 60 | Semantic tool routing | 100% reused |
| `seed.py` | 85 | Demo KB seeder | Rewritten as `kb_loader.py` — generic KB import |
| `mcp.py` | 91 | MCP server surface | 100% reused (free win — exposed via project key) |
| `web/index.html` | — | Full-page demo HTML | Kept at `/demo`; new widget builds separately |
| `web/app.js` | 372 | Demo widget client | **REPLACED** — net new TS widget |
| `web/style.css` | — | Demo styling | Kept; net new widget styling shipped with the bundle |

**Net: ~80% of v1 backend code carries forward.** The work is multi-tenancy + frontend rewrite + install UX.

---

## 4. v2 architecture — the three components

```
                ┌────────────────────────────────────────┐
                │ Developer's website / docs / SaaS app  │
                │                                        │
                │  <script src="…/widget.js"             │
                │   data-project="pk_abc123"></script>   │
                │                                        │
                │              [💬 Help] ← floating btn  │
                └────────────────┬───────────────────────┘
                                 │ wss://
                                 ▼
                ┌────────────────────────────────────────┐
                │  synapcores-agent backend (multi-      │
                │  tenant), keyed on project_id          │
                │                                        │
                │  - validates project key               │
                │  - dispatches Brain loop per turn      │
                │  - per-project namespace in SynapCores │
                └────────────────┬───────────────────────┘
                                 │ HTTP (JWT)
                                 ▼
                ┌────────────────────────────────────────┐
                │  SynapCores engine (one container)     │
                │                                        │
                │  agent_p_abc123_memory                 │
                │  agent_p_abc123_kb                     │
                │  agent_p_xyz789_memory   ← multi-tenant│
                │  agent_p_xyz789_kb                     │
                └────────────────────────────────────────┘
```

### Component 1 — The Widget (TypeScript, ~1,500 LoC)

A single zero-dependency vanilla TS bundle. **No React, no Vue, no framework.** Why:
- Zero peer-dep conflicts when embedded in someone else's React/Next/Astro/WordPress site
- ~40 KB gzipped is plausible
- No `npm install` step required — pure CDN delivery
- Easier for non-developers (WordPress, static sites, Webflow)

**The bundle exposes one global**:
```typescript
window.SynapCores = {
  init(config: WidgetConfig): void,
  open(): void,
  close(): void,
  send(text: string): void,
  on(event: 'open' | 'close' | 'message', cb: (data: any) => void): void,
  identify(user: { id?: string, name?: string, email?: string }): void,
  destroy(): void,
};
```

**The UI** mirrors the polished category of commercial widgets (Intercom-like, not 2010-vintage live chat):
- Floating launcher button (bottom-right by default, configurable to any corner)
- Click → 380×600 panel slides up (configurable dimensions, responsive on mobile)
- Header: avatar + agent name + minimize/close
- Messages: bubble layout, typing indicator, code-block + markdown rendering, source-link chips
- Composer: textarea (auto-grows), send button, character counter for long messages
- Branding footer (configurable: "Powered by SynapCores" with link, removable in self-hosted)
- Dark mode + light mode (auto by default; configurable)
- All ARIA labels + keyboard navigation (focus trap when open, ESC to close)
- Mobile: panel becomes full-screen overlay, swipe-down to close

**Configuration surface** (via `data-*` attributes OR `SynapCores.init()` JS object):

```typescript
interface WidgetConfig {
  // required
  project: string;           // pk_abc123 — issued by backend on project creation
  backend: string;           // wss://your-domain.com — where the agent backend lives

  // appearance
  primaryColor?: string;     // hex, default '#00BFFF'
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  theme?: 'light' | 'dark' | 'auto';
  avatarUrl?: string;
  agentName?: string;        // default 'Support'
  greeting?: string;         // first message shown
  launcherIcon?: 'chat' | 'help' | 'sparkle' | string;  // string = custom SVG/URL

  // behavior
  persistConversation?: boolean;   // default true — visitor sees history on revisit
  visitorIdCookie?: string;        // default 'synapcores_visitor'
  openOnLoad?: boolean;            // default false
  hideOnPages?: string[];          // CSS-selector or path regex to NOT show on
  zIndex?: number;                 // default 999999

  // branding (open-source default is to show; paid tier can remove)
  showBranding?: boolean;          // default true
  brandingHref?: string;           // default 'https://synapcores.com'

  // analytics
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (data: { from: 'user' | 'agent', text: string }) => void;
}
```

**Distribution**: published as the npm package `@synapcores/widget` AND served from `cdn.synapcores.com/widget.js` (later: jsDelivr, unpkg).

### Component 2 — The Multi-Tenant Backend (Python + aiohttp, ~800 net new LoC)

The existing `web.py` becomes per-project. Net new code:

```python
# src/synapcores_agent/projects.py — net new (~250 LoC)
@dataclass
class Project:
    id: str                      # "pk_abc123"
    name: str                    # "Acme Docs Bot"
    namespace: str               # "agent_p_abc123" — table prefix in SynapCores
    persona: str                 # the system prompt
    kb_source: KbSource          # URL crawl spec, file paths, or markdown blob
    allowed_origins: list[str]   # CORS allowlist for the widget
    rate_limit_per_visitor: int  # default 60/min
    created_at: datetime

# src/synapcores_agent/project_store.py — net new (~200 LoC)
# Stores Project metadata IN SynapCores itself (eat our own dog food):
class ProjectStore:
    async def create(self, name: str, ...) -> Project: ...
    async def get(self, project_id: str) -> Project: ...
    async def update(self, project_id: str, ...) -> Project: ...
    async def delete(self, project_id: str) -> None: ...

# src/synapcores_agent/visitor.py — net new (~150 LoC)
# Anonymous visitor session — cookies issued by the widget; mapped to a stable
# user_id used by Brain for memory recall.
class Visitor:
    id: str                      # opaque, cookie-set
    project_id: str
    name: str | None             # set if widget called .identify()
    email: str | None
    first_seen: datetime
    last_seen: datetime

# src/synapcores_agent/web.py — modified (~200 LoC delta)
# Adds:
# - GET /v1/widget/config?project=pk_abc123 — returns widget bootstrap config
# - WS /v1/widget/chat?project=pk_abc123&visitor=v_xyz — multi-tenant WS
# - GET /admin/projects (with admin auth) — list/create/manage projects
```

**Brain is unchanged** — each project gets its own namespaced tables; the Brain's `namespace` constructor argument was already designed for this.

### Component 3 — The Admin Dashboard (kept minimal in v2, ~300 LoC)

The MVP doesn't need a full admin UI; a simple CLI + a one-page HTML view will do:

```bash
# Create a project, get the embed code
synapcores-agent project create --name "Acme Docs" \
  --persona "You are a helpful docs bot for Acme..." \
  --kb-from-url https://docs.acme.com \
  --allowed-origin https://acme.com

# → Project pk_abc123 created.
# → Embed code:
#
#   <script defer
#     src="https://cdn.synapcores.com/widget.js"
#     data-project="pk_abc123"
#     data-backend="wss://your-backend.com"></script>

# List projects + visitor counts
synapcores-agent project ls

# Live tail of conversations (great demo material)
synapcores-agent project tail pk_abc123
```

A minimal HTML admin page at `/admin` (admin-JWT-gated) for non-CLI users:
- List of projects
- "Create new project" form
- Per-project: visitor count, conversation count, copy-embed-code button
- Per-conversation: read-only transcript view

---

## 5. The developer experience — the entire install

This is what we're optimizing for. The whole flow:

```bash
# 1. Run the backend (single docker compose with SynapCores + agent backend)
git clone https://github.com/SynapCores/synapcores-agent
cd synapcores-agent
docker compose up -d
# (or: docker compose -f deploy/cloud.yml up -d for a managed-cloud-shaped deploy)

# 2. Create a project, get the embed code (one CLI command)
docker compose exec agent synapcores-agent project create \
  --name "My Docs" \
  --kb-from-url https://docs.mysite.com \
  --allowed-origin https://mysite.com
```

The CLI returns:

```html
<!-- Paste this in your site's <head> or before </body> -->
<script defer
  src="https://cdn.synapcores.com/widget.js"
  data-project="pk_abc123"
  data-backend="wss://my-agent.mysite.com"></script>
```

**Time-to-running widget: ~5 minutes on a warm Docker pull.** No npm install required on the developer's site. No framework lock-in. No vendor signup.

### Hosted tier — explicitly out of scope for v2 launch

**v2 ships self-hosted only.** Developers run their own backend; their LLM keys, their token costs, their infra. We host nothing in the launch artifact. A hosted SaaS surface is a post-launch revenue consideration — see Section 12.

The only widget instance SynapCores operates at launch is the dogfood deployment on `docs.synapcores.com` (decision #5) — a single project, fronted by Cloudflare Turnstile + a hard monthly token-budget ceiling on the project, so a crawler campaign cannot run up our bill.

---

## 6. What's reused vs net-new

| Code path | v1 LoC | v2 delta | Notes |
|---|---:|---:|---|
| `brain.py` | 192 | +20 | Add per-project namespace propagation |
| `client.py` | 169 | 0 | No change |
| `web.py` | 221 | +200 | Multi-tenant routing, project key validation, CORS allowlist |
| `projects.py` | 0 | **+250** | NEW — project CRUD |
| `project_store.py` | 0 | **+200** | NEW — stores projects IN SynapCores |
| `visitor.py` | 0 | **+150** | NEW — anonymous visitor session |
| `kb_loader.py` | 0 | **+200** | NEW — generic KB importer (URL crawl, markdown files, sitemap, RSS) |
| `tools/*.py` | ~150 | +100 | Generic tools (refund, escalate, schedule) — replace support-only set |
| `cli.py` | ~50 | +150 | `project create`, `project ls`, `project tail` subcommands |
| `widget/src/**` | 0 | **+1,500** | NEW — TypeScript widget bundle |
| `widget/index.html` | 0 | +50 | Dev/demo HTML page for local widget testing |
| `widget/build.ts` | 0 | +80 | esbuild config |
| `docker-compose.yml` | small | +30 | Full stack: SynapCores + agent + nginx for CDN delivery |
| `docs/*.md` | — | +600 | New install / config / hooks / theming guides |
| `examples/embed/*` | 0 | +200 | Sample embed in Next.js / WordPress / static HTML |

**Net total**: ~3,500-4,500 LoC new (mostly TS for the widget; rest is Python backend).

---

## 7. Sprint plan (~6 weeks)

Each sprint ends with a demo-able milestone.

### Sprint 0 — Spike (2 days)
- Prove the existing v1 backend can serve a stripped-down vanilla-JS widget over WebSocket
- Decide: esbuild vs Vite vs Rollup for the widget bundle (recommend esbuild — fast, simple)
- Decide: cookie-based visitor ID vs Web Crypto random UUID
- Output: working "hello world" widget on a static HTML page calling the v1 backend

### Sprint 1 — The Widget MVP (1 week)
- Vanilla TS widget scaffold
- Floating launcher button + slide-up panel
- WebSocket connection + message bubble rendering
- Send composer + typing indicator
- Basic theming (primary color, position)
- Dark + light mode (auto)
- Mobile responsive
- **Demo at end of sprint**: paste script tag into a fresh static HTML page → chat works

### Sprint 2 — Multi-tenant Backend (1.5 weeks)
- `projects.py` + `project_store.py` (CRUD against SynapCores tables)
- Modify `web.py`: project-keyed WS routes, validate project keys, scope Brain per-project
- `visitor.py` (cookie-issued visitor IDs map to Brain user_ids)
- CORS allowlist enforcement
- Per-project rate limiting (extending v1 middleware concept)
- **Demo at end of sprint**: create two projects, run two separate widgets on two different localhost pages, confirm memory is isolated

### Sprint 3 — Configuration + Identity + Persistence (1 week)
- Full configuration surface (theme, position, avatar, greeting, branding)
- `SynapCores.identify({ name, email })` API → maps to user attributes the Brain remembers
- Persistent conversation history (visitor returns next day → sees their prior chat)
- KB importer (`kb_loader.py`): URL crawl, sitemap.xml, markdown directory
- **Demo at end of sprint**: identify a visitor, chat, refresh, see the history; come back tomorrow, agent still remembers

### Sprint 4 — Install UX + Distribution (1 week)
- `cli.py` — `project create`, `ls`, `tail` subcommands
- Minimal admin HTML page at `/admin`
- `docker-compose.yml` — full single-host stack (SynapCores + agent + optional nginx)
- npm package publish: `@synapcores/widget`
- CDN: `cdn.synapcores.com/widget.js` — could serve from GitHub Pages or proper Cloudflare CDN
- Example embeds: bare HTML, Next.js, WordPress (one folder each, one screenshot each)
- **Demo at end of sprint**: time the full install start-to-widget-on-page. Target: <5 min from `git clone`

### Sprint 5 — Polish + Accessibility + Mobile (1 week)
- Full ARIA labels + keyboard navigation
- Focus trap when open, ESC closes, tab cycle stays in panel
- Mobile: full-screen overlay, swipe-down close, virtual-keyboard-aware layout
- Reduced-motion preference respected
- High-contrast theme variants
- Code block + markdown rendering (use a tiny markdown lib, NOT a framework)
- Source-link chips for KB grounding
- Better typing indicator (3-dot animation)
- Loading states for slow first message (cold-start LLM)
- Empty state when no messages
- Error states (backend down, rate-limited, etc.)
- **Demo at end of sprint**: pass axe-core accessibility scan, demo on iOS Safari + Android Chrome

### Sprint 6 — Launch (1 week)
- Landing page on synapcores.com: `/widget` — what it is, how it works, embed code playground (live preview), pricing tier (self-hosted: free)
- Demo video (60-90s screencast: install → embed → chat)
- "Try the widget on synapcores.com docs" — eat our own dog food; install our own widget on docs.synapcores.com against the synapcores-docs KB
- Awesome-list submissions (awesome-ai-agents, awesome-langchain alternatives, awesome-self-hosted)
- HN post draft (per the recognition-first plan's rules: founder-led voice, technical hook)
- Reddit r/LocalLLaMA, r/selfhosted, r/programming
- X thread + reply playbook
- **Launch criteria**: video is recorded, landing page is live, the widget is installed on docs.synapcores.com as proof, HN post is drafted

---

## 8. Concrete file layout (the v2 repo shape)

```
synapcores-agent/
├── docs/
│   ├── V2_DESIGN.md            # this doc
│   ├── INSTALL.md              # 5-min install (vs v1's developer install)
│   ├── CONFIGURE.md            # widget configuration reference
│   ├── HOOKS.md                # JS events + callbacks
│   ├── THEMING.md              # primary color, position, dark mode
│   └── DEPLOY.md               # docker compose, nginx in front, TLS notes
├── src/
│   └── synapcores_agent/       # Python backend (most of v1 carries forward)
│       ├── brain.py            # unchanged + namespace propagation
│       ├── client.py           # unchanged
│       ├── web.py              # multi-tenant routes
│       ├── projects.py         # NEW
│       ├── project_store.py    # NEW
│       ├── visitor.py          # NEW
│       ├── kb_loader.py        # NEW (replaces seed.py for generic KB import)
│       ├── cli.py              # extended with project subcommands
│       ├── tools/              # extended tool set
│       └── …
├── widget/                     # NEW — the TS widget bundle
│   ├── src/
│   │   ├── index.ts            # public API (SynapCores global)
│   │   ├── launcher.ts         # floating button
│   │   ├── panel.ts            # the chat panel
│   │   ├── ws.ts               # WebSocket client + reconnect
│   │   ├── store.ts            # message + state
│   │   ├── theme.ts            # color, dark mode
│   │   ├── markdown.ts         # tiny MD renderer (no deps)
│   │   ├── a11y.ts             # focus trap, ARIA helpers
│   │   └── styles.css          # injected via <style> on init
│   ├── dist/                   # built widget.js + widget.css
│   ├── build.ts                # esbuild config
│   ├── package.json            # @synapcores/widget
│   └── README.md
├── examples/
│   ├── embed-html/             # bare HTML page with the script tag
│   ├── embed-nextjs/           # Next.js component wrapper
│   ├── embed-wordpress/        # WP plugin shell
│   └── (existing v1 examples preserved)
├── deploy/
│   ├── docker-compose.yml      # SynapCores + agent + optional nginx
│   ├── docker-compose.dev.yml  # local-only quick start
│   └── nginx.conf              # reverse proxy + WS upgrade
├── tests/
│   └── …                       # existing pytest + new TS unit tests for widget
└── README.md                   # rewritten: leads with embed code, not the full-page demo
```

---

## 9. Open questions for the founder

Concrete decisions needed before Sprint 0:

| # | Question | Recommendation |
|---|---|---|
| 1 | Distribute the widget via `cdn.synapcores.com/widget.js` (Cloudflare) OR via npm only OR both? | **Both.** CDN for the 1-line install crowd; npm for React/Next devs who want bundle control. |
| 2 | npm package name: `@synapcores/widget` vs `synapcores-widget`? | `@synapcores/widget` — matches `@synapcores/sdk` namespace. |
| 3 | Default branding visibility — "Powered by SynapCores" link on by default? | **Yes, on by default** in self-hosted (open-source convention). Removable via config. Future: paid hosted tier requires it stay on free plan, removable on paid. |
| 4 | Should v2 ALSO ship the MCP server endpoint per project? | **Yes** — each project's KB becomes an MCP server that Claude Desktop can talk to. Zero extra work; massive marketing surface. |
| 5 | Should the docs site at docs.synapcores.com get the widget installed as the launch proof? | **Yes** — eat our own dog food. Live demo on a real high-traffic site. |
| 6 | Conversation persistence default: localStorage-only OR backend-persisted? | **Backend-persisted** (we're a database; the brain's the point). Cookie-set visitor ID. |
| 7 | Anonymous vs identified visitors — both supported by default? | **Yes** — anonymous works out of the box; `SynapCores.identify({…})` upgrades to identified for stronger memory (sales chat use case). |
| 8 | Rate limit per visitor — what's the default? | **60/min** soft; configurable. Per-project burstable. |
| 9 | TLS — is the widget allowed to connect to `ws://` (no TLS) for local dev? | **`localhost` + `127.0.0.1` allowed without TLS** (developer experience). All other origins require `wss://`. |
| 10 | Mobile UX — full-screen overlay vs minimal panel? | **Full-screen overlay on mobile** (standard pattern; Intercom, Drift, Crisp all do this). |

---

## 10. Risks

| Risk | Probability | Mitigation |
|---|---|---|
| Widget bundle size creeps past 50 KB gzipped | Medium | esbuild minified; no framework; bundle-size check in CI |
| First-message latency too high (cold LLM load) | High | Show "warming up…" state; pre-warm model on backend boot per project |
| Multi-tenant table proliferation in SynapCores | Low | Per-project namespace; we already tested namespace isolation in v1's `Brain(namespace=…)` |
| Cross-origin / CSP issues when embedded | High | Test against the 10 most common CSP configurations; document required CSP directives |
| Visitor cookies blocked (Safari ITP, GDPR consent walls) | High | Fall back to `sessionStorage`; document the privacy + persistence tradeoff |
| WebSocket gets blocked by corporate proxies | Medium | Fallback to long-poll HTTP if WS upgrade fails |
| Maintainer burnout supporting 5+ install combinations (Next, WordPress, React Native, Webflow, etc.) | High | Ship only 3 first-class integrations; mark others "community-supported" |
| Widget conflicts with existing Intercom/Drift on same page | Low | Namespace `window.SynapCores` (already planned); z-index configurable |

---

## 11. Success metrics (12 weeks after launch)

| Metric | Target |
|---|---:|
| Widget installs on real sites (detected via beacon ping) | 200+ |
| GitHub stars on synapcores-agent | 500+ |
| npm `@synapcores/widget` weekly downloads | 1,000+ |
| CDN hits on `widget.js` (signal of embedded sites) | 50,000+/week |
| HN front-page time on the launch post | ≥ 6 hours |
| Newsletter signups from `/widget` landing page | 200+ |
| Docker pulls on synapcores/community (downstream signal) | +5,000 vs baseline |
| Examples in the wild on Twitter/X (sites embedding the widget) | 20+ |

These are the metrics that say "v2 actually moved the needle." If we hit ~50% of them, the recognition-first plan worked + the widget thesis worked. If we hit <20%, the positioning needs another iteration.

---

## 12. What we're explicitly NOT shipping in v2

To keep scope honest:

- ❌ **Voice (mic + speech-to-text)** — that's `synapcores-voice-agent`; keep them separate
- ❌ **A drag-and-drop bot builder UI** — that's Typebot's lane; we're API-first
- ❌ **Hosted SaaS / billing / Stripe** — open-source self-hosted only for v2 launch; SaaS is post-launch revenue surface
- ❌ **Analytics dashboard with charts** — minimal admin only; full analytics is post-launch
- ❌ **Agent persona marketplace** — interesting but distracting
- ❌ **Direct Slack/MS Teams integration** — those are different surfaces, separate projects
- ❌ **A11y certification (WCAG 2.1 AA audit by external firm)** — we'll meet the bar via axe-core, but no formal certification spend
- ❌ **Multi-language i18n in v2** — English only at launch; i18n hooks designed in but not populated

---

## 13. What this means for the recognition-first plan

The recognition-first plan (`~/scratch/distribution-strategy/RECOGNITION_FIRST_PLAN.md`) says don't ship new projects for 90 days. v2 is **a re-version of an existing project**, not a new project. It's the strongest performer (6 stars) getting iterated, not a 13th repo getting created.

**Recommendation**: align Sprint 6 launch with day 60-90 of the recognition-first plan. By then Luis has built audience; v2 ships into a warmer reception. That gives Sprints 0-5 (~5 weeks) of build time during the audience-building phase, with launch landing exactly when distribution is unlocked.

This is the **single, focused project relaunch** Sprint 3 of the recognition-first plan calls for. Both plans converge on the same week.

---

## Adjacent documents

- `docs/proposals/v1.8.0_NATIVE_INFERENCE.md` (in aidb repo) — v1.8 CE engineering track, parallel
- `docs/proposals/enterprise_security_roadmap.md` (in aidb repo) — Enterprise Edition security work, parallel
- `~/scratch/distribution-strategy/RECOGNITION_FIRST_PLAN.md` — 90-day marketing reset
- `README.md` (this repo) — v1 README; will be rewritten as part of Sprint 6

## Document control

- **Living doc** — update at each sprint end
- **Reviewed by** — pending
- **Engineering owner** — pending
- **Marketing owner** — Luis (per recognition-first plan)
