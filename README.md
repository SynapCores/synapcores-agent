# synapcores-agent

A **real, framework-free AI agent** whose brain is **[SynapCores](https://synapcores.com)**.

Most "AI agent" stacks bolt together a vector DB, a graph DB, a cache, an LLM,
and a framework (LangChain, etc.) with a lot of glue. This agent does none of
that. It is a thin, dependency-free Python loop where **SynapCores is the entire
brain** — memory, retrieval (RAG), semantic tool routing, state, and text
generation — reached over plain HTTP.

> The point is to be **agent-agnostic by being framework-free**. There is no
> LangChain dependency. The agent is a few hundred lines of standard-library
> Python you can read top to bottom and fork in an afternoon. The same brain is
> reachable from *any* framework — or from Claude Code — over **MCP**.

---

## The agent loop

```
  input
    → recall memory (vector)     what has this user told us before?
    → retrieve knowledge (RAG)   ground the answer in the knowledge base
    → semantic tool-route        pick the right tool by meaning, not keywords
    → act                        run the chosen tool to gather context
    → GENERATE reply             grounded generation with the bundled LLM
    → write memory back          persist the turn for next time
```

Every arrow is a **real SynapCores call** — `EMBED`, `COSINE_SIMILARITY`,
`GENERATE`, and (for the graph-memory variant) Cypher `MERGE` / `MATCH`. No
local embedding model, no separate vector index, no glue service.

Each step is also a **certified recipe** — "this is how the brain works":

| Loop step | What it does | Recipe |
|---|---|---|
| recall memory | `EMBED` the query, rank past turns by `COSINE_SIMILARITY` | [give-any-agent-long-term-memory](https://synapcores.com/recipes/agents/give-any-agent-long-term-memory) |
| retrieve knowledge | semantic search over a knowledge base | [rag-ground-any-agent](https://synapcores.com/recipes/agents/rag-ground-any-agent) |
| semantic tool-route | embed tool descriptions + query, pick the closest | [semantic-tool-routing](https://synapcores.com/recipes/agents/semantic-tool-routing) |
| episodic recall | recall how similar past tickets were resolved | [agentic-memory-graph](https://synapcores.com/recipes/agents/agentic-memory-graph) |
| act + GENERATE + persist | the full support-agent composition | [build-a-customer-support-agent](https://synapcores.com/recipes/agents/build-a-customer-support-agent) |

The agents recipe cluster lives at **<https://synapcores.com/recipes/agents/>**.

---

## The persona: a customer-support agent

A working support agent with three real tools, each backed by a verified
SynapCores surface:

1. **`search_knowledge_base`** — semantic search over help articles (RAG).
2. **`find_similar_tickets`** — recall how similar past incidents were resolved.
3. **`draft_reply`** — grounded generation when nothing else is a strong match.

Conversation memory **persists across runs** — ask a follow-up tomorrow and the
agent recalls today's conversation by meaning.

---

## Quick start

### 1. Run SynapCores locally

```bash
docker run -d --name synapcores -p 8080:8080 \
  -e AIDB_ACCEPT_LICENSE=1 \
  -e AIDB_JWT_SECRET="$(openssl rand -base64 32)" \
  -v synapcores-data:/var/lib/synapcores \
  ghcr.io/synapcores/community:latest

# Grab the one-time admin credentials printed on first boot:
docker logs synapcores | grep -A 12 FIRST-BOOT
```

The Community image ships the **embedded LLM** (a small GGUF model) and
**embeddings** out of the box — no external API key required. The first
`EMBED()` call lazily downloads the MiniLM embedding model (~90 MB) into the
container's Hugging Face cache; subsequent calls are offline.

> **Cold-start timeout:** the bundled GGUF model loads lazily, so the **first**
> `GENERATE` call on CPU can take ~30 s. The gateway's default `request_timeout`
> is 30 s, which the cold load can just exceed. If your first replies time out,
> raise it in `/etc/synapcores/gateway.toml`:
>
> ```toml
> request_timeout = 300            # [server]
> default_timeout_ms = 300000      # [query]
> ```
>
> then restart the container. After the model is warm, `GENERATE` is sub-second.
> (To avoid local LLM entirely, point the gateway at OpenAI/Anthropic/Ollama —
> see **Bring your own LLM** below.)

### 2. Configure the agent

```bash
git clone <this repo> && cd synapcores-agent
cp .env.example .env
# edit .env: set SYNAPCORES_URL, SYNAPCORES_USERNAME, SYNAPCORES_PASSWORD
pip install -e .          # or: pip install -e ".[dev]" for tests
```

### 3. Run it

```bash
# Seed a demo knowledge base + past tickets, then chat interactively:
python -m synapcores_agent --seed --trace

# Ask one question and exit:
python -m synapcores_agent --ask "I can't log in, it says my password is wrong."

# Watch the full loop (recall / RAG / route) per turn:
python -m synapcores_agent --trace

# Reset the agent's tables:
python -m synapcores_agent --reset
```

Or run the scripted multi-turn demo:

```bash
python examples/demo_session.py
```

---

## What an actual session looks like

```
you> I can't log in, it keeps saying my password is wrong.
   recall=0 kb=2 route=[find_similar_tickets=0.53, search_knowledge_base=0.05] -> find_similar_tickets
agent> I understand you're experiencing difficulty with your login... Please
       check your password reset link in your inbox and try again...

you> Also, how do I get a refund on my annual plan?
   recall=0 kb=2 route=[search_knowledge_base=0.30, find_similar_tickets=0.05] -> search_knowledge_base
agent> Since your annual plan is prorated, you should contact support to
       discuss your options...

you> Remind me what we were troubleshooting earlier with my account?
   recall=4 kb=3 route=[find_similar_tickets=0.56] -> find_similar_tickets
agent> We were investigating an issue with your login password...
```

Note the last turn: `recall=4` — the agent pulled the earlier login
conversation out of long-term memory **by meaning** and grounded its answer on
it. That memory survives process restarts because it lives in SynapCores.

---

## How the brain works (the verified surfaces)

Everything routes through **one SQL/Cypher endpoint** — `POST /v1/query/execute` —
plus `POST /v1/auth/login` to mint a JWT.

**Memory recall** ([`brain.py`](src/synapcores_agent/brain.py)):

```sql
SELECT role, content,
       COSINE_SIMILARITY(embedding, EMBED('what was my order number')) AS score
FROM support_agent_memory
WHERE user_id = 'demo-user'
ORDER BY score DESC LIMIT 4;
```

**RAG retrieval:**

```sql
SELECT title, body,
       COSINE_SIMILARITY(embedding, EMBED('I forgot my password')) AS score
FROM support_agent_kb
ORDER BY score DESC LIMIT 3;
```

**Semantic tool routing** ([`router.py`](src/synapcores_agent/router.py)) — one
`COSINE_SIMILARITY` per tool description in a single row, ranked in Python:

```sql
SELECT COSINE_SIMILARITY(EMBED('<tool 1 description>'), EMBED('<user msg>')) AS s0,
       COSINE_SIMILARITY(EMBED('<tool 2 description>'), EMBED('<user msg>')) AS s1,
       ...;
```

**Grounded generation** — the bundled LLM, sourced from a scan (not a bare
literal):

```sql
SELECT GENERATE(p) AS reply FROM (SELECT '<grounded prompt>' AS p) r;
```

### Two surface notes worth knowing

- **String literals use single quotes.** A double-quoted token in SynapCores SQL
  is an *identifier* (column name), not a string. All user text is escaped via
  `sql_quote()` and single-quoted. This is the #1 footgun when hand-building
  queries.
- **Source AI-function inputs from a `FROM (SELECT … AS col) r` scan.** A bare
  literal works for `GENERATE`, but the same pattern is *required* for
  `AUTOML.PREDICT` (a bare literal there trips a `duplicate 'value'` planner
  error). The client uses the scan form uniformly so the pattern is consistent.

---

## Plug into any framework — or Claude Code — via MCP

The agent loop above uses the REST client for clarity, but SynapCores also
speaks the **Model Context Protocol (MCP)**, so *any* MCP client can use the same
brain with no Python at all.

The gateway exposes MCP as JSON-RPC 2.0:

```
POST /v1/mcp          — single JSON-RPC request
POST /v1/mcp/batch    — batch
GET  /v1/mcp/info     — server info
```

with these tools (the original SQL-mediated six, plus AI primitives added in
later releases):

`query`, `execute`, `list_tables`, `describe_table`, `validate_query`,
`sql_manual` — and `train_model` / `predict` / `list_models` / `describe_model`,
`semantic_search`, `embed_text`, `graph_query`, `generate_text`.

### Claude Code / Claude Desktop

Claude clients speak MCP over stdio, so the engine ships a tiny stdio→HTTP
bridge (`scripts/integrations/synapcores-mcp-bridge.js`). One command:

```bash
claude mcp add synapcores \
  --transport stdio \
  --env SYNAPCORES_URL=http://127.0.0.1:8080 \
  --env SYNAPCORES_USERNAME=admin \
  --env SYNAPCORES_PASSWORD='your-admin-password' \
  -- node ~/.synapcores/synapcores-mcp-bridge.js
```

Now Claude Code can `query`/`execute`/`semantic_search`/`graph_query` directly —
SynapCores becomes Claude's memory + RAG + graph brain. A future engine release
adds native SSE / streamable-HTTP transports so clients connect to the gateway
URL directly (`ws://<host>/mcp?token=<jwt>` style) without the bridge.

### From your own code

This repo includes a tiny MCP client ([`mcp.py`](src/synapcores_agent/mcp.py)):

```python
from synapcores_agent.mcp import MCPClient

mcp = MCPClient("http://127.0.0.1:8080", token=jwt)
mcp.initialize()
print(mcp.list_tools())
print(mcp.query("SELECT 1 + 1 AS x"))
```

### From LangChain / other frameworks

The brain methods are framework-neutral. Wrap `Brain.search_kb`,
`Brain.find_similar_tickets`, and `Brain.recall_memory` as tools in your
framework of choice, or expose the MCP tools to any MCP-aware agent runtime. The
SynapCores side is identical — the framework is just a thin shell around it.

---

## Bring your own LLM

By default the agent uses the **bundled `GENERATE`** (zero external key). To use
an external provider instead, wire it into the gateway's
`/etc/synapcores/gateway.toml`:

```toml
[query.ai_service]
provider = "openai"          # or "anthropic" / "ollama"
api_key  = "${OPENAI_API_KEY}"
model    = "gpt-4o-mini"
```

(set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` on the container/service env, restart),
and the agent's `GENERATE` calls transparently use it. No agent code changes.

---

## Project layout

```
src/synapcores_agent/
  client.py        # dependency-free REST client (login, execute, generate)
  config.py        # .env / env loading
  brain.py         # SynapCores as memory + RAG + episodic recall + generation
  router.py        # semantic tool routing (EMBED + COSINE_SIMILARITY)
  agent.py         # the framework-free agent loop
  tools/           # the three support tools
  mcp.py           # optional MCP (JSON-RPC) client — the agnostic path
  seed.py          # demo KB + ticket corpus
  __main__.py      # `python -m synapcores_agent` CLI / REPL
examples/
  demo_session.py  # scripted multi-turn end-to-end session
tests/
  test_unit.py     # pure-Python tests (no gateway needed)
  test_live.py     # end-to-end against a real gateway (auto-skips if absent)
```

---

## Tests

```bash
pip install -e ".[dev]"
pytest tests/test_unit.py -q                       # always runs
SYNAPCORES_URL=http://127.0.0.1:8080 \
SYNAPCORES_USERNAME=admin SYNAPCORES_PASSWORD=... \
  pytest tests/test_live.py -v                      # needs a live gateway
```

The live suite verifies the real surfaces: `EMBED` + `COSINE_SIMILARITY`
semantic ranking, KB retrieval, similar-ticket recall, memory persistence,
semantic routing, and a full grounded turn.

---

## License

MIT — see [LICENSE](LICENSE).

Built on [SynapCores](https://synapcores.com). The agent patterns are the
certified recipes at <https://synapcores.com/recipes/agents/>.
