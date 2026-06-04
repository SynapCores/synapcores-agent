# synapcores-agent v2 — Open-Question Recommendations

**Authored**: 2026-06-03
**Status**: Draft recommendations — needs founder red-line before Sprint 0
**Companion to**: `V2_DESIGN.md`

10 decisions to lock before kicking off Sprint 0. Each comes with a recommendation, the reasoning, the tradeoff, and the scope impact.

---

## 1. Distribution channels — CDN vs npm vs both

**Recommendation: BOTH.**

- **`cdn.synapcores.com/widget.js`** (Cloudflare Pages → Cloudflare CDN) for the 1-line install crowd: WordPress, static sites, Webflow, Carrd, "let me paste this in my Squarespace footer." Most install surface.
- **`@synapcores/widget` on npm** for React / Next / Vite / Svelte devs who want bundle control + tree-shaking + the typed `WidgetConfig` interface in their editor.

**Why**: the script-tag crowd is 5× larger than the React-dev crowd at the bottom of the funnel; the React-dev crowd is more likely to evangelize on X and contribute back. Different audiences, both worth winning.

**Tradeoff**: two distribution paths to keep in sync. Mitigation: single build artifact, npm just imports the same `dist/widget.js`. CDN serves the same artifact with `Content-Type: application/javascript` + long cache headers + a `widget.v1.js` permalink for version pinning.

**Scope impact**: +0 sprints. Both channels publish from the same `widget/dist/` output in Sprint 4.

**Hosting note**: `cdn.synapcores.com` will need DNS + Cloudflare Pages setup (~30 min of ops work). Add to Sprint 4.

---

## 2. npm package name

**Recommendation: `@synapcores/widget`.**

**Why**: matches the existing `@synapcores/sdk` and `@synapcores/openclaw-memory` scoped pattern. Scoped packages also let us reserve the namespace from squatters — we own `@synapcores/*` on npm, anyone else who tries `synapcores-widget` unscoped can technically grab the name.

**Tradeoff**: scoped packages need `npm config set @synapcores:registry` if we ever decide to publish to a private registry. We won't, so this doesn't matter.

**Scope impact**: zero.

---

## 3. Default branding visibility ("Powered by SynapCores")

**Recommendation: ON by default in self-hosted v2 launch. Removable via `showBranding: false` in config. No paid tier yet.**

**Why**: open-source convention. Plausible, Tawk, Crisp, Botpress all show "Powered by" by default. Devs who care will remove it; the link is real distribution. Hiding it by default would forfeit the embedded-on-1000-sites flywheel.

**The footer is small + tasteful**: subtle text + small SynapCores logo, links to https://synapcores.com. NOT a banner. NOT animated. NOT colored. Roughly the size of Plausible's "Made with Plausible" footer.

**Tradeoff**: some devs will remove it. That's fine — they got value, they kept it open-source, they don't owe us a billboard. The ones who keep it are the ones whose visitors actually click through, which is the only kind of distribution we want anyway.

**Scope impact**: zero. Just a config flag with a default.

**Future**: if/when we ship a hosted SaaS tier (post-launch), the free hosted plan keeps branding, paid plans can remove it. Standard freemium model. Out of scope for v2 launch.

---

## 4. Per-project MCP server endpoint

**Recommendation: YES, ship it in Sprint 4.**

**Why**: zero extra engineering work — every project has an isolated KB + memory in SynapCores. Wrapping each project's namespace as a scoped MCP server is ~50 LoC on top of the existing `mcp.py` (91 LoC, already shipped in v1).

The marketing surface is massive:
- Every dev who installs the widget gets "drop your docs into Claude Desktop" for FREE
- Pairs perfectly with the MCP-hype zeitgeist
- Becomes a real reason to use SynapCores' agent over Intercom/Drift (they don't have MCP)
- Per-project MCP token + scope = clean per-customer separation

**The story for the dev**: "Install the widget for your visitors. The same KB is automatically queryable from Claude Desktop or Cursor for your team."

**Tradeoff**: another surface to keep secure (project key scoping). Already designed for it via the visitor-token model; cost is minimal.

**Scope impact**: +0.3 weeks in Sprint 4. Worth it.

