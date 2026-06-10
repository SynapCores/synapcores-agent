# Running the widget against a real SynapCores

The widget talks to the SynapCores gateway directly — `AiChatWsMessage`
protocol on `/ws`, JWT auth via `?token=` query param, and `AGENT_RUN()`
under the hood as the agent loop. No Python middleware.

This is the **dev path**. Production embedders will get a token via the
auto-bootstrap (`POST /v1/widget/token` — Sprint 2 Phase B), so all they
have to write is the `<script>` tag. While that endpoint is being built,
this doc tells you how to wire the widget up by hand.

---

## 1. Start a SynapCores container

```bash
docker run -d --name synapcores -p 8080:8080 \
  -e AIDB_ACCEPT_LICENSE=1 \
  -e AIDB_JWT_SECRET="$(openssl rand -base64 32)" \
  -v synapcores-data:/var/lib/synapcores \
  ghcr.io/synapcores/community:latest
```

Wait ~20 s for the first-boot model warm-up to finish, then read the
one-time admin credentials it printed:

```bash
docker logs synapcores 2>&1 | grep -A 12 FIRST-BOOT
```

You'll see something like:

```
FIRST-BOOT admin credentials:
  email:    admin@local
  password: <random>
  tenant:   <uuid>
```

## 2. Obtain a JWT

```bash
curl -s http://localhost:8080/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local","password":"<random from step 1>"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])'
```

Save the printed JWT — you'll paste it into the widget's `data-token`
attribute next.

## 3. Make sure the chat engine is configured

The widget calls `send_message`, which the gateway routes through its
`chat_engine`. For a fresh CE install, the bundled `local` provider is
already wired (v1.8 ships native inference). Verify with:

```bash
curl -s http://localhost:8080/v1/version | python3 -m json.tool
```

If you want to use Ollama / OpenAI / Claude instead, set the AI provider
in `gateway.toml` (`[ai_chat] provider = "ollama"` etc.). See the gateway
docs for the full config surface.

## 4. Paste the token + run the widget dev server

Edit `widget/dev/index.html` and replace `REPLACE_WITH_JWT` with the JWT
from step 2.

Then:

```bash
cd widget
npm install            # one-time
npm run build          # writes dist/widget.js
npm run dev            # esbuild watch + http.server on :5050
```

Open <http://localhost:5050/dev/>. Click the chat button. Send a message.
What you should see:

- "Connecting…" banner flickers, then disappears once the WS opens
- "Thinking" dots animate while the gateway invokes `AGENT_RUN`
- Reply streams in token-by-token via `message_chunk` frames
- On `message_complete`, the final text is re-rendered with markdown

Open DevTools → Network → WS to watch the frames. Each turn should show
one outbound `send_message` and a stream of inbound `message_chunk`
followed by one `message_complete`.

## 5. Common things that break

| Symptom | Cause | Fix |
|---|---|---|
| `Auth failed — bootstrap failed: 404` | `/v1/widget/token` not deployed yet | Use `data-token` instead — this is Phase B work |
| WS closes immediately with 1008 / "invalid token" | JWT expired or wrong secret | Re-run step 2 (tokens default to 1 h) |
| WS closes immediately with 1006 + browser CORS error | Origin not in `[server].allowed_origins` | Add your dev origin (e.g. `http://localhost:5050`) to gateway.toml |
| Chat says `(error: chat engine not configured)` | No AI provider wired | See step 3; configure `[ai_chat] provider = …` |
| Streaming bubble shows raw JSON instead of prose | Wire-shape drift between widget and `ai_chat_handler.rs` | Open an issue with the WS frame from DevTools |

## 6. What Phase B adds

When the `POST /v1/widget/token` endpoint ships, embedders won't need to
generate JWTs by hand. The production embed becomes:

```html
<script
  defer
  src="https://cdn.synapcores.com/widget.js"
  data-api-base="https://your-synapcores.example.com"
  data-database="default"
  data-project-key="pk_abc123"
></script>
```

The widget POSTs the project key + visitor id at first open, gets back a
~5-minute scoped JWT, opens WS. The Origin header is validated server-side
against the project's `allowed_origins` allowlist — so the embed code is
safe to publish on a public page even though it identifies the project.

`data-token` will stay supported for dev / preview use, but production
embed codes should always use the bootstrap.
