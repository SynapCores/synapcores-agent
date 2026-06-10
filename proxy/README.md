# @synapcores/widget-proxy

Tiny Node.js service that sits in front of a SynapCores gateway and lets
embedded chat widgets talk to it **without ever holding a SynapCores
credential in the browser**.

```
Browser widget  ── /widget.js     ──►  proxy (this) ──►  SynapCores /ws
                ── POST /v1/session                       (proxy holds the JWT)
                ── WS  /ws  (cookie auth)
```

The proxy does three jobs:

1. **Delivery** — serves the widget bundle at `GET /widget.js`.
2. **Session** — `POST /v1/session` sets an HttpOnly, HMAC-signed cookie
   identifying `(visitor_id, project_key)`. JS never sees the credential.
3. **WS proxy** — on `GET /ws` it verifies the cookie, opens an upstream
   WebSocket to the SynapCores gateway using the **server-held** JWT or
   API key, and pipes `AiChatWsMessage` frames in both directions.

What's NOT in the proxy: any agent loop, any model logic, any business
rules. Those all run in SynapCores via `AGENT_RUN()`. The proxy is a
credentialed pipe + a tiny session ledger.

---

## Install + run

```bash
cd proxy
npm install

# 32+ char HMAC secret for cookies — generate once, never commit
export PROXY_SESSION_SECRET="$(openssl rand -hex 32)"

# Per-project credentials, referenced by name in projects.json
export DEMO_SYNAPCORES_TOKEN="<a JWT obtained from /v1/auth/login>"

cp projects.example.json projects.json   # edit if needed
npm start                                # listens on 127.0.0.1:5060
```

Visit <http://127.0.0.1:5060/> — the proxy renders a one-page dev landing
that script-tags `/widget.js` with the first project. If the floating
chat button is bottom-right, the delivery half works. Click it, send a
message — if you have a SynapCores running at the configured upstream
the round-trip completes; if not, the widget shows the upstream connect
error in-bubble (which still proves the proxy → widget → cookie loop is
clean).

## Config — `projects.json`

```jsonc
{
  "server": {
    "port": 5060,
    "host": "0.0.0.0",
    "widget_bundle_path": "../widget/dist/widget.js"  // relative to projects.json dir
  },
  "session": {
    "secret_env": "PROXY_SESSION_SECRET",  // 32+ char HMAC secret
    "ttl_seconds": 3600,
    "cookie_name": "sc_session",
    "same_site_none": false                // true for cross-origin prod (HTTPS req'd)
  },
  "projects": {
    "pk_demo": {
      "tenant": "demo",
      "database": "default",
      "persona": "support",
      "agent_name": "SynapCores",
      "allowed_origins": ["http://localhost:5050", "http://127.0.0.1:5060"],
      "rate_limit_per_minute": 60,
      "upstream": {
        "api_base": "http://localhost:8080",
        "token": "ENV:DEMO_SYNAPCORES_TOKEN"  // resolved against process.env
      }
    }
  }
}
```

- **`projects.<key>.upstream.token`** can be inlined (not recommended) or
  reference an env var via `ENV:NAME`. The token can be a JWT obtained
  from the SynapCores gateway's `/v1/auth/login`, or — once the gateway
  accepts API keys on `/ws` — a long-lived API key.
- **`allowed_origins`** is the production CORS allowlist. Sessions
  initiated from any other origin are 403'd; WS upgrades from any other
  origin are 403'd; cookie SameSite policy double-checks the same
  invariant at the browser layer.
- **`rate_limit_per_minute`** is per visitor per project. Block list:
  in-memory sliding window. For horizontal scaling swap `src/ratelimit.js`
  for a Redis-backed counter.
- **`same_site_none: true`** — required when the widget is embedded on a
  different origin from the proxy (the production case). Forces
  `SameSite=None; Secure` so the cookie travels cross-origin. **HTTPS
  becomes mandatory** in this mode.

## Routes

| Method | Path           | Auth      | Notes                                         |
| ------ | -------------- | --------- | --------------------------------------------- |
| GET    | `/health`      | none      | `{ok:true, projects:N}`                       |
| GET    | `/`            | none      | Dev landing page (script-tags the first project) |
| GET    | `/widget.js`   | none      | Static bundle, ETag + 5-min cache             |
| POST   | `/v1/session`  | origin    | Issues HttpOnly cookie, returns project meta  |
| GET    | `/ws`          | cookie    | WebSocket upgrade → proxied to upstream       |
| OPTIONS| *              | origin    | CORS preflight                                |

## Wire protocol (browser ⇄ proxy ⇄ upstream)

Identical to `AiChatWsMessage` in `aidb-gateway/src/websocket/ai_chat_handler.rs`.

The proxy **only forwards** `send_message` and `ping` from the browser
side — `execute_sql`, `execute_tool`, and any future variants are silently
dropped so the browser surface stays "chat only", regardless of what the
upstream JWT could authorize.

The proxy **rewrites** `send_message.context` to inject the project's
`database` + the visitor's id from the cookie. The browser cannot point
at another tenant's data.

## Security checklist

- [x] HttpOnly cookie — JS cannot read the session token
- [x] HMAC-signed cookie — tampered cookies fail verification
- [x] Constant-time signature comparison (`crypto.timingSafeEqual`)
- [x] Origin allowlist on `/v1/session` and `/ws`
- [x] Browser-side `send_message` / `ping` only — `execute_sql` blocked
- [x] Server-side `context.database` injection — visitor cannot target another DB
- [x] Per-visitor rate limiting
- [ ] Distributed rate limiting (Redis) — single-instance only today
- [ ] CSP/XFO headers on `/` — TODO if hosting the landing publicly

## Deploy

A `Dockerfile` ships in this directory. The expected pattern is a single
docker compose file with the SynapCores engine + this proxy:

```yaml
# synapcores-agent/proxy/docker-compose.example.yml (forthcoming)
services:
  synapcores:
    image: ghcr.io/synapcores/community:latest
    # ...
  widget-proxy:
    build: .
    environment:
      PROXY_SESSION_SECRET: ${PROXY_SESSION_SECRET}
      DEMO_SYNAPCORES_TOKEN: ${DEMO_SYNAPCORES_TOKEN}
    volumes:
      - ./projects.json:/app/projects.json:ro
      - ./widget-dist:/app/widget-dist:ro
    ports:
      - "5060:5060"
```

## What's not here yet

- Dockerfile + docker-compose.example.yml (next pass)
- Token-rotation hooks (if you supply credentials by env, you also
  restart-rotate today)
- Optional integration tests (live SynapCores in CI)

These are Sprint 4 distribution / polish items.

## License

MIT — see `../LICENSE`.