---

## 5. Install our own widget on docs.synapcores.com as launch proof

**Recommendation: YES — mandatory for Sprint 6 launch.**

**Why**: "we don't even use it on our own site" is the death of any embeddable. Conversely, "click any page of docs.synapcores.com and a real working chat answers your docs question from MiniLM-recalled chunks" is the most credible possible HN demo. Eats our own dog food + builds the strongest possible proof point.

**Bonus**: gives us real visitor traffic + real questions to study + a real KB to keep current. Operational forcing function.

**Tradeoff**: docs.synapcores.com is a MkDocs static site; we need to inject the script tag into the theme's `extra_javascript` config. ~10 minutes.

**Bot/crawler protection — required before this single deployment goes live** (since v2 is otherwise strictly self-hosted, this is the only widget instance we own):
- Cloudflare Turnstile (invisible) gating the WS upgrade — blocks headless Chromium / curl / Puppeteer crawls
- Hard monthly token-budget ceiling on the docs project — when hit, widget falls back to a non-LLM "ask later" reply (rate limits alone don't save you from a slow steady scrape)
- Origin allowlist already enforced by the per-project CORS check from Section 4 — only `https://docs.synapcores.com` accepted

**Scope impact**: +0.2 weeks in Sprint 6 launch prep (Turnstile + budget cap on top of the 10-min script-tag inject).

---

## 6. Conversation persistence — localStorage vs backend

**Recommendation: BACKEND-PERSISTED, default ON.**

**Why**:
- We are literally a database company. The brain's whole pitch is "memory lives where the data lives." localStorage-only would be hypocrisy.
- Same visitor returning on a different device or browser gets continuity (a paying customer signs in on their phone — memory still recalled).
- Per-project memory is one of the unique selling features vs Intercom (they bill you for it).
- Storage cost is trivial — embeddings + a row per turn.

**Cookie-set visitor ID** (long-lived, 1-year) maps to the Brain's `user_id`. Anonymous visitors get an opaque ID; identified visitors (via `SynapCores.identify({…})`) overlay name/email on top.

**Tradeoff**: GDPR consent. We need to document the visitor-cookie model clearly + ship a `persistConversation: false` opt-out for sites in privacy-sensitive jurisdictions. Sites in the EU may want their CMP (cookie management platform) to gate the widget from loading until consent.

**Scope impact**: zero — this is already the default in the Brain. Just need to document the privacy posture in `docs/PRIVACY.md` (Sprint 4).

---

## 7. Anonymous vs identified visitors — both?

**Recommendation: BOTH, both work out of the box.**

- **Anonymous** is the default: visitor lands on a docs page, opens the widget, gets help. No login required. Cookie ID persists their convo.
- **Identified** is an upgrade: when the host site already has a logged-in user, they call `SynapCores.identify({ id, name, email })` from their app. The Brain now associates memories with a real customer record.

**Why both**: anonymous is the docs-site / marketing-site use case. Identified is the SaaS-product use case (logged-in dashboards where the visitor IS already known). We get both audiences with zero extra effort.

**Tradeoff**: keeping the anonymous → identified migration clean (when an anonymous visitor logs in, their prior chat should merge into the identified profile). Doable but worth one careful pass in Sprint 3.

**Scope impact**: zero — covered in the visitor model already planned.

---

## 8. Rate limit per visitor

**Recommendation: 60 messages per minute per visitor, soft. Configurable per-project. Burstable to 100.**

**Why**: 60/min is generous for a real human (1/sec is fast typing), restrictive enough for casual abuse. Configurable per-project so high-value SaaS customers can set 200/min for their power users.

**Sliding window** (not fixed window) so a burst doesn't kill the next minute. Soft limit returns a polite "slow down" message in the chat; hard limit (5× soft) closes the WebSocket and requires reconnect.

**Tradeoff**: not high enough for automated load-testing. That's fine — load tests should hit a separate test project key with limit disabled.

**Scope impact**: zero. We have rate-limit middleware in `aidb-gateway` already; widget backend just wraps it.

---

## 9. TLS — allow `ws://` from local dev only?

**Recommendation: YES — allow `ws://` from `localhost`, `127.0.0.1`, and `::1`. Block plain WS from all other origins.**

**Why**: developer-experience cliff if we require TLS during the install spike. They `docker compose up`, point the widget at `ws://localhost:8080`, and the widget refuses to connect because it's not TLS — that's the kind of friction that loses a developer.

**The check**: widget reads the `data-backend` URL, validates the host portion against the allowlist (`localhost`, `127.0.0.1`, `::1`, and any custom dev hosts the developer adds via `data-dev-hosts`). All production deployments require `wss://`.

**Tradeoff**: someone might "test in prod" with their dev domain in the allowlist. Document the risk; widget logs a console warning when running over `ws://`.

**Scope impact**: zero — this is just a URL validation check.

---

## 10. Mobile UX

**Recommendation: FULL-SCREEN OVERLAY on mobile (< 600px viewport width).**

**Why**: every successful embeddable chat does this. Intercom, Drift, Crisp, Hubspot — same pattern. A 380×600 panel on a 393×852 iPhone is awkward and never gets used. Full-screen overlay turns the widget into a usable mobile-first experience.

**Specifics**:
- Bottom-up slide animation when opening (matches native iOS sheet behavior)
- Swipe-down or × to close
- Composer fixed to bottom; messages scroll above
- Virtual-keyboard-aware: panel resizes when keyboard appears (`visualViewport` API)
- Launcher button hidden when panel is open (avoid floating button overlapping the panel)

**Tradeoff**: more complexity in the panel component. Mitigation: extract to a `MobileLayout` subcomponent in Sprint 5.

**Scope impact**: covered in Sprint 5's polish work. No additional sprint.

---

## Summary of impact on the 6-week plan

| # | Question | Decision | Sprint impact |
|---|---|---|---:|
| 1 | CDN + npm? | **Both** | +0 |
| 2 | npm name | `@synapcores/widget` | +0 |
| 3 | Branding default | **On**, removable | +0 |
| 4 | MCP-per-project | **Yes**, Sprint 4 | +0.3 wk |
| 5 | docs.synapcores.com proof | **Yes**, Sprint 6 | +0.2 wk |
| 6 | Persistence | **Backend-persisted** default | +0 (privacy doc only) |
| 7 | Identified + anonymous | **Both** | +0 |
| 8 | Rate limit | 60/min soft, configurable | +0 |
| 9 | `ws://` allowed | **localhost only** | +0 |
| 10 | Mobile UX | **Full-screen overlay** | +0 (in Sprint 5) |

**Net cumulative scope impact**: +0.5 weeks.

If founder agrees with these defaults, the plan stays at **~6.5 weeks** end-to-end and unlocks Sprint 0.

---

## Items NOT covered by these 10 questions (and where they're handled)

For founder reference — things you might wonder about that we addressed elsewhere in `V2_DESIGN.md`:

| Concern | Where it's covered |
|---|---|
| Multi-tenant SynapCores namespacing | Section 4 (component 2) + Brain already takes `namespace` arg |
| Authentication for widget → backend | Section 4 (component 2) — project key + visitor cookie |
| CORS allowlist per project | Section 4 + answer 9 (TLS check) |
| Mobile responsive | Answer 10 above |
| Theming + dark mode | Section 4 (component 1) `WidgetConfig` interface |
| KB import (URL crawl, sitemap, markdown) | `kb_loader.py` in Section 6 |
| Streaming responses | Section 7 — Sprint 1 ships basic; streaming added in Sprint 3 |
| Conversation history UI | Section 7 — Sprint 3 |
| What happens if the agent is rate-limited | Answer 8 + Section 7 — Sprint 5 polish |
| Accessibility | Section 7 — Sprint 5 (axe-core pass) |
| i18n / non-English support | Section 12 — out of scope for v2; hooks designed in |

---

## Recommended next step

If you red-line and agree with these defaults, the engineering plan is locked. Sprint 0 (2-day spike) can start the day after.

If you want to push back on any of the 10 — particularly #3 (branding), #4 (MCP), or #5 (dogfooding on docs.synapcores.com) — those have the biggest strategic implications and are the ones worth a real conversation before kicking off.
